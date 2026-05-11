import { ensureResumed, getAudioContext } from "./audioContext";
import { STOP_RAMP_S } from "./audioVoice";
import { useLibraryStore } from "@/state/libraryStore";
import { usePlaybackStore } from "@/state/playbackStore";
import { usePadDisplayStore } from "@/state/padDisplayStore";
import { usePadMetricsStore } from "@/state/padMetricsStore";
import type { Pad, Scene } from "@/lib/schemas";
import { snapshotSounds } from "./resolveSounds";
import { isFadeablePad } from "@/lib/padUtils";
import { emitAudioError } from "./audioEvents";
import { startAudioTick, stopAudioTick } from "./audioTick";

import {
  addStopCleanupTimeout,
  deleteStopCleanupTimeout,
  cancelGlobalStopTimeout,
  clearPadProgressInfo,
  clearLayerProgressInfo,
  setGlobalStopTimeout,
} from "./audioState";
import {
  cancelFade,
  clearAllFades,
  getFadeFromVolume,
  isFading,
  isFadingIn,
  isFadingOut,
} from "./fadeCoordinator";
import {
  getActivePadIds,
  getAllVoices,
  getLayerIdsForPads,
  getLayerVoices,
  isPadActive,
  nullAllOnEnded,
  stopSpecificVoices,
} from "./voiceRegistry";
import {
  forEachActivePadGain,
  getLivePadVolume,
  getPadGain,
  clearInactivePadGains,
  clearLayerGainsForIds,
  clearPadGainsForIds,
} from "./gainRegistry";
import {
  clearAllLayerChains,
  clearAllLayerCycleIndexes,
  clearAllLayerPending,
  clearAllLayerPlayOrders,
  clearLayerPending,
  deleteLayerChain,
  isLayerPending,
  setLayerPending,
} from "./chainCycleState";
import { dispose as disposeStreaming } from "./streamingAudioLifecycle";

import {
  resolveFadeDuration,
  fadePad,
  fadePadIn,
  stopPadInternal,
} from "./fadeMixer";

import { rampGainTo } from "./gainManager";

import {
  rampStopLayerVoices,
  resolveSounds,
  triggerLayerOfPad,
} from "./layerTrigger";


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
  if (!isFading(pad.id)) return;
  const duration = resolveFadeDuration(pad, globalFadeDurationMs);
  const reverseTarget = getFadeFromVolume(pad.id);
  if (reverseTarget === undefined) return;

  const currentVol = getLivePadVolume(pad.id) ?? reverseTarget;

  fadePad(pad, currentVol, reverseTarget, duration);
  usePlaybackStore.getState().addReversingPad(pad.id);
}

export function crossfadePads(fadingOut: Pad[], fadingIn: Pad[], globalFadeDurationMs?: number): void {
  fadingOut.forEach((pad) => {
    const currentVol = getLivePadVolume(pad.id) ?? ((pad.volume ?? 100) / 100);
    fadePad(pad, currentVol, (pad.fadeTargetVol ?? 0) / 100, resolveFadeDuration(pad, globalFadeDurationMs));
  });
  fadingIn.forEach((pad) =>
    triggerAndFade(pad, 1.0, resolveFadeDuration(pad, globalFadeDurationMs)).catch((err: unknown) => {
      emitAudioError(err);
    })
  );
}

function reverseActiveFade(pad: Pad, highVol: number, lowVol: number, duration: number): void {
  const reverseTarget = getFadeFromVolume(pad.id);
  const currentVol = getLivePadVolume(pad.id) ?? (reverseTarget ?? highVol);
  const targetVol = reverseTarget ?? (isFadingOut(pad.id) ? highVol : lowVol);
  fadePad(pad, currentVol, targetVol, duration);
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
    if (isFadingOut(pad.id) || isFadingIn(pad.id) || isFading(pad.id)) {
      reverseActiveFade(pad, highVol, lowVol, duration);
    } else {
      const currentVol = getPadGain(pad.id).gain.value;
      const atLow = Math.abs(currentVol - lowVol) <= 0.02;
      fadePad(pad, currentVol, atLow ? highVol : lowVol, duration);
    }
    return Promise.resolve();
  }

  if (isFadingIn(pad.id) || isFading(pad.id)) return Promise.resolve();

  return triggerAndFade(pad, lowVol, duration);
}

/**
 * Cancel an in-progress fade, freezing the gain at the current ramp position.
 * Intentionally reads padVolumes (RAF-sampled) rather than getLivePadVolume() —
 * during a scheduled Web Audio ramp, gain.gain.value reflects the scheduler's
 * internal interpolation start point, not the perceivable current position.
 * The store sample better approximates what the user hears at the cancel moment.
 */
export function stopFade(pad: Pad): void {
  const padVolumes = usePadMetricsStore.getState().padVolumes;
  const currentVol = padVolumes[pad.id] ?? ((pad.volume ?? 100) / 100);
  const ctx = getAudioContext();
  const gain = getPadGain(pad.id);
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(currentVol, ctx.currentTime);
  cancelFade(pad.id);
}

/**
 * Orchestration entry point for a single-pad fade tap (fade mode).
 * Determines whether to reverse a fade-out, start a fade-out, or fade in
 * based on current audio state — keeping that decision in the audio layer
 * rather than in the UI hook.
 */
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

