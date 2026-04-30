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
  clearAllLayerPending,
  clearAllLayerPlayOrders,
  clearAllStreamingAudio,
  clearAllPadProgressInfo,
  clearAllLayerProgressInfo,
  clearLayerPending,
  clearLayerStreamingAudio,
  clearPadProgressInfo,
  deleteLayerChain,
  deleteLayerCycleIndex,
  deleteLayerPlayOrder,
  forEachActivePadGain,
  getActivePadIds,
  getAllVoices,
  getLayerChain,
  getLayerCycleIndex,
  getLayerIdsForPads,
  getLayerPlayOrder,
  getLayerVoices,
  getOrCreateLayerGain,
  getPadGain,
  clearInactivePadGains,
  clearLayerGainsForIds,
  clearPadGainsForIds,
  stopSpecificVoices,
  isLayerPending,
  isPadActive,
  isPadFading,
  isPadFadingOut,
  isPadFadingIn,
  nullAllOnEnded,
  setGlobalStopTimeout,
  setLayerChain,
  setLayerCycleIndex,
  setLayerPending,
  setLayerPlayOrder,
  getPadFadeFromVolume,
} from "./audioState";

import {
  resolveFadeDuration,
  fadePad,
  fadePadIn,
  stopPadInternal,
} from "./fadeMixer";

import { rampGainTo } from "./gainManager";

