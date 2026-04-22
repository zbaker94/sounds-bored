import { ensureResumed, getAudioContext } from "./audioContext";
import { STOP_RAMP_S } from "./audioVoice";
import { buildPlayOrder, isChained } from "./arrangement";
import { useLibraryStore } from "@/state/libraryStore";
import { usePlaybackStore } from "@/state/playbackStore";
import type { Pad, Scene } from "@/lib/schemas";
import { isFadeablePad } from "@/lib/padUtils";
import { emitAudioError } from "./audioEvents";
import { stopAudioTick } from "./audioTick";

import {
  addStopCleanupTimeout,
  deleteStopCleanupTimeout,
  cancelPadFade,
  cancelGlobalStopTimeout,
  clearAllFadeTracking,
  clearAllLayerChains,
  clearAllLayerCycleIndexes,
  clearAllLayerGains,
  clearAllLayerPending,
  clearAllLayerPlayOrders,
  clearAllPadGains,
  clearAllStreamingAudio,
  clearAllPadProgressInfo,
  clearAllLayerProgressInfo,
  clearLayerPending,
  clearLayerStreamingAudio,
  clearPadProgressInfo,
  deleteLayerChain,
  deleteLayerCycleIndex,
  deleteLayerPlayOrder,
  deleteFadePadTimeout,
  forEachPadGain,
  getLayerChain,
  getLayerCycleIndex,
  getLayerPlayOrder,
  getLayerVoices,
  getOrCreateLayerGain,
  getPadGain,
  isLayerActive,
  isLayerPending,
  isPadActive,
  isPadFading,
  isPadFadingOut,
  isPadFadingIn,
  addFadingInPad,
  removeFadingInPad,
  nullAllOnEnded,
  setFadePadTimeout,
  setGlobalStopTimeout,
  setLayerChain,
  setLayerCycleIndex,
  setLayerPending,
  setLayerPlayOrder,
  stopAllVoices,
  stopPadVoices,
  getPadFadeDirection,
  setPadFadeDirection,
} from "./audioState";

import {
  resolveFadeDuration,
  fadePadOut,
  fadePadInFromCurrent,
} from "./fadeMixer";

import {
  applyRetriggerMode,
  startLayerPlayback,
  startLayerSound,
  rampStopLayerVoices,
  resolveSounds,
  getVoiceVolume,
  getLayerNormalizedVolume,
} from "./layerTrigger";

// Re-export public query/clear functions for backward compatibility
export {
  clearAllFadeTracking,
  clearAllPadGains,
  clearAllLayerGains,
  clearAllLayerChains,
  clearAllLayerCycleIndexes,
  isPadFadingOut,
  isPadFading,
  isPadStreaming,
  getPadProgress,
  getPadGain,
  isLayerActive,
  isPadActive,
} from "./audioState";

// Re-export functions moved to fadeMixer / gainManager for backward compatibility
export {
  freezePadAtCurrentVolume,
  resolveFadeDuration,
  fadePadOut,
  fadePadInFromCurrent,
} from "./fadeMixer";

export {
  setPadVolume,
  resetPadGain,
  syncLayerVolume,
  setLayerVolume,
} from "./gainManager";

