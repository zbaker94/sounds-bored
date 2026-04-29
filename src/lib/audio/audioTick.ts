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

function tick(): void {
  // Self-terminate when no pads are active.
  if (getActivePadCount() === 0) {
    rafId = null;
    resetTrackers();
    _clearAllTickFields();
    return;
  }

  // --- Compute padVolumes and layerVolumes ---
  // Skip both rebuilds in steady state (no fade or gain ramp in flight).
  // When isAnyGainChanging() is false, gain node values are guaranteed stable
  // this frame — reuse the previous records without allocating or iterating.
  let nextPadVolumes: Record<string, number>;
  let nextLayerVolumes: Record<string, number>;
  let padVolumesChanged: boolean;
  let layerVolumesChanged: boolean;
  if (isAnyGainChanging()) {
    nextPadVolumes = {};
    forEachActivePadGain((padId, gain) => {
      const v = gain.gain.value;
      if (v < 1 - VOLUME_EPSILON) {
        nextPadVolumes[padId] = v;
      }
    });
    nextLayerVolumes = {};
    forEachActiveLayerGain((layerId, gain) => {
      nextLayerVolumes[layerId] = gain.gain.value;
    });
    padVolumesChanged = !volumesEqual(nextPadVolumes, prevPadVolumes);
    layerVolumesChanged = !volumesEqual(nextLayerVolumes, prevLayerVolumes);
    if (padVolumesChanged) prevPadVolumes = nextPadVolumes;
    if (layerVolumesChanged) prevLayerVolumes = nextLayerVolumes;
  } else {
    nextPadVolumes = prevPadVolumes;
    nextLayerVolumes = prevLayerVolumes;
    padVolumesChanged = false;
    layerVolumesChanged = false;
  }

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
    // make accidental consumer mutation more likely than for plain records. No current
    // consumer mutates the Set, but the clone is cheap (allocates only on voice-version
    // changes, not every frame) and enforces the invariant that tick-owned prev state
    // never aliases published store state.
    prevActiveLayerIds = new Set(nextActiveLayerIds);
    prevLayerVoiceVersion = currentLayerVoiceVersion;
  }

  // --- Compute layerPlayOrder and layerChain (sound IDs only) ---
  // Walk the active layer ID set and extract ID lists from audioState Maps.
  // Stale entries for layers that are no longer active naturally drop out.
  // When a layer's ID list is unchanged vs the previous tick, reuse the prior
  // array reference so Zustand selectors like (s) => s.layerPlayOrder[layer.id]
  // don't see a new reference (which would cause cross-layer re-render churn
  // whenever any single layer's chain advances).
  const nextLayerPlayOrder: Record<string, string[]> = {};
  const nextLayerChain: Record<string, string[]> = {};
  let seenPlayOrderCount = 0;
  let seenChainCount = 0;
  for (const layerId of nextActiveLayerIds) {
    const playOrder = getLayerPlayOrder(layerId);
    if (playOrder && playOrder.length > 0) {
      seenPlayOrderCount++;
      // Fast path: if the audioState Sound[] array reference hasn't changed
      // since last tick, reuse the previous string[] snapshot and skip .map
      // entirely. The source array only swaps on explicit writes in audioState.
      const prevSource = prevLayerPlayOrderSource.get(layerId);
      const prevIds = prevLayerPlayOrder[layerId];
      if (prevSource === playOrder && prevIds) {
        nextLayerPlayOrder[layerId] = prevIds;
      } else {
        const ids = playOrder.map((s) => s.id);
        if (
          prevIds &&
          prevIds.length === ids.length &&
          prevIds.every((v, i) => v === ids[i])
        ) {
          // Contents match even though the source reference differs — reuse
          // the prior array so downstream selector identity stays stable.
          nextLayerPlayOrder[layerId] = prevIds;
        } else {
          nextLayerPlayOrder[layerId] = ids;
        }
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
        if (
          prevIds &&
          prevIds.length === ids.length &&
          prevIds.every((v, i) => v === ids[i])
        ) {
          nextLayerChain[layerId] = prevIds;
        } else {
          nextLayerChain[layerId] = ids;
        }
        prevLayerChainSource.set(layerId, chain);
      }
    }
  }
  // Drop source references for layers that no longer contribute a play order /
  // chain this tick so the tracker maps don't grow unbounded as layers churn.
  // seenPlayOrderCount == Object.keys(nextLayerPlayOrder).length because the outer
  // loop iterates nextActiveLayerIds, a Set — each layerId is unique per tick.
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