import {
  startLayerSound,
  rampStopLayerVoices,
  resolveSounds,
  getVoiceVolume,
  getLayerNormalizedVolume,
  triggerLayerOfPad,
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

// Re-export functions moved to fadeMixer / gainManager
export {
  freezePadAtCurrentVolume,
  resolveFadeDuration,
  fadePad,
} from "./fadeMixer";

export {
  setPadVolume,
  resetPadGain,
  syncLayerVolume,
  setLayerVolume,
} from "./gainManager";

export async function triggerAndFade(pad: Pad, toVolume: number, durationMs: number): Promise<void> {
  return fadePadIn(pad, toVolume, durationMs, (p) => triggerPad(p, 0));
}

/**
 * Reverse a fade that is currently in progress.
 *
 * - Fading down (toward fadeTargetVol): ramps back up to pad.volume.
 * - Fading up (gain still above fadeTargetVol): ramps back down to fadeTargetVol.
 * - Fading up (gain at or below fadeTargetVol): stops the pad.
 */
export function reverseFade(pad: Pad, globalFadeDurationMs?: number): void {
  if (!isPadFading(pad.id)) return;
  const duration = resolveFadeDuration(pad, globalFadeDurationMs);
  const reverseTarget = getPadFadeFromVolume(pad.id);
  if (reverseTarget === undefined) return;

  const padVolumes = usePlaybackStore.getState().padVolumes;
  const currentVol = padVolumes[pad.id] ?? reverseTarget;

  fadePad(pad, currentVol, reverseTarget, duration);
  usePlaybackStore.getState().addReversingPad(pad.id);
}

export function crossfadePads(fadingOut: Pad[], fadingIn: Pad[], globalFadeDurationMs?: number): void {
  const padVolumes = usePlaybackStore.getState().padVolumes;
  fadingOut.forEach((pad) => {
    const currentVol = padVolumes[pad.id] ?? ((pad.volume ?? 100) / 100);
    fadePad(pad, currentVol, (pad.fadeTargetVol ?? 0) / 100, resolveFadeDuration(pad, globalFadeDurationMs));
  });
  fadingIn.forEach((pad) =>
    triggerAndFade(pad, 1.0, resolveFadeDuration(pad, globalFadeDurationMs)).catch((err: unknown) => {
      emitAudioError(err);
    })
  );
}

/**
 * Central fade-toggle state machine — all fade trigger paths route through here.
 *
 * Four cases in priority order:
 *   1. Any in-progress fade     → reverse: fading out → ramp to highVol; fading in → ramp to lowVol.
 *   2. Active, settled at low   → ramp to highVol.
 *   3. Active, not at low       → ramp to lowVol.
 *   4. Not active               → trigger at silence then ramp up to lowVol.
 */
function applyFadeToggle(pad: Pad, duration: number): Promise<void> {
  const lowVol = (pad.fadeTargetVol ?? 0) / 100;
  const highVol = (pad.volume ?? 100) / 100;

  if (isPadActive(pad.id)) {
    if (isPadFadingOut(pad.id) || isPadFadingIn(pad.id) || isPadFading(pad.id)) {
      const reverseTarget = getPadFadeFromVolume(pad.id);
      const padVolumes = usePlaybackStore.getState().padVolumes;
      const currentVol = padVolumes[pad.id] ?? (reverseTarget ?? highVol);
      const targetVol = reverseTarget ?? (isPadFadingOut(pad.id) ? highVol : lowVol);
      fadePad(pad, currentVol, targetVol, duration);
    } else {
      // Settled: no ramp running, gain.gain.value is the static current position.
      const currentVol = getPadGain(pad.id).gain.value;
      const atLow = Math.abs(currentVol - lowVol) <= 0.02;
      fadePad(pad, currentVol, atLow ? highVol : lowVol, duration);
    }
    return Promise.resolve();
  }

  // Not active: if a trigger-and-fade is already in flight, ignore
  if (isPadFadingIn(pad.id) || isPadFading(pad.id)) return Promise.resolve();

  return triggerAndFade(pad, lowVol, duration);
}

/**
 * Orchestration entry point for a single-pad fade tap (fade mode).
 * Determines whether to reverse a fade-out, start a fade-out, or fade in
 * based on current audio state — keeping that decision in the audio layer
 * rather than in the UI hook.
 */
/**
 * Cancel an in-progress fade, freezing the gain at the current ramp position.
 * Uses the last RAF-sampled volume from the store rather than gain.gain.value
 * to avoid anchoring back to the ramp's start point.
 */
export function stopFade(pad: Pad): void {
  const padVolumes = usePlaybackStore.getState().padVolumes;
  const currentVol = padVolumes[pad.id] ?? ((pad.volume ?? 100) / 100);
  const ctx = getAudioContext();
  const gain = getPadGain(pad.id);
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(currentVol, ctx.currentTime);
  cancelPadFade(pad.id);
}

export function executeFadeTap(pad: Pad, globalFadeDurationMs?: number): void {
  if (!isFadeablePad(pad)) return;
  const lowVol = (pad.fadeTargetVol ?? 0) / 100;
  // Fading in a non-playing pad to silence is a no-op
  if (!isPadActive(pad.id) && lowVol === 0) return;
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
  stopPadInternal(pad);
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

  // Snapshot active pads and voices before the ramp starts so the cleanup
  // timeout can scope its work — pads triggered during the ramp window are
  // excluded from cleanup (their gain nodes and voices are left intact).
  const stoppedPadIds = getActivePadIds();
  const stoppedVoices = getAllVoices();

  // Immediately disconnect stale (inactive) pad gain nodes — they have no
  // voices so no ramp is needed; same-tick removal shrinks the race window.
  clearInactivePadGains();

  forEachActivePadGain((_padId, gain) => {
    rampGainTo(gain.gain, 0, STOP_RAMP_S);
  });
  // Track this timeout so clearAllAudioState() can cancel it if project close
  // fires before the ramp completes — prevents stale cleanup from touching a
  // new audio session.
  const stopTimeoutId = setTimeout(() => {
    cancelGlobalStopTimeout(); // clear the tracker (timeout already fired)
    clearAllStreamingAudio();
    clearAllPadProgressInfo();
    clearAllLayerProgressInfo();
    clearLayerGainsForIds(getLayerIdsForPads(stoppedPadIds));
    clearPadGainsForIds(stoppedPadIds);
    stopSpecificVoices(stoppedVoices, stoppedPadIds);
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

// startVolume: 0-1. Defaults to pad.volume (0-100) divided by 100 so the pad plays at its configured level.
// Pass 0 explicitly for silent-start gesture-drag and fade-in operations.
export async function triggerPad(pad: Pad, startVolume?: number): Promise<void> {
  const startVol = startVolume ?? ((pad.volume ?? 100) / 100);
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
  // triggerPad does not pass afterStopCleanup — pad-level playback store state is managed
  // globally (stopAllPads / clearVoice). clearProgressOnProceed is omitted: progress is
  // cleared once upfront above so parallel layers don't erase each other's progress writes.
  // .catch is a defensive guard: triggerLayerOfPad never rejects in practice (its own
  // catch handles all errors), but the explicit .catch prevents a future regression where
  // an escape path causes Promise.all to reject and abandon remaining sibling layers.
  await Promise.all(
    layerWork.map(({ layer, resolved }) =>
      triggerLayerOfPad(pad, layer, ctx, padGain, resolved).catch(emitAudioError),
    ),
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

    await triggerLayerOfPad(pad, layer, ctx, padGain, resolved, {
      // triggerLayer-specific: after a "stop"-mode ramp-stop, check if the pad
      // still has any active voices and remove it from the playing-pads set if not.
      afterStopCleanup: () => {
        const timeoutId = setTimeout(() => {
          deleteStopCleanupTimeout(timeoutId);
          if (!isPadActive(pad.id)) {
            usePlaybackStore.getState().removePlayingPad(pad.id);
            cancelPadFade(pad.id);
          }
        }, STOP_RAMP_S * 1000 + 10);
        addStopCleanupTimeout(timeoutId);
      },
      // Single-layer path: clear progress right before starting so the bar resets
      // while the buffer loads. triggerPad clears upfront for all parallel layers instead.
      clearProgressOnProceed: true,
    });
  } finally {
    // Safety net: clearLayerPending is idempotent.
    // Guards against unexpected throws from ensureResumed before triggerLayerOfPad runs.
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
      cancelPadFade(pad.id);
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