export async function fadePadIn(pad: Pad, durationMs: number, fromVolume?: number, toVolume?: number): Promise<void> {
  // 1. Cancel any prior fade and mark as fading-in BEFORE the await.
  //    This closes the race window: if applyFadeToggle fires another fade direction
  //    during `await triggerPad`, cancelPadFade will clear this flag and we'll bail
  //    below rather than overwriting the interleaved fade.
  cancelPadFade(pad.id);
  addFadingInPad(pad.id);

  const startVol = fromVolume ?? 0;
  const endVol = toVolume ?? 1.0;

  // 2. Start pad at gain startVol
  await triggerPad(pad, startVol);

  // 3. If we were pre-empted during the await (e.g. user pressed F to reverse
  //    mid fade-in), cancelPadFade will have cleared fadingInPadIds — bail so we
  //    don't overwrite the interleaved fade-out ramp.
  if (!isPadFadingIn(pad.id)) return;
  removeFadingInPad(pad.id);
  setPadFadeDirection(pad.id, "in");

  const ctx = getAudioContext();
  const gain = getPadGain(pad.id);

  // 4. Schedule Web Audio ramp
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(startVol, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(endVol, ctx.currentTime + durationMs / 1000);

  // 5. Completion cleanup — stored in fadePadTimeouts so cancelPadFade can cancel it
  // Tick reads gain node values automatically — no RAF or store signal needed.
  const timeoutId = setTimeout(() => {
    deleteFadePadTimeout(pad.id);
    cancelPadFade(pad.id);
  }, durationMs + 5);
  setFadePadTimeout(pad.id, timeoutId);
}

export function crossfadePads(fadingOut: Pad[], fadingIn: Pad[], globalFadeDurationMs?: number): void {
  fadingOut.forEach((pad) => fadePadOut(pad, resolveFadeDuration(pad, globalFadeDurationMs)));
  fadingIn.forEach((pad) =>
    fadePadIn(pad, resolveFadeDuration(pad, globalFadeDurationMs)).catch((err: unknown) => {
      emitAudioError(err);
    })
  );
}

/**
 * Central fade-toggle state machine — all fade trigger paths (F hotkey, fade button,
 * synchronized fades) route through here.
 *
 * Four cases, in priority order:
 *   1. Fading OUT                        → reverse: ramp back up to highVol from current gain.
 *   2. Active, gain settled near lowVol  → reverse of a completed fade-out: ramp up to highVol.
 *   3. Active (playing or mid fade-in)   → fade OUT to lowVol.
 *   4. Not active                        → fade IN from silence to highVol.
 *
 * The "settled near low" check (case 2) detects when a non-zero fade-out has completed
 * and the pad is still playing at lowVol. A 0.02 tolerance accounts for floating-point
 * drift on the gain node without misclassifying pads playing near the middle of the range.
 *
 * isPadFadingIn covers the async gap between cancelPadFade and setFadePadTimeout in
 * fadePadIn, where isPadFading is momentarily false but a fade-in is still starting.
 */
function applyFadeToggle(pad: Pad, duration: number): Promise<void> {
  const lowVol = pad.fadeLowVol ?? 0;
  const highVol = pad.fadeHighVol ?? 1;

  if (isPadActive(pad.id)) {
    if (isPadFadingOut(pad.id)) {
      // Fading out → reverse: ramp back up
      fadePadInFromCurrent(pad, duration, highVol);
    } else if (isPadFadingIn(pad.id) || isPadFading(pad.id)) {
      // Fade-in is in progress (async gap or timeout active) → reverse by fading out
      // fadePadOut will call removeFadingInPad so fadePadIn's post-await guard sees the reversal
      fadePadOut(pad, duration, undefined, lowVol);
    } else {
      const lastDir = getPadFadeDirection(pad.id);
      if (lastDir === "out" || (!lastDir && lowVol > 0 && getPadGain(pad.id).gain.value <= lowVol + 0.02)) {
        // Last fade was out (settled at low), or gain is near the low endpoint with no
        // direction history — fade back up. The stored direction is authoritative when
        // present: it survives boundary drags that shift fadeLowVol away from gain.value.
        fadePadInFromCurrent(pad, duration, highVol);
      } else {
        // Playing at high level (or no fade history) → fade out to low
        fadePadOut(pad, duration, undefined, lowVol);
      }
    }
    return Promise.resolve();
  }

  // Not active: if a fade-in is already starting (async gap), ignore
  if (isPadFadingIn(pad.id) || isPadFading(pad.id)) return Promise.resolve();

  // Not playing → fade in from fadeLowVol (or silence if unset)
  return fadePadIn(pad, duration, lowVol, highVol);
}

/**
 * Orchestration entry point for a single-pad fade tap (fade mode).
 * Determines whether to reverse a fade-out, start a fade-out, or fade in
 * based on current audio state — keeping that decision in the audio layer
 * rather than in the UI hook.
 */
export function executeFadeTap(pad: Pad, globalFadeDurationMs?: number): void {
  if (!isFadeablePad(pad)) return;
  const duration = resolveFadeDuration(pad, globalFadeDurationMs);
  applyFadeToggle(pad, duration).catch((err: unknown) => {
    emitAudioError(err);
  });
}

/**
 * Orchestration entry point for crossfade execution.
 * Splits the selected pads into fading-out (currently playing) and
 * fading-in (not playing) groups using live audio state, then delegates
 * to crossfadePads — keeping playback-state queries in the audio layer.
 */
export function executeCrossfadeSelection(selectedPads: Pad[], globalFadeDurationMs?: number): void {
  const fadeablePads = selectedPads.filter(isFadeablePad);
  const fadingOut = fadeablePads.filter((p) => isPadActive(p.id));
  const fadingIn = fadeablePads.filter((p) => !isPadActive(p.id));
  crossfadePads(fadingOut, fadingIn, globalFadeDurationMs);
}

/**
 * Update the loop flag on any active voices for a layer.
 *
 * For non-chained arrangements: sets `source.loop` / `audio.loop` live so the
 * current pass plays to natural completion instead of stopping immediately.
 * For chained arrangements transitioning *away* from a looping mode: the loop
 * flag is irrelevant (onended drives restart), so we clear the chain queue.
 * When the current voice ends, `onended` sees `remaining === undefined` and
 * skips the restart. Transitions *into* a looping mode on chained arrangements
 * take effect at the next natural chain boundary — the onended closure reads
 * playbackMode from the live store rather than the captured layer object.
 *
 * No-op if the layer has no active voices.
 */
export function syncLayerPlaybackMode(layer: import("@/lib/schemas").Layer): void {
  const voices = getLayerVoices(layer.id);
  if (voices.length === 0) return;
  const isLoopMode = layer.playbackMode === "loop" || layer.playbackMode === "hold";

  // Update the loop flag on non-chained voices and cycle-mode voices.
  // Cycle mode plays one sound at a time (like simultaneous), so source.loop
  // is used instead of chain-based looping.
  const shouldLoop = isLoopMode && (!isChained(layer.arrangement) || layer.cycleMode);
  for (const voice of voices) {
    voice.setLoop(shouldLoop);
  }
  // For chained arrangements (non-cycle) transitioning away from a looping mode,
  // clear the chain queue so the onended callback sees remaining === undefined
  // and skips the restart.
  if (!isLoopMode && isChained(layer.arrangement) && !layer.cycleMode) {
    deleteLayerChain(layer.id);
  }
}

/**
 * Called when the arrangement type for a layer changes while playback is active.
 *
 * - Chained -> chained (sequential <-> shuffled): rebuilds the chain queue with the
 *   new arrangement so the current sound plays out and the updated sequence follows.
 * - Chained -> non-chained: clears the queue so onended does not advance the stale chain.
 *
 * No-op if the layer has no active voices.
 */
export function syncLayerArrangement(layer: import("@/lib/schemas").Layer): void {
  const voices = getLayerVoices(layer.id);
  if (voices.length === 0) return;

  if (isChained(layer.arrangement)) {
    const allSounds = resolveSounds(layer, useLibraryStore.getState().sounds);
    const newOrder = buildPlayOrder(layer.arrangement, allSounds);
    if (newOrder.length === 0) {
      deleteLayerChain(layer.id);
    } else {
      setLayerChain(layer.id, newOrder);
    }
  } else {
    // Switching to non-chained (simultaneous): replace the stale chain with an empty
    // array so onended treats it as natural exhaustion rather than an external stop.
    setLayerChain(layer.id, []);
  }
}

/**
 * Structural equality check for LayerSelection — avoids JSON.stringify overhead.
 * Compares all fields that affect playback resolution (sounds, volume, match rules).
 */
export function selectionsEqual(a: import("@/lib/schemas").LayerSelection, b: import("@/lib/schemas").LayerSelection): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case "assigned": {
      const bA = b as Extract<import("@/lib/schemas").LayerSelection, { type: "assigned" }>;
      if (a.instances.length !== bA.instances.length) return false;
      return a.instances.every(
        (inst, i) =>
          inst.soundId === bA.instances[i].soundId &&
          inst.id === bA.instances[i].id &&
          inst.volume === bA.instances[i].volume &&
          inst.startOffsetMs === bA.instances[i].startOffsetMs,
      );
    }
    case "tag": {
      const bT = b as Extract<import("@/lib/schemas").LayerSelection, { type: "tag" }>;
      return (
        a.matchMode === bT.matchMode &&
        a.defaultVolume === bT.defaultVolume &&
        a.tagIds.length === bT.tagIds.length &&
        a.tagIds.every((id, i) => id === bT.tagIds[i])
      );
    }
    case "set": {
      const bS = b as Extract<import("@/lib/schemas").LayerSelection, { type: "set" }>;
      return a.setId === bS.setId && a.defaultVolume === bS.defaultVolume;
    }
  }
}

