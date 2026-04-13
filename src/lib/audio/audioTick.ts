/**
 * audioTick.ts — Single global RAF loop for audio engine → UI state synchronization.
 *
 * Reads from audioState.ts Maps (gain nodes, voice map, progress) each animation frame
 * and emits one batched setAudioTick() call to playbackStore. Replaces:
 *   - Per-pad RAF loops (previously padFadeRafs / startFadeRaf, now removed from audioState.ts)
 *   - Per-PadButton RAF (progress polling)
 *   - Per-PadControlContent RAF (activeLayerIds polling)
 *   - Scattered updatePadVolume / updateLayerVolume calls from fade functions
 *
 * Start/stop contract:
 *   - startAudioTick(): called by padPlayer when a voice is recorded. Idempotent.
 *   - stopAudioTick(): called by padPlayer.stopAllPads() to immediately clear bars.
 *     The tick also self-terminates when getActivePadCount() returns 0.
 *
 * Import graph: audioTick → audioState (reads), audioTick → playbackStore (writes).
 * padPlayer → audioTick (calls start/stop). audioState does NOT import audioTick.
 */

import { usePlaybackStore } from "@/state/playbackStore";
import {
  getActivePadCount,
  forEachActivePadGain,
  forEachActiveLayerGain,
  getActiveLayerIdSet,
  getLayerVoiceVersion,
  computeAllPadProgress,
  computeAllLayerProgress,
} from "./audioState";

const VOLUME_EPSILON = 0.001;
// Progress bars advance every frame while audio plays; a tolerance just below
// 1 pixel of displayed movement skips duplicate frames without visible stall.
// At 60 fps a 10 s sound advances ~0.0017/frame, so 0.001 skips at most 1 frame.
const PROGRESS_EPSILON = 0.001;

let rafId: number | null = null;

// Per-frame previous values — diffed each tick to suppress no-op store updates.
let prevPadVolumes: Record<string, number> = {};
let prevLayerVolumes: Record<string, number> = {};
let prevActiveLayerIds = new Set<string>();
let prevLayerVoiceVersion = -1;
let prevPadProgress: Record<string, number> = {};
let prevLayerProgress: Record<string, number> = {};

/** Reset all per-frame tracker state. Called on start, self-terminate, and stop. */
function resetTrackers(): void {
  prevPadVolumes = {};
  prevLayerVolumes = {};
  prevActiveLayerIds = new Set();
  prevLayerVoiceVersion = -1;
  prevPadProgress = {};
  prevLayerProgress = {};
}

function tick(): void {
  // Self-terminate when no pads are active.
  if (getActivePadCount() === 0) {
    rafId = null;
    resetTrackers();
    _clearAllTickFields();
    return;
  }

  // --- Compute padVolumes ---
  // Only entries where gain < (1 - VOLUME_EPSILON). Absence = full volume.
  const nextPadVolumes: Record<string, number> = {};
  forEachActivePadGain((padId, gain) => {
    const v = gain.gain.value;
    if (v < 1 - VOLUME_EPSILON) {
      nextPadVolumes[padId] = v;
    }
  });

  // --- Compute layerVolumes ---
  // Emit all active layer gains (no threshold filter — layers always show their live volume).
  // volumesEqual avoids no-op store writes for stable values.
  const nextLayerVolumes: Record<string, number> = {};
  forEachActiveLayerGain((layerId, gain) => {
    nextLayerVolumes[layerId] = gain.gain.value;
  });

  // --- Compute padProgress — diff to skip no-op store updates ---
  const nextPadProgress = computeAllPadProgress();
  const padProgressChanged = !progressEqual(nextPadProgress, prevPadProgress);
  if (padProgressChanged) prevPadProgress = nextPadProgress;

  // --- Compute layerProgress — diff to skip no-op store updates ---
  const nextLayerProgress = computeAllLayerProgress();
  const layerProgressChanged = !progressEqual(nextLayerProgress, prevLayerProgress);
  if (layerProgressChanged) prevLayerProgress = nextLayerProgress;

  // --- Compute activeLayerIds — version-gated to avoid allocating a Set every frame ---
  // layerVoiceVersion increments only when a voice is added or removed. On frames
  // where the version is unchanged (the common steady-state case during playback),
  // getActiveLayerIdSet() is never called and no Set is allocated.
  const currentLayerVoiceVersion = getLayerVoiceVersion();
  const activeLayerIdsChanged = currentLayerVoiceVersion !== prevLayerVoiceVersion;
  let nextActiveLayerIds = prevActiveLayerIds;
  if (activeLayerIdsChanged) {
    nextActiveLayerIds = getActiveLayerIdSet();
    prevActiveLayerIds = nextActiveLayerIds;
    prevLayerVoiceVersion = currentLayerVoiceVersion;
  }

  // Diff padVolumes and layerVolumes to skip no-op updates.
  const padVolumesChanged = !volumesEqual(nextPadVolumes, prevPadVolumes);
  const layerVolumesChanged = !volumesEqual(nextLayerVolumes, prevLayerVolumes);

  if (padVolumesChanged) prevPadVolumes = nextPadVolumes;
  if (layerVolumesChanged) prevLayerVolumes = nextLayerVolumes;

  // Only call setAudioTick if at least one field actually changed.
  // When nothing changed, skip the Zustand update entirely — this prevents
  // all playbackStore subscribers from running their selector functions every frame.
  if (
    !padVolumesChanged &&
    !layerVolumesChanged &&
    !padProgressChanged &&
    !layerProgressChanged &&
    !activeLayerIdsChanged
  ) {
    rafId = requestAnimationFrame(tick);
    return;
  }

  usePlaybackStore.getState().setAudioTick({
    ...(padVolumesChanged ? { padVolumes: nextPadVolumes } : {}),
    ...(layerVolumesChanged ? { layerVolumes: nextLayerVolumes } : {}),
    ...(padProgressChanged ? { padProgress: nextPadProgress } : {}),
    ...(layerProgressChanged ? { layerProgress: nextLayerProgress } : {}),
    ...(activeLayerIdsChanged ? { activeLayerIds: nextActiveLayerIds } : {}),
  });

  rafId = requestAnimationFrame(tick);
}

/** Start the global audio tick if not already running. Idempotent. */
export function startAudioTick(): void {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(tick);
}

/** Stop the tick immediately and clear all tick-managed store fields. */
export function stopAudioTick(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  _clearAllTickFields();
  resetTrackers();
}

function _clearAllTickFields(): void {
  usePlaybackStore.getState().setAudioTick({
    padVolumes: {},
    layerVolumes: {},
    padProgress: {},
    layerProgress: {},
    activeLayerIds: new Set(),
  });
}

/** True when two pad/layer volume records are equal within VOLUME_EPSILON. */
function volumesEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const k of aKeys) {
    if (!(k in b) || Math.abs(a[k] - b[k]) > VOLUME_EPSILON) return false;
  }
  return true;
}

/** True when two progress records are equal within PROGRESS_EPSILON. */
function progressEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const k of aKeys) {
    if (!(k in b) || Math.abs(a[k] - b[k]) > PROGRESS_EPSILON) return false;
  }
  return true;
}
