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
  computeAllPadProgress,
} from "./audioState";

const VOLUME_EPSILON = 0.001;

let rafId: number | null = null;

// Track previous values to skip no-op store updates for pad/layer volumes.
let prevPadVolumes: Record<string, number> = {};
let prevLayerVolumes: Record<string, number> = {};

function tick(): void {
  // Self-terminate when no pads are active.
  if (getActivePadCount() === 0) {
    rafId = null;
    prevPadVolumes = {};
    prevLayerVolumes = {};
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
  // Epsilon diff in shallowEqualRecords avoids no-op store writes for stable values.
  const nextLayerVolumes: Record<string, number> = {};
  forEachActiveLayerGain((layerId, gain) => {
    nextLayerVolumes[layerId] = gain.gain.value;
  });

  // --- Compute padProgress (always emit for playing pads) ---
  const nextPadProgress = computeAllPadProgress();

  // --- Compute activeLayerIds (always emit) ---
  const nextActiveLayerIds = getActiveLayerIdSet();

  // Diff padVolumes and layerVolumes to skip no-op updates.
  const padVolumesChanged = !shallowEqualRecords(nextPadVolumes, prevPadVolumes);
  const layerVolumesChanged = !shallowEqualRecords(nextLayerVolumes, prevLayerVolumes);

  if (padVolumesChanged) prevPadVolumes = nextPadVolumes;
  if (layerVolumesChanged) prevLayerVolumes = nextLayerVolumes;

  usePlaybackStore.getState().setAudioTick({
    ...(padVolumesChanged ? { padVolumes: nextPadVolumes } : {}),
    ...(layerVolumesChanged ? { layerVolumes: nextLayerVolumes } : {}),
    padProgress: nextPadProgress,
    activeLayerIds: nextActiveLayerIds,
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
  prevPadVolumes = {};
  prevLayerVolumes = {};
}

function _clearAllTickFields(): void {
  usePlaybackStore.getState().setAudioTick({
    padVolumes: {},
    layerVolumes: {},
    padProgress: {},
    activeLayerIds: new Set(),
  });
}

function shallowEqualRecords(a: Record<string, number>, b: Record<string, number>): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const k of aKeys) {
    if (!(k in b) || Math.abs(a[k] - b[k]) > VOLUME_EPSILON) return false;
  }
  return true;
}