/**
 * Called when the sound selection for a layer changes while playback is active.
 *
 * For chained arrangements: rebuilds the chain queue with the new resolved sounds.
 * For non-chained arrangements: no-op — onended re-resolves sounds from the live store.
 *
 * No-op if the layer has no active voices.
 */
export function syncLayerSelection(layer: import("@/lib/schemas").Layer): void {
  const voices = getLayerVoices(layer.id);
  if (voices.length === 0) return;

  if (isChained(layer.arrangement)) {
    const allSounds = resolveSounds(layer, useLibraryStore.getState().sounds);
    const newOrder = buildPlayOrder(layer.arrangement, allSounds);
    if (newOrder.length === 0) {
      deleteLayerChain(layer.id);
    } else {
      setLayerChain(layer.id, newOrder);
    }
  }
}

/**
 * Sync all live-playback state for a layer after a pad config save.
 * Calls syncLayerPlaybackMode, syncLayerArrangement, and/or syncLayerSelection
 * only for the fields that actually changed.
 */
export function syncLayerConfig(layer: import("@/lib/schemas").Layer, original: import("@/lib/schemas").Layer): void {
  if (original.playbackMode !== layer.playbackMode) syncLayerPlaybackMode(layer);
  const arrangementChanged = original.arrangement !== layer.arrangement;
  if (arrangementChanged) syncLayerArrangement(layer);
  // syncLayerArrangement already rebuilds the queue using the updated selection,
  // so skip syncLayerSelection to avoid a redundant rebuild — especially important
  // for shuffled, where a second call would produce a different random order.
  if (!arrangementChanged && !selectionsEqual(original.selection, layer.selection)) {
    syncLayerSelection(layer);
  }
  // When cycleMode is toggled off, clear the stale cursor so the next trigger
  // starts a normal chain instead of using a leftover index.
  if (original.cycleMode && !layer.cycleMode) {
    deleteLayerCycleIndex(layer.id);
  }
}

