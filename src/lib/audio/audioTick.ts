/**
 * audioTick.ts — Single global RAF loop for audio engine → UI state synchronization.
 *
 * Reads from audioState.ts Maps (gain nodes, voice map, progress) each animation frame
 * and emits batched setPadMetrics() / setLayerMetrics() calls to padMetricsStore /
 * layerMetricsStore. Splitting the writes across two stores keeps pad-scoped and
 * layer-scoped subscribers from waking each other unnecessarily. Replaces:
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
 * Import graph: audioTick → audioState (reads),
 * audioTick → padMetricsStore / layerMetricsStore (writes),
 * audioTick → playbackStore (subscribes to masterVolume; forwards to
 * audioContext.applyMasterVolume — audioContext itself has no store import).
 * padPlayer → audioTick (calls start/stop). audioState does NOT import audioTick.
 */

import { usePlaybackStore } from "@/state/playbackStore";
import { usePadMetricsStore } from "@/state/padMetricsStore";
import { useLayerMetricsStore } from "@/state/layerMetricsStore";
import {
  getActivePadCount,
  forEachActivePadGain,
  forEachActiveLayerGain,
  getActiveLayerIdSet,
  onLayerVoiceSetChanged,
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
// True on startup and after resetTrackers() so the first tick after start/resume
// always captures the current active layer set — matches the old -1 sentinel behavior.
let layerVoiceSetChanged = true;
// True on startup and after resetTrackers() so the first tick after the tick
// restarts (gap between chain-link sounds, stop/restart) always samples gain nodes
// regardless of isAnyGainChanging(). Prevents prevPadVolumes={} (cleared by
// resetTrackers) from being reused stale when no ramp happens to be in flight.
let gainSampleNeeded = true;
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
/** Exposed for test introspection only — do not use in production code. */
export const _getGainSampleNeeded = (): boolean => gainSampleNeeded;

/** Reset all per-frame tracker state. Called on start, self-terminate, and stop. */
function resetTrackers(): void {
  prevPadVolumes = {};
  prevLayerVolumes = {};
  prevActiveLayerIds = new Set();
  layerVoiceSetChanged = true; // ensure first tick after reset always refreshes activeLayerIds
  gainSampleNeeded = true;     // ensure first tick after reset always samples gain nodes
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

// Register the layer-voice-set changed listener. audioState fires this whenever layerVoiceMap
// mutates; the dirty flag gates getActiveLayerIdSet() allocation to frames where a change
// actually occurred. The unsubscribe handle is exported for test teardown.
export const _stopLayerVoiceSetListener = onLayerVoiceSetChanged(() => {
  layerVoiceSetChanged = true;
});

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
  if (!gainSampleNeeded && !isAnyGainChanging()) {
    return {
      nextPadVolumes: prevPadVolumes,
      nextLayerVolumes: prevLayerVolumes,
      padVolumesChanged: false,
      layerVolumesChanged: false,
    };
  }
  gainSampleNeeded = false;
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
 * Assigns reference-stable string[] ids for a single layer. Reuses the previous
 * string[] when the source array reference or its contents are unchanged — keeps
 * Zustand selectors stable across ticks.
 */
function assignStableIds(
  layerId: string,
  sourceList: readonly { id: string }[],
  sourceMap: Map<string, readonly unknown[]>,
  prevRecord: Record<string, string[]>,
  nextRecord: Record<string, string[]>,
): void {
  const prevSource = sourceMap.get(layerId);
  const prevIds = prevRecord[layerId];
  if (prevSource === sourceList && prevIds) {
    nextRecord[layerId] = prevIds;
  } else {
    const ids = sourceList.map((s) => s.id);
    nextRecord[layerId] =
      prevIds && prevIds.length === ids.length && prevIds.every((v, i) => v === ids[i])
        ? prevIds
        : ids;
    sourceMap.set(layerId, sourceList);
  }
}

/**
 * Drops source references for layers no longer present in nextRecord so the
 * tracker map doesn't grow unbounded as layers churn.
 */
function pruneStaleKeys(
  sourceMap: Map<string, readonly unknown[]>,
  nextRecord: Record<string, string[]>,
  seenCount: number,
): void {
  if (sourceMap.size > seenCount) {
    for (const layerId of sourceMap.keys()) {
      if (!(layerId in nextRecord)) sourceMap.delete(layerId);
    }
  }
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
      assignStableIds(layerId, playOrder, prevLayerPlayOrderSource, prevLayerPlayOrder, nextLayerPlayOrder);
    }
    const chain = getLayerChain(layerId);
    if (chain && chain.length > 0) {
      seenChainCount++;
      assignStableIds(layerId, chain, prevLayerChainSource, prevLayerChain, nextLayerChain);
    }
  }

  pruneStaleKeys(prevLayerPlayOrderSource, nextLayerPlayOrder, seenPlayOrderCount);
  pruneStaleKeys(prevLayerChainSource, nextLayerChain, seenChainCount);

  const layerPlayOrderChanged = !stringArrayRecordsEqual(nextLayerPlayOrder, prevLayerPlayOrder);
  const layerChainChanged = !stringArrayRecordsEqual(nextLayerChain, prevLayerChain);
  if (layerPlayOrderChanged) prevLayerPlayOrder = nextLayerPlayOrder;
  if (layerChainChanged) prevLayerChain = nextLayerChain;
  return { nextLayerPlayOrder, nextLayerChain, layerPlayOrderChanged, layerChainChanged };
}