/** Stop a single pad, clearing its layer chain queues, cycle cursors, and play orders first so onended doesn't advance the chain. */
export function stopPad(pad: Pad): void {
  cancelFade(pad.id);
  stopPadInternal(pad);
  // stopPadInternal removes the pad from the playing-pads set; clear its
  // metadata overlay in lockstep so a stopped pad never displays stale info.
  usePadDisplayStore.getState().clearPadDisplay(pad.id);
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
  clearAllFades();
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
  // Snapshot per-pad layer IDs alongside stoppedPadIds — avoids redundant
  // per-padId registry walks inside the timeout.
  const stoppedLayersByPad = new Map<string, Set<string>>();
  for (const padId of stoppedPadIds) {
    stoppedLayersByPad.set(padId, getLayerIdsForPads(new Set([padId])));
  }

  // Immediately disconnect stale (inactive) pad gain nodes — they have no
  // voices so no ramp is needed; same-tick removal shrinks the race window.
  clearInactivePadGains(stoppedPadIds);

  forEachActivePadGain(stoppedPadIds, (_padId, gain) => {
    rampGainTo(gain.gain, 0, STOP_RAMP_S);
  });
  // Track this timeout so clearAllAudioState() can cancel it if project close
  // fires before the ramp completes — prevents stale cleanup from touching a
  // new audio session.
  const stopTimeoutId = setTimeout(() => {
    cancelGlobalStopTimeout(); // clear the tracker (timeout already fired)
    // Scoped to stoppedLayersByPad — pads triggered during the ramp window keep their streaming/progress state.
    for (const [padId, layerIds] of stoppedLayersByPad) {
      clearPadProgressInfo(padId);
      for (const layerId of layerIds) {
        clearLayerProgressInfo(layerId);
        disposeStreaming(padId, layerId);
      }
    }
    clearLayerGainsForIds(getLayerIdsForPads(stoppedPadIds));
    clearPadGainsForIds(stoppedPadIds);
    const fullyStopped = stopSpecificVoices(stoppedVoices, stoppedPadIds);
    for (const padId of fullyStopped) {
      usePlaybackStore.getState().removePlayingPad(padId);
      // Clear the metadata overlay in lockstep with the playing-pads removal so
      // a stopped pad never displays stale info (scoped to fullyStopped so pads
      // triggered during the ramp window are not affected).
      usePadDisplayStore.getState().clearPadDisplay(padId);
    }
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
    disposeStreaming(pad.id, layer.id);
    rampStopLayerVoices(pad.id, layer, voices);
  }
}

// startVolume: 0-1. For a fresh trigger (pad not active), defaults to pad.volume.
// For retriggering an already-active pad, defaults to the current live gain so the
// user-adjusted volume is not reset to pad.volume. Pass 0 explicitly for silent-start
// gesture-drag and fade-in operations.
export async function triggerPad(pad: Pad, startVolume?: number): Promise<void> {
  // Snapshot library sounds synchronously before any await — same race-window rationale as the
  // gain capture below. A loadLibrary/updateLibrary call arriving during ensureResumed() would
  // produce a new Immer array reference, making parallel layer work see inconsistent sounds.
  const snapshot = snapshotSounds(useLibraryStore.getState().sounds);
  // Capture gain state before any await — isPadActive and gain.gain.value can change
  // across async boundaries (e.g. stopAllPads firing during ensureResumed).
  const padGain = getPadGain(pad.id);
  const wasActive = isPadActive(pad.id);
  const liveGain = wasActive ? padGain.gain.value : null;
  const ctx = await ensureResumed();
  // Preserve the live gain when retriggering an active pad — avoids snapping volume
  // back to pad.volume. Fresh triggers (pad not active) use pad.volume.
  const startVol = startVolume ?? (wasActive
    ? (liveGain ?? (pad.volume ?? 100) / 100)
    : ((pad.volume ?? 100) / 100));
  // Cancel any in-progress fade-out so its cleanup setTimeout cannot kill voices
  // that are about to be started below.
  cancelFade(pad.id);
  padGain.gain.cancelScheduledValues(ctx.currentTime);
  padGain.gain.setValueAtTime(startVol, ctx.currentTime);
  // Signal the tick to re-sample on the next frame so any stale padVolumes entry
  // (from a previous play session) is cleared before the buffer finishes loading.
  startAudioTick();

  // Pre-collect eligible layers and set their pending flags synchronously before any await.
  // This closes the race window: a rapid re-trigger arriving during async work will see
  // isLayerPending(layer.id)===true and be correctly debounced.
  type LayerWork = { layer: (typeof pad.layers)[number]; resolved: ReturnType<typeof resolveSounds> };
  const layerWork: LayerWork[] = [];
  for (const layer of pad.layers) {
    const resolved = resolveSounds(layer, snapshot);
    if (resolved.length === 0) continue;
    if (isLayerPending(layer.id)) continue;
    setLayerPending(layer.id); // triggerLayerOfPad clears this on all exit paths (skip/chain-advanced/proceed/error).
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
  const resolved = resolveSounds(layer, snapshotSounds(useLibraryStore.getState().sounds));
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
    cancelFade(pad.id);
    // Signal the tick to re-sample stale padVolumes entries (same as triggerPad).
    startAudioTick();

    await triggerLayerOfPad(pad, layer, ctx, padGain, resolved, {
      // triggerLayer-specific: after a "stop"-mode ramp-stop, check if the pad
      // still has any active voices and remove it from the playing-pads set if not.
      afterStopCleanup: () => {
        const timeoutId = setTimeout(() => {
          deleteStopCleanupTimeout(timeoutId);
          if (!isPadActive(pad.id)) {
            usePlaybackStore.getState().removePlayingPad(pad.id);
            cancelFade(pad.id);
            // Safety net: rampStopLayerVoices already handles removePlayingPad at STOP_RAMP_S+5ms;
            // this fires at +10ms and is idempotent if the ramp already cleaned up.
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