/** Stop a single pad, clearing its layer chain queues, cycle cursors, and play orders first so onended doesn't advance the chain. */
export function stopPad(pad: Pad): void {
  cancelPadFade(pad.id);
  usePlaybackStore.getState().removeFadingOutPad(pad.id);
  for (const layer of pad.layers) {
    deleteLayerChain(layer.id);
    deleteLayerCycleIndex(layer.id);
    deleteLayerPlayOrder(layer.id);
  }
  stopPadVoices(pad.id);
}

/** Stop all pads in a scene, clearing their chain queues before stopping voices. */
export function stopScene(scene: Scene): void {
  for (const pad of scene.pads) {
    stopPad(pad);
  }
}

/**
 * Stop all active pads with a short gain ramp to avoid clicks.
 *
 * Clears chain queues and fade tracking first, nulls onended callbacks to
 * prevent loop restarts during the ramp window, then ramps all pad gains to
 * zero before stopping voices.
 */
export function stopAllPads(): void {
  clearAllFadeTracking();
  clearAllLayerChains();
  clearAllLayerCycleIndexes();
  clearAllLayerPlayOrders();
  clearAllLayerPending();
  // Null all onended callbacks — prevents loop restarts during ramp window
  nullAllOnEnded();
  stopAudioTick(); // immediately clear bars before the STOP_RAMP_S window

  const ctx = getAudioContext();
  forEachPadGain((_padId, gain) => {
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + STOP_RAMP_S);
  });
  // Track this timeout so clearAllAudioState() can cancel it if project close
  // fires before the ramp completes — prevents stale cleanup from touching a
  // new audio session.
  const stopTimeoutId = setTimeout(() => {
    cancelGlobalStopTimeout(); // clear the tracker (timeout already fired)
    clearAllStreamingAudio();
    clearAllPadProgressInfo();
    clearAllLayerProgressInfo();
    clearAllLayerGains();
    clearAllPadGains();
    stopAllVoices();
  }, STOP_RAMP_S * 1000 + 5);
  setGlobalStopTimeout(stopTimeoutId);
}

