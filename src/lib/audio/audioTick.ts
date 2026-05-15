/**
 * audioTick.ts — Single global RAF loop for audio engine → UI state synchronization.
 *
 * Reads from audioState (progress), gainRegistry (gain nodes), and voiceRegistry (voice map) each animation frame
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
  computeAllPadProgress,
  computeAllLayerProgress,
  isAnyGainChanging,
} from "./audioState";
import {
  getActivePadCount,
  getActivePadIds,
  getActiveLayerIdSet,
  onLayerVoiceSetChanged,
} from "./voiceRegistry";
import { forEachActivePadGain, forEachActiveLayerGain } from "./gainRegistry";
import { getLayerPlayOrder, getLayerChain, onChainCycleStateChanged } from "./chainCycleState";
import { applyMasterVolume } from "./audioContext";
import { recordsEqual } from "@/lib/utils";

const VOLUME_EPSILON = 0.001;
// Shared empty Set used as a sentinel when the gain-sample fast path is going to skip
// the walk anyway — avoids allocating a fresh Set just to throw it away every frame.
// Frozen so accidental runtime mutation is blocked at the object level;
// TypeScript's ReadonlySet type already prevents .add() at compile time.
const EMPTY_SET: ReadonlySet<string> = Object.freeze(new Set()) as ReadonlySet<string>;
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
// True on startup and after resetTrackers() so the first tick after start/resume
// always walks all active layers to rebuild the chain/playOrder lists.
let chainCycleStateChanged = true;
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
// These Sound[] arrays in chainCycleState's layerPlayOrderMap / layerChainQueue only
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
  chainCycleStateChanged = true; // ensure first tick after reset always rebuilds chain/playOrder lists
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
applyMasterVolume(usePlaybackStore.getState().masterVolume);
export const _stopMasterVolumeSync = usePlaybackStore.subscribe(
  (s) => s.masterVolume,
  (vol) => applyMasterVolume(vol),
);

// Register the layer-voice-set changed listener. voiceRegistry fires this whenever layerVoiceMap
// mutates; the dirty flag gates getActiveLayerIdSet() allocation to frames where a change
// actually occurred. The unsubscribe handle is exported for test teardown.
export const _stopLayerVoiceSetListener = onLayerVoiceSetChanged(() => {
  layerVoiceSetChanged = true;
});

// Register the chain-cycle-state changed listener. chainCycleState fires this whenever
// layer chain or play-order state mutates; the dirty flag gates collectLayerSoundLists()
// to skip the per-layer walk in steady-state.
export const _stopChainCycleStateListener = onChainCycleStateChanged(() => {
  chainCycleStateChanged = true;
});

/**
 * Samples the current gain nodes and diffs against the previous tick.
 * Returns new volume records and change flags. Skips all allocation in
 * steady-state (no fade in flight) by reusing the previous records.
 *
 * The caller passes the current active pad/layer ID sets so this function
 * does not need to call getActivePadIds()/getActiveLayerIdSet() itself —
 * the tick gates those calls behind layerVoiceSetChanged for steady-state efficiency.
 */
function computeGainChanges(
  activePadIds: ReadonlySet<string>,
  activeLayerIds: ReadonlySet<string>,
): {
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
  forEachActivePadGain(activePadIds, (padId, gain) => {
    const v = gain.gain.value;
    if (v < 1 - VOLUME_EPSILON) nextPadVolumes[padId] = v;
  });
  const nextLayerVolumes: Record<string, number> = {};
  forEachActiveLayerGain(activeLayerIds, (layerId, gain) => {
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
function collectLayerSoundLists(
  activeLayerIds: ReadonlySet<string>,
  activeLayerIdsChanged: boolean,
): {
  nextLayerPlayOrder: Record<string, string[]>;
  nextLayerChain: Record<string, string[]>;
  layerPlayOrderChanged: boolean;
  layerChainChanged: boolean;
} {
  // Subscription-gated: skip the per-layer walk when neither a chainCycleState mutation
  // nor an active-layer-set change has occurred since the last tick — the common
  // steady-state case for looping/playing layers. chainCycleStateChanged is set by the
  // onChainCycleStateChanged listener registered at module load, and reset to true by
  // resetTrackers() so the first tick after start/resume always rebuilds the lists.
  // activeLayerIdsChanged forces the walk even without a chain mutation so pruneStaleKeys
  // can clean up layers that deactivated via layerVoiceSetChanged alone — otherwise
  // prevLayerPlayOrder/prevLayerChain would retain stale entries for inactive layers
  // until the next unrelated chain mutation.
  if (!chainCycleStateChanged && !activeLayerIdsChanged) {
    return {
      nextLayerPlayOrder: prevLayerPlayOrder,
      nextLayerChain: prevLayerChain,
      layerPlayOrderChanged: false,
      layerChainChanged: false,
    };
  }
  chainCycleStateChanged = false;

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
    // getActiveLayerIdSet() already returns a fresh Set — no defensive wrap needed
    // for the consumer copy. We still allocate a separate clone for prevActiveLayerIds
    // because Set has mutating methods and the store may receive nextActiveLayerIds;
    // prevActiveLayerIds must be an independent copy so accidental consumer mutation
    // cannot corrupt the next-tick diff.
    nextActiveLayerIds = getActiveLayerIdSet();
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

  // computeProgressChanges runs first because it derives nextActiveLayerIds
  // (gated by layerVoiceSetChanged so getActiveLayerIdSet() is only called when
  // a voice mutation fired since the last tick — common steady-state fast path).
  // We pass the resulting set into computeGainChanges so it does not need to
  // re-query the voice registry.
  const { nextPadProgress, nextLayerProgress, nextActiveLayerIds, padProgressChanged, layerProgressChanged, activeLayerIdsChanged } =
    computeProgressChanges();

  // Gate getActivePadIds() behind the same fast-path check used inside computeGainChanges.
  // The Set allocated by getActivePadIds() is only consumed when forEachActivePadGain
  // actually walks; in steady-state (no ramp, gainSampleNeeded already cleared) the
  // walk is skipped, so we pass an empty Set to avoid the per-frame allocation.
  const willSampleGains = gainSampleNeeded || isAnyGainChanging();
  const activePadIdsForGains: ReadonlySet<string> = willSampleGains ? getActivePadIds() : EMPTY_SET;
  const { nextPadVolumes, nextLayerVolumes, padVolumesChanged, layerVolumesChanged } =
    computeGainChanges(activePadIdsForGains, nextActiveLayerIds);

  const { nextLayerPlayOrder, nextLayerChain, layerPlayOrderChanged, layerChainChanged } =
    collectLayerSoundLists(nextActiveLayerIds, activeLayerIdsChanged);

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
  return recordsEqual(a, b, (av, bv) => Math.abs(av - bv) <= VOLUME_EPSILON);
}

/** True when two progress records are equal within PROGRESS_EPSILON. */
function progressEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  return recordsEqual(a, b, (av, bv) => Math.abs(av - bv) <= PROGRESS_EPSILON);
}

/** True when two records-of-string-arrays are structurally equal (same keys,
 *  same array lengths, same ordered string contents). Used for diffing
 *  layerPlayOrder and layerChain between ticks. */
function stringArrayRecordsEqual(
  a: Record<string, string[]>,
  b: Record<string, string[]>,
): boolean {
  return recordsEqual(a, b, (av, bv) => {
    if (av.length !== bv.length) return false;
    for (let i = 0; i < av.length; i++) {
      if (av[i] !== bv[i]) return false;
    }
    return true;
  });
}