/**
 * Computes padProgress, layerProgress, and the activeLayerIds set, diffing each
 * against its previous value and updating the module-level prev* trackers.
 * Extracted from tick() to reduce that function's cyclomatic complexity.
 */
function computeProgressChanges(): {
  nextPadProgress: Record<string, number>;
  nextLayerProgress: Record<string, number>;
  nextActiveLayerIds: Set<string>;
  padProgressChanged: boolean;
  layerProgressChanged: boolean;
  activeLayerIdsChanged: boolean;
} {
  const nextPadProgress = computeAllPadProgress();
  const padProgressChanged = !progressEqual(nextPadProgress, prevPadProgress);
  if (padProgressChanged) prevPadProgress = nextPadProgress;

  const nextLayerProgress = computeAllLayerProgress();
  const layerProgressChanged = !progressEqual(nextLayerProgress, prevLayerProgress);
  if (layerProgressChanged) prevLayerProgress = nextLayerProgress;

  // Subscription-gated: getActiveLayerIdSet() is skipped (no Set allocation) on frames
  // where no layerVoiceMap mutation has fired since the last tick — the common steady-state case.
  // layerVoiceSetChanged is set by the onLayerVoiceSetChanged listener registered at module load,
  // and reset to true by resetTrackers() so the first tick after start/resume always refreshes.
  const activeLayerIdsChanged = layerVoiceSetChanged;
  layerVoiceSetChanged = false;
  let nextActiveLayerIds: Set<string> = prevActiveLayerIds;
  if (activeLayerIdsChanged) {
    nextActiveLayerIds = new Set(getActiveLayerIdSet());
    // Clone again — Set has mutating methods, and consumers (the store) get
    // nextActiveLayerIds; prevActiveLayerIds must be an independent copy so
    // accidental consumer mutation cannot corrupt the next-tick diff.
    prevActiveLayerIds = new Set(nextActiveLayerIds);
  }

  return { nextPadProgress, nextLayerProgress, nextActiveLayerIds, padProgressChanged, layerProgressChanged, activeLayerIdsChanged };
}

function tick(): void {
  // Self-terminate when no pads are active.
  if (getActivePadCount() === 0) {
    rafId = null;
    resetTrackers();
    // Clear layer metrics (no active voices) but preserve padMetrics — the pad GainNode
    // persists through sequential chain gaps, so wiping padVolumes here would cause a
    // false "full volume" flash mid-chain. padMetrics is cleared by stopAudioTick() on
    // explicit stop or project close.
    useLayerMetricsStore.getState().clearLayerMetrics();
    return;
  }

  const { nextPadVolumes, nextLayerVolumes, padVolumesChanged, layerVolumesChanged } =
    computeGainChanges();

  const { nextPadProgress, nextLayerProgress, nextActiveLayerIds, padProgressChanged, layerProgressChanged, activeLayerIdsChanged } =
    computeProgressChanges();

  const { nextLayerPlayOrder, nextLayerChain, layerPlayOrderChanged, layerChainChanged } =
    collectLayerSoundLists(nextActiveLayerIds);

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

  const padChanged = padVolumesChanged || padProgressChanged;
  const layerChanged =
    layerVolumesChanged ||
    layerProgressChanged ||
    activeLayerIdsChanged ||
    layerPlayOrderChanged ||
    layerChainChanged;

  if (padChanged) {
    usePadMetricsStore.getState().setPadMetrics({
      ...(padVolumesChanged ? { padVolumes: nextPadVolumes } : {}),
      ...(padProgressChanged ? { padProgress: nextPadProgress } : {}),
    });
  }
  if (layerChanged) {
    useLayerMetricsStore.getState().setLayerMetrics({
      ...(layerVolumesChanged ? { layerVolumes: nextLayerVolumes } : {}),
      ...(layerProgressChanged ? { layerProgress: nextLayerProgress } : {}),
      ...(activeLayerIdsChanged ? { activeLayerIds: nextActiveLayerIds } : {}),
      ...(layerPlayOrderChanged ? { layerPlayOrder: nextLayerPlayOrder } : {}),
      ...(layerChainChanged ? { layerChain: nextLayerChain } : {}),
    });
  }

  rafId = requestAnimationFrame(tick);
}

/** Start the global audio tick if not already running. Idempotent.
 * Always marks gainSampleNeeded so the next frame re-samples padGain nodes —
 * catches stale prevPadVolumes when the tick is already running for other pads. */
export function startAudioTick(): void {
  gainSampleNeeded = true;
  if (rafId !== null) return;
  rafId = requestAnimationFrame(tick);
}

/** Stop the tick immediately and clear all tick-managed store fields. */
export function stopAudioTick(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  clearAllTickFields();
  resetTrackers();
}

function clearAllTickFields(): void {
  usePadMetricsStore.getState().clearPadMetrics();
  useLayerMetricsStore.getState().clearLayerMetrics();
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