export function releasePadHoldLayers(pad: Pad): void {
  for (const layer of pad.layers) {
    if (layer.playbackMode !== "hold") continue;

    // Clear chain queue first — prevents onended from restarting the chain
    deleteLayerChain(layer.id);

    const voices = [...getLayerVoices(layer.id)];
    if (voices.length === 0) continue;

    // rampStopLayerVoices nulls onended before stopping, so the cleanup callback
    // won't fire — delete the layer's streaming entry explicitly.
    clearLayerStreamingAudio(pad.id, layer.id);
    rampStopLayerVoices(pad.id, layer, voices);
  }
}

// startVolume: 0-1. Defaults to pad.fadeHighVol so the pad plays at its configured level.
// Pass 0 explicitly for silent-start gesture-drag and fade-in operations.
export async function triggerPad(pad: Pad, startVolume?: number): Promise<void> {
  const startVol = startVolume ?? pad.fadeHighVol ?? 1.0;
  const { sounds } = useLibraryStore.getState();
  const ctx = await ensureResumed();
  const padGain = getPadGain(pad.id);
  // Cancel any in-progress fade-out so its cleanup setTimeout cannot kill voices
  // that are about to be started below.
  cancelPadFade(pad.id);
  padGain.gain.cancelScheduledValues(ctx.currentTime);
  padGain.gain.setValueAtTime(startVol, ctx.currentTime);
  // Tick reads gain node value automatically — no store call needed.

  // Pre-collect eligible layers and set their pending flags synchronously before any await.
  // This closes the race window: a rapid re-trigger arriving during async work will see
  // isLayerPending(layer.id)===true and be correctly debounced.
  type LayerWork = { layer: (typeof pad.layers)[number]; resolved: ReturnType<typeof resolveSounds> };
  const layerWork: LayerWork[] = [];
  for (const layer of pad.layers) {
    const resolved = resolveSounds(layer, sounds);
    if (resolved.length === 0) continue;
    if (isLayerPending(layer.id)) continue;
    setLayerPending(layer.id);
    layerWork.push({ layer, resolved });
  }

  if (layerWork.length === 0) return;

  // Clear pad progress once before any layer starts playback. In the sequential version this
  // was guarded by a progressCleared flag; here we clear once upfront so no parallel layer
  // can accidentally erase progress info that a sibling layer already wrote via setPadProgressInfo.
  // Note: applyRetriggerMode internally calls clearPadProgressInfo for retriggerMode "next"
  // chains — that path is inherently serial within a layer and races only in the unlikely
  // case of two layers simultaneously hitting "next" mode.
  clearPadProgressInfo(pad.id);

  // Run all eligible layers in parallel. Each layer is independent — all per-layer state
  // (gains, voices, chains, cycle indexes) is keyed by layerId with no cross-layer reads.
  await Promise.all(
    layerWork.map(async ({ layer, resolved }) => {
      try {
        const isLayerPlaying = isLayerActive(layer.id);
        const layerGain = getOrCreateLayerGain(layer.id, getLayerNormalizedVolume(layer), padGain);

        const action = await applyRetriggerMode(pad, layer, isLayerPlaying, ctx, layerGain, resolved);
        // triggerPad does not pass afterStopCleanup — pad-level playback store state
        // is managed globally (stopAllPads / clearVoice).
        if (action === "skip" || action === "chain-advanced") {
          clearLayerPending(layer.id);
          return;
        }

        await startLayerPlayback(pad, layer, ctx, layerGain, resolved);
        // startLayerPlayback clears pending in its finally block — no explicit clear needed here.
      } catch (err) {
        // Unexpected failures in one layer must not block sibling layers or leave pending set.
        clearLayerPending(layer.id);
        emitAudioError(err);
      }
    }),
  );
}

