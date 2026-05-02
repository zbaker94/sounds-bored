/**
 * audioTick.ts — Single global RAF loop for audio engine → UI state synchronization.
 *
 * Reads from audioState.ts Maps (gain nodes, voice map, progress) each animation frame
 * and emits one batched setAudioTick() call to playbackStore. Replaces:
 *   - Per-pad RAF loops (previously padFadeRafs / startFadeRaf, now removed from audioState.ts)
 *   - Per-PadButton RAF (progress polling)
 *   - Per-PadControlContent RAF (activeLayerIds polling)
 *   - Scattered updatePadVolume calls from fade functions
 *
 * Start/stop contract:
 *   - startAudioTick(): called by padPlayer when a voice is recorded. Idempotent.
 *   - stopAudioTick(): called by padPlayer.stopAllPads() to immediately clear bars.
 *     The tick also self-terminates when getActivePadCount() returns 0.
 *
 * Import graph: audioTick → audioState (reads), audioTick → playbackStore (writes),
 * audioTick → audioContext (audioTick subscribes to playbackStore.masterVolume and
 * forwards to audioContext.applyMasterVolume — audioContext itself has no store import).
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
  getLayerPlayOrder,
  getLayerChain,
  isAnyGainChanging,
} from "./audioState";
import { applyMasterVolume } from "./audioContext";

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
let prevLayerPlayOrder: Record<string, string[]> = {};
let prevLayerChain: Record<string, string[]> = {};

// Track the last observed Sound[] source reference per layer so we can skip
// the .map(s => s.id) allocation when the source array reference is unchanged.
// These Sound[] arrays in audioState's layerPlayOrderMap / layerChainQueue only
// swap to a new reference on explicit writes, so reference equality is sufficient.
const prevLayerPlayOrderSource = new Map<string, readonly unknown[]>();
const prevLayerChainSource = new Map<string, readonly unknown[]>();

/** Exposed for test introspection only — do not use in production code. */
export const _getPrevActiveLayerIds = (): ReadonlySet<string> => prevActiveLayerIds;

/** Reset all per-frame tracker state. Called on start, self-terminate, and stop. */
function resetTrackers(): void {
  prevPadVolumes = {};
  prevLayerVolumes = {};
  prevActiveLayerIds = new Set();
  prevLayerVoiceVersion = -1;
  prevPadProgress = {};
  prevLayerProgress = {};
  prevLayerPlayOrder = {};
  prevLayerChain = {};
  prevLayerPlayOrderSource.clear();
  prevLayerChainSource.clear();
}

// Wire playbackStore.masterVolume to the audio context master gain node.
// audioTick is the documented reactive bridge; audioContext itself has no store dependency.
// The unsubscribe handle is exported (with _ prefix per project convention) for test teardown.
export const _stopMasterVolumeSync = usePlaybackStore.subscribe(
  (s) => s.masterVolume,
  (vol) => applyMasterVolume(vol),
);

/**
 * Samples the current gain nodes and diffs against the previous tick.
 * Returns new volume records and change flags. Skips all allocation in
 * steady-state (no fade in flight) by reusing the previous records.
 */
function computeGainChanges(): {
  nextPadVolumes: Record<string, number>;
  nextLayerVolumes: Record<string, number>;
  padVolumesChanged: boolean;
  layerVolumesChanged: boolean;
} {
  if (!isAnyGainChanging()) {
    return {
      nextPadVolumes: prevPadVolumes,
      nextLayerVolumes: prevLayerVolumes,
      padVolumesChanged: false,
      layerVolumesChanged: false,
    };
  }
  const nextPadVolumes: Record<string, number> = {};
  forEachActivePadGain((padId, gain) => {
    const v = gain.gain.value;
    if (v < 1 - VOLUME_EPSILON) nextPadVolumes[padId] = v;
  });
  const nextLayerVolumes: Record<string, number> = {};
  forEachActiveLayerGain((layerId, gain) => {
    nextLayerVolumes[layerId] = gain.gain.value;
  });
  const padVolumesChanged = !volumesEqual(nextPadVolumes, prevPadVolumes);
  const layerVolumesChanged = !volumesEqual(nextLayerVolumes, prevLayerVolumes);
  if (padVolumesChanged) prevPadVolumes = nextPadVolumes;
  if (layerVolumesChanged) prevLayerVolumes = nextLayerVolumes;
  return { nextPadVolumes, nextLayerVolumes, padVolumesChanged, layerVolumesChanged };
}

/**
 * Walks active layer IDs and builds reference-stable string[] records for
 * layerPlayOrder and layerChain. Reuses the previous string[] when the source
 * Sound[] reference or its contents are unchanged — keeps Zustand selectors
 * stable across layers that haven't advanced their chain this tick.
 */
