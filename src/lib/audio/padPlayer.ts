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
  isPadFadingOut,
  nullAllOnEnded,
  setFadePadTimeout,
  setGlobalStopTimeout,
  setLayerChain,
  setLayerCycleIndex,
  setLayerPending,
  setLayerPlayOrder,
  stopAllVoices,
  stopPadVoices,
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
  // 1. Cancel any prior fade for this pad
  cancelPadFade(pad.id);

  const startVol = fromVolume ?? 0;
  const endVol = toVolume ?? 1.0;

  // 2. Start pad at gain startVol
  await triggerPad(pad, startVol);

  const ctx = getAudioContext();
  const gain = getPadGain(pad.id);

  // 3. Schedule Web Audio ramp
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(startVol, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(endVol, ctx.currentTime + durationMs / 1000);

  // 4. Completion cleanup — stored in fadePadTimeouts so cancelPadFade can cancel it
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
 * Orchestration entry point for a single-pad fade tap (fade mode).
 * Determines whether to reverse a fade-out, start a fade-out, or fade in
 * based on current audio state — keeping that decision in the audio layer
 * rather than in the UI hook.
 */
export function executeFadeTap(pad: Pad, globalFadeDurationMs?: number, fromVolume?: number, toVolume?: number): void {
  if (!isFadeablePad(pad)) return;
  const duration = resolveFadeDuration(pad, globalFadeDurationMs);
  if (isPadActive(pad.id)) {
    if (isPadFadingOut(pad.id)) {
      fadePadInFromCurrent(pad, duration, toVolume);
    } else {
      fadePadOut(pad, duration, fromVolume, toVolume);
    }
  } else {
    fadePadIn(pad, duration, fromVolume, toVolume).catch((err: unknown) => {
      emitAudioError(err);
    });
  }
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
  if (!arrangementChanged && JSON.stringify(original.selection) !== JSON.stringify(layer.selection)) {
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

// startVolume: 0-1. Pass 0 for drag-up gestures (silent start), defaults to 1.
export async function triggerPad(pad: Pad, startVolume = 1.0): Promise<void> {
  const { sounds } = useLibraryStore.getState();
  const ctx = await ensureResumed();
  const padGain = getPadGain(pad.id);
  padGain.gain.cancelScheduledValues(ctx.currentTime);
  padGain.gain.setValueAtTime(startVolume, ctx.currentTime);
  // Tick reads gain node value automatically — no store call needed.

  let progressCleared = false;

  for (const layer of pad.layers) {
    const resolved = resolveSounds(layer, sounds);
    if (resolved.length === 0) continue;

    // Leading debounce — if startLayerSound is in-flight for this layer, ignore the trigger.
    // Set pending synchronously BEFORE any await to close the race window between the
    // check and the first await point.
    if (isLayerPending(layer.id)) continue;
    setLayerPending(layer.id);

    try {
      const isLayerPlaying = isLayerActive(layer.id);
      const layerGain = getOrCreateLayerGain(layer.id, layer.volume / 100, padGain);

      const action = await applyRetriggerMode(pad, layer, isLayerPlaying, ctx, layerGain, resolved);
      // triggerPad does not pass afterStopCleanup — pad-level playback store state
      // is managed globally (stopAllPads / clearVoice).
      if (action === "skip" || action === "chain-advanced") {
        clearLayerPending(layer.id);
        continue;
      }

      if (!progressCleared) {
        clearPadProgressInfo(pad.id);
        progressCleared = true;
      }
      await startLayerPlayback(pad, layer, ctx, layerGain, resolved);
      // startLayerPlayback clears pending in its finally block — no explicit clear needed here.
    } catch (err) {
      // Unexpected failures in one layer must not block sibling layers or leave pending set.
      clearLayerPending(layer.id);
      emitAudioError(err);
    }
  }
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
    const isPlaying = isLayerActive(layer.id);
    const layerGain = getOrCreateLayerGain(layer.id, layer.volume / 100, padGain);

    const action = await applyRetriggerMode(
      pad, layer, isPlaying, ctx, layerGain, resolved,
      // triggerLayer-specific: after a "stop"-mode ramp-stop, check if the pad
      // still has any active voices and remove it from the playing-pads set if not.
      () => setTimeout(() => {
        if (!isPadActive(pad.id)) {
          usePlaybackStore.getState().removePlayingPad(pad.id);
        }
      }, STOP_RAMP_S * 1000 + 10),
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
  setTimeout(() => {
    if (!isPadActive(pad.id)) {
      usePlaybackStore.getState().removePlayingPad(pad.id);
    }
  }, STOP_RAMP_S * 1000 + 10);
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

    ensureResumed().then((ctx) => {
      const padGain = getPadGain(pad.id);
      const layerGain = getOrCreateLayerGain(layerId, layer.volume / 100, padGain);
      startLayerSound(pad, layer, sound, ctx, layerGain, getVoiceVolume(layer, sound), resolved);
      usePlaybackStore.getState().addPlayingPad(pad.id);
    });
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

    ensureResumed().then((ctx) => {
      const padGain = getPadGain(pad.id);
      const layerGain = getOrCreateLayerGain(layerId, layer.volume / 100, padGain);
      startLayerSound(pad, layer, next, ctx, layerGain, getVoiceVolume(layer, next), resolved);
      usePlaybackStore.getState().addPlayingPad(pad.id);
    });
  }
}

/**
 * Fade a pad in or out based on its current playback state, using slider-convention level endpoints.
 *
 * Level convention (matches the UI slider layout):
 *   - `fromLevel` is the LEFT thumb — the LOWER volume endpoint (end of fade-out / start of fade-in)
 *   - `toLevel` is the RIGHT thumb — the HIGHER volume endpoint (start of fade-out / end of fade-in)
 *
 * When the pad is PLAYING (fade-out): fades from `toLevel` → `fromLevel` (high → low).
 * When the pad is NOT PLAYING (fade-in): fades from `fromLevel` → `toLevel` (low → high).
 */
export function fadePadWithLevels(
  pad: Pad,
  duration: number,
  fromLevel: number,
  toLevel: number,
): Promise<void> {
  const playing = isPadActive(pad.id);
  if (playing) {
    // fromLevel is the lower end-level, toLevel is the higher start-level (per UI convention)
    // fadePadOut expects (fromVolume=start/current, toVolume=end/lower)
    fadePadOut(pad, duration, toLevel, fromLevel);
    return Promise.resolve();
  } else {
    return fadePadIn(pad, duration, fromLevel, toLevel);
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

    ensureResumed().then((ctx) => {
      const padGain = getPadGain(pad.id);
      const layerGain = getOrCreateLayerGain(layerId, layer.volume / 100, padGain);
      startLayerSound(pad, layer, sound, ctx, layerGain, getVoiceVolume(layer, sound), resolved);
      usePlaybackStore.getState().addPlayingPad(pad.id);
    });
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

    ensureResumed().then((ctx) => {
      const padGain = getPadGain(pad.id);
      const layerGain = getOrCreateLayerGain(layerId, layer.volume / 100, padGain);
      startLayerSound(pad, layer, sound, ctx, layerGain, getVoiceVolume(layer, sound), resolved);
      usePlaybackStore.getState().addPlayingPad(pad.id);
    });
  }
}