/** Trigger a single layer of a pad in isolation, respecting retrigger mode/arrangement/selection. */
export async function triggerLayer(pad: Pad, layer: import("@/lib/schemas").Layer): Promise<void> {
  const { sounds } = useLibraryStore.getState();
  const resolved = resolveSounds(layer, sounds);
  if (resolved.length === 0) return;
  // Set pending synchronously BEFORE any await to close the race window between
  // the check and the first await point.
  if (isLayerPending(layer.id)) return;
  setLayerPending(layer.id);

  try {
    const ctx = await ensureResumed();
    const padGain = getPadGain(pad.id);
    // Cancel any in-progress fade-out so its cleanup setTimeout cannot kill voices
    // that are about to be started below (same fix as triggerPad).
    cancelPadFade(pad.id);
    const isPlaying = isLayerActive(layer.id);
    const layerGain = getOrCreateLayerGain(layer.id, getLayerNormalizedVolume(layer), padGain);

    const action = await applyRetriggerMode(
      pad, layer, isPlaying, ctx, layerGain, resolved,
      // triggerLayer-specific: after a "stop"-mode ramp-stop, check if the pad
      // still has any active voices and remove it from the playing-pads set if not.
      () => {
        const timeoutId = setTimeout(() => {
          deleteStopCleanupTimeout(timeoutId);
          if (!isPadActive(pad.id)) {
            usePlaybackStore.getState().removePlayingPad(pad.id);
            usePlaybackStore.getState().removeFadingOutPad(pad.id);
          }
        }, STOP_RAMP_S * 1000 + 10);
        addStopCleanupTimeout(timeoutId);
      },
    );

    if (action === "skip") {
      return;
    }
    if (action === "chain-advanced") {
      usePlaybackStore.getState().addPlayingPad(pad.id);
      return;
    }

    clearPadProgressInfo(pad.id);
    await startLayerPlayback(pad, layer, ctx, layerGain, resolved);
    usePlaybackStore.getState().addPlayingPad(pad.id);
  } finally {
    // Safety net: clearLayerPending is idempotent.
    // Guards against unexpected throws from ensureResumed or applyRetriggerMode
    // before startLayerPlayback's own finally can run.
    clearLayerPending(layer.id);
  }
}

// ---------------------------------------------------------------------------
// Per-layer live controls (stop, skip)
// ---------------------------------------------------------------------------