function collectLayerSoundLists(activeLayerIds: ReadonlySet<string>): {
  nextLayerPlayOrder: Record<string, string[]>;
  nextLayerChain: Record<string, string[]>;
  layerPlayOrderChanged: boolean;
  layerChainChanged: boolean;
} {
  const nextLayerPlayOrder: Record<string, string[]> = {};
  const nextLayerChain: Record<string, string[]> = {};
  let seenPlayOrderCount = 0;
  let seenChainCount = 0;

  for (const layerId of activeLayerIds) {
    const playOrder = getLayerPlayOrder(layerId);
    if (playOrder && playOrder.length > 0) {
      seenPlayOrderCount++;
      const prevSource = prevLayerPlayOrderSource.get(layerId);
      const prevIds = prevLayerPlayOrder[layerId];
      if (prevSource === playOrder && prevIds) {
        nextLayerPlayOrder[layerId] = prevIds;
      } else {
        const ids = playOrder.map((s) => s.id);
        nextLayerPlayOrder[layerId] =
          prevIds && prevIds.length === ids.length && prevIds.every((v, i) => v === ids[i])
            ? prevIds  // contents match — reuse prior array for selector stability
            : ids;
        prevLayerPlayOrderSource.set(layerId, playOrder);
      }
    }
    const chain = getLayerChain(layerId);
    if (chain && chain.length > 0) {
      seenChainCount++;
      const prevSource = prevLayerChainSource.get(layerId);
      const prevIds = prevLayerChain[layerId];
      if (prevSource === chain && prevIds) {
        nextLayerChain[layerId] = prevIds;
      } else {
        const ids = chain.map((s) => s.id);
        nextLayerChain[layerId] =
          prevIds && prevIds.length === ids.length && prevIds.every((v, i) => v === ids[i])
            ? prevIds
            : ids;
        prevLayerChainSource.set(layerId, chain);
      }
    }
  }

  // Drop source references for layers no longer in the active set so the
  // tracker maps don't grow unbounded as layers churn.
  if (prevLayerPlayOrderSource.size > seenPlayOrderCount) {
    for (const layerId of prevLayerPlayOrderSource.keys()) {
      if (!(layerId in nextLayerPlayOrder)) prevLayerPlayOrderSource.delete(layerId);
    }
  }
  if (prevLayerChainSource.size > seenChainCount) {
    for (const layerId of prevLayerChainSource.keys()) {
      if (!(layerId in nextLayerChain)) prevLayerChainSource.delete(layerId);
    }
  }

  const layerPlayOrderChanged = !stringArrayRecordsEqual(nextLayerPlayOrder, prevLayerPlayOrder);
  const layerChainChanged = !stringArrayRecordsEqual(nextLayerChain, prevLayerChain);
  if (layerPlayOrderChanged) prevLayerPlayOrder = nextLayerPlayOrder;
  if (layerChainChanged) prevLayerChain = nextLayerChain;
  return { nextLayerPlayOrder, nextLayerChain, layerPlayOrderChanged, layerChainChanged };
}

function tick(): void {
  // Self-terminate when no pads are active.
  if (getActivePadCount() === 0) {
    rafId = null;
    resetTrackers();
    _clearAllTickFields();
    return;
  }

  const { nextPadVolumes, nextLayerVolumes, padVolumesChanged, layerVolumesChanged } =
    computeGainChanges();

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
    // Clone before storing as prev — Set has mutating methods (add/delete/clear) that
    // make accidental consumer mutation more likely than for plain records.
    prevActiveLayerIds = new Set(nextActiveLayerIds);
    prevLayerVoiceVersion = currentLayerVoiceVersion;
  }

  const { nextLayerPlayOrder, nextLayerChain, layerPlayOrderChanged, layerChainChanged } =
    collectLayerSoundLists(nextActiveLayerIds);

  // Only call setAudioTick if at least one field actually changed.
  // When nothing changed, skip the Zustand update entirely — this prevents
  // all playbackStore subscribers from running their selector functions every frame.
  if (
    !padVolumesChanged &&
    !layerVolumesChanged &&
    !padProgressChanged &&
    !layerProgressChanged &&
    !activeLayerIdsChanged &&
    !layerPlayOrderChanged &&
    !layerChainChanged
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
    ...(layerPlayOrderChanged ? { layerPlayOrder: nextLayerPlayOrder } : {}),
    ...(layerChainChanged ? { layerChain: nextLayerChain } : {}),
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
    layerPlayOrder: {},
    layerChain: {},
  });
}

/** True when two pad/layer volume records are equal within VOLUME_EPSILON. */
function volumesEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  if (aKeys.length === 0) return true; // both empty — steady-state fast path
  for (const k of aKeys) {
    if (!(k in b) || Math.abs(a[k] - b[k]) > VOLUME_EPSILON) return false;
  }
  return true;
}

/** True when two progress records are equal within PROGRESS_EPSILON. */
function progressEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  if (aKeys.length === 0) return true; // both empty — steady-state fast path
  for (const k of aKeys) {
    if (!(k in b) || Math.abs(a[k] - b[k]) > PROGRESS_EPSILON) return false;
  }
  return true;
}

/** True when two records-of-string-arrays are structurally equal (same keys,
 *  same array lengths, same ordered string contents). Used for diffing
 *  layerPlayOrder and layerChain between ticks. */
function stringArrayRecordsEqual(
  a: Record<string, string[]>,
  b: Record<string, string[]>,
): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const k of aKeys) {
    const av = a[k];
    const bv = b[k];
    if (!(k in b) || av.length !== bv.length) return false;
    for (let i = 0; i < av.length; i++) {
      if (av[i] !== bv[i]) return false;
    }
  }
  return true;
}