/** Stop all voices for a specific layer with a short gain ramp. Cleans up pad playing state if no layers remain active. */
export function stopLayerWithRamp(pad: Pad, layerId: string): void {
  const layer = pad.layers.find((l) => l.id === layerId);
  if (!layer) return;

  deleteLayerChain(layerId);
  deleteLayerPlayOrder(layerId);
  clearLayerStreamingAudio(pad.id, layerId);

  const voices = [...getLayerVoices(layerId)];
  if (voices.length === 0) return;
  rampStopLayerVoices(pad.id, layer, voices);

  // After the ramp completes, check if any layers are still active for this pad
  const stopCleanupId = setTimeout(() => {
    deleteStopCleanupTimeout(stopCleanupId);
    if (!isPadActive(pad.id)) {
      usePlaybackStore.getState().removePlayingPad(pad.id);
      usePlaybackStore.getState().removeFadingOutPad(pad.id);
    }
  }, STOP_RAMP_S * 1000 + 10);
  addStopCleanupTimeout(stopCleanupId);
}

/** Skip forward in a sequential/shuffled chain. No-op for simultaneous arrangement or if at end of chain. */
export function skipLayerForward(pad: Pad, layerId: string): void {
  const layer = pad.layers.find((l) => l.id === layerId);
  if (!layer) return;
  if (!isChained(layer.arrangement)) return;

  const { sounds } = useLibraryStore.getState();
  const resolved = resolveSounds(layer, sounds);
  if (resolved.length === 0) return;

  if (layer.cycleMode) {
    // Cycle mode uses cycleIndex, not the chain queue.
    // Read playOrder before stop (stop deletes it).
    const playOrder = getLayerPlayOrder(layerId) ?? buildPlayOrder(layer.arrangement, resolved);
    const n = playOrder.length;
    // cycleIndex points to the NEXT sound after the one currently playing.
    const curCycleIdx = getLayerCycleIndex(layerId) ?? 0;
    // "Next" is what cycleIndex currently points to; advance cursor past it.
    const nextIdx = curCycleIdx % n;
    const newCycleIdx = (curCycleIdx + 1) % n;

    stopLayerWithRamp(pad, layerId);

    // Re-persist playOrder so subsequent skip backs can calculate position correctly.
    setLayerPlayOrder(layerId, playOrder);
    setLayerCycleIndex(layerId, newCycleIdx);
    const sound = playOrder[nextIdx];

    // Cancel any in-progress fade-out so its cleanup setTimeout cannot kill the
    // newly-started skip voice (same fix as triggerPad / triggerLayer in PR #248).
    cancelPadFade(pad.id);
    ensureResumed().then((ctx) => {
      const padGain = getPadGain(pad.id);
      const layerGain = getOrCreateLayerGain(layerId, getLayerNormalizedVolume(layer), padGain);
      startLayerSound(pad, layer, sound, ctx, layerGain, getVoiceVolume(layer, sound), resolved);
      usePlaybackStore.getState().addPlayingPad(pad.id);
    }).catch((err: unknown) => { emitAudioError(err); });
  } else {
    // Regular chained mode: advance via the chain queue.
    // Read both BEFORE stop (stop deletes them).
    const playOrder = getLayerPlayOrder(layerId);
    const remaining = getLayerChain(layerId);

    stopLayerWithRamp(pad, layerId);

    if (!remaining || remaining.length === 0) return;

    const [next, ...rest] = remaining;

    // Re-persist playOrder so subsequent skip backs can calculate position correctly.
    if (playOrder) setLayerPlayOrder(layerId, playOrder);
    setLayerChain(layerId, rest);

    // Cancel any in-progress fade-out so its cleanup setTimeout cannot kill the
    // newly-started skip voice (same fix as triggerPad / triggerLayer in PR #248).
    cancelPadFade(pad.id);
    ensureResumed().then((ctx) => {
      const padGain = getPadGain(pad.id);
      const layerGain = getOrCreateLayerGain(layerId, getLayerNormalizedVolume(layer), padGain);
      startLayerSound(pad, layer, next, ctx, layerGain, getVoiceVolume(layer, next), resolved);
      usePlaybackStore.getState().addPlayingPad(pad.id);
    }).catch((err: unknown) => { emitAudioError(err); });
  }
}

/**
 * Fade a pad in or out based on its current playback state.
 *
 * Uses pad.fadeLowVol (lower endpoint) and pad.fadeHighVol (higher endpoint),
 * defaulting to 0 and 1. The toggle direction is determined by current audio state.
 */
export function fadePadWithLevels(pad: Pad, duration: number): Promise<void> {
  return applyFadeToggle(pad, duration);
}

/** Skip back in a sequential/shuffled chain. No-op for simultaneous arrangement. */
export function skipLayerBack(pad: Pad, layerId: string): void {
  const layer = pad.layers.find((l) => l.id === layerId);
  if (!layer) return;
  if (!isChained(layer.arrangement)) return;

  const { sounds } = useLibraryStore.getState();
  const resolved = resolveSounds(layer, sounds);
  if (resolved.length === 0) return;

  if (layer.cycleMode) {
    // Cycle mode uses cycleIndex, not the chain queue.
    // Read playOrder before stop (stop deletes it).
    const playOrder = getLayerPlayOrder(layerId) ?? buildPlayOrder(layer.arrangement, resolved);
    const n = playOrder.length;
    // cycleIndex points to the NEXT sound after the one currently playing.
    // Currently playing is at (cycleIndex - 1 + n) % n.
    // Previous is at (cycleIndex - 2 + n) % n.
    // After skip back, next trigger should replay current → set cycleIndex to (cycleIndex - 1 + n) % n.
    const curCycleIdx = getLayerCycleIndex(layerId) ?? 0;
    const prevIdx = (curCycleIdx - 2 + n) % n;
    const newCycleIdx = (curCycleIdx - 1 + n) % n;

    stopLayerWithRamp(pad, layerId);

    // Re-persist playOrder so subsequent skips can calculate position correctly.
    setLayerPlayOrder(layerId, playOrder);
    setLayerCycleIndex(layerId, newCycleIdx);
    const sound = playOrder[prevIdx];

    // Cancel any in-progress fade-out so its cleanup setTimeout cannot kill the
    // newly-started skip voice (same fix as triggerPad / triggerLayer in PR #248).
    cancelPadFade(pad.id);
    ensureResumed().then((ctx) => {
      const padGain = getPadGain(pad.id);
      const layerGain = getOrCreateLayerGain(layerId, getLayerNormalizedVolume(layer), padGain);
      startLayerSound(pad, layer, sound, ctx, layerGain, getVoiceVolume(layer, sound), resolved);
      usePlaybackStore.getState().addPlayingPad(pad.id);
    }).catch((err: unknown) => { emitAudioError(err); });
  } else {
    // Regular chained mode: calculate position from playOrder + remaining chain.
    // Read BEFORE stop (stop deletes both).
    const playOrder = getLayerPlayOrder(layerId);
    const chain = getLayerChain(layerId);

    stopLayerWithRamp(pad, layerId);

    if (!playOrder || playOrder.length === 0) return;

    // currentPos = index of the sound that was playing (or last if chain exhausted)
    const currentPos = Math.max(0, playOrder.length - (chain?.length ?? 0) - 1);
    const prevIndex = Math.max(0, currentPos - 1);

    // Re-persist playOrder so subsequent skips can calculate position correctly.
    setLayerPlayOrder(layerId, playOrder);
    // Rebuild chain from prevIndex+1 onward so the sequence continues naturally.
    setLayerChain(layerId, playOrder.slice(prevIndex + 1));
    const sound = playOrder[prevIndex];

    // Cancel any in-progress fade-out so its cleanup setTimeout cannot kill the
    // newly-started skip voice (same fix as triggerPad / triggerLayer in PR #248).
    cancelPadFade(pad.id);
    ensureResumed().then((ctx) => {
      const padGain = getPadGain(pad.id);
      const layerGain = getOrCreateLayerGain(layerId, getLayerNormalizedVolume(layer), padGain);
      startLayerSound(pad, layer, sound, ctx, layerGain, getVoiceVolume(layer, sound), resolved);
      usePlaybackStore.getState().addPlayingPad(pad.id);
    }).catch((err: unknown) => { emitAudioError(err); });
  }
}
