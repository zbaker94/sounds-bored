/**
 * audioState.ts — Non-serializable audio engine runtime state (progress + stop tracking).
 *
 * After the issue #423 extraction, this module owns only the state that did not
 * fit naturally into one of the focused sub-modules:
 *
 *   - Pad/layer progress info (buffer-path startedAt/duration/isLooping)
 *   - Stop cleanup timeouts (post-ramp setTimeout IDs from stopAllPads / rampStopLayerVoices)
 *
 * Sibling modules own the rest:
 *   - voiceRegistry  — voice tracking, padToLayerIds reverse index, layer-voice-set listener
 *   - gainRegistry   — pad/layer GainNode tracking, gain-ramp deadline
 *   - chainCycleState — chain queue, cycle index, play order, pending, consecutive failures
 *   - streamingAudioLifecycle — streaming audio elements + best-element cache
 *   - fadeCoordinator — fade timeouts, fadingOut/fadingIn membership, fromVolume snapshots
 *
 * ============================================================================
 * COORDINATION WITH playbackStore
 * ============================================================================
 *
 * playbackStore (Zustand) holds reactive UI signals split into two categories:
 *
 *   Push-based (written by upstream callers on discrete events): playingPadIds,
 *   fadingPadIds, fadingOutPadIds, reversingPadIds. These are updated
 *   synchronously when a pad starts or stops — routing them through the RAF
 *   tick would add ~16 ms latency to UI feedback with no correctness benefit.
 *   This module DOES NOT write these fields directly; callers (padPlayer) read
 *   the local state here and mirror it to playbackStore at the call site.
 *
 *   Tick-managed (written by audioTick.ts each RAF frame): padVolumes,
 *   layerVolumes, padProgress, layerProgress, activeLayerIds, layerPlayOrder,
 *   layerChain. This module MUST NOT write these fields — doing so bypasses the
 *   tick's diff logic and can create race conditions with the RAF loop.
 *
 * INVARIANT: This module does not directly import playbackStore. It is a pure
 *   local state container; all coordination with the reactive store happens at
 *   the caller (padPlayer / fadeMixer / layerTrigger / gainManager / audioTick).
 *   Note: fadeCoordinator (which this module imports) writes playbackStore on
 *   its own behalf via the atomic startFade/cancelFade API — clearAllFades
 *   used by clearAllAudioState is the local-only teardown variant and does
 *   NOT propagate that direct dependency.
 *
 * INVARIANT: Never call stopAllVoices() without first clearing chain queues and
 *   fade tracking. Reason: voice.stop() fires onended synchronously, which reads
 *   chainCycleState.layerChainQueue. If the queue is not cleared first, onended
 *   will advance the chain and restart sounds.
 *
 * INVARIANT: Always use padPlayer.stopAllPads() as the single stop entry point.
 *   It clears fade tracking and chain queues first, nulls onended callbacks,
 *   ramps gain nodes to zero, then calls stopSpecificVoices() on the snapshot
 *   and mirrors the fully-stopped pads to playbackStore.playingPadIds.
 */

import { getAudioContext } from "./audioContext";
import { getBestForPad, iterateBestLayers, clearAll as clearAllStreamingAudio } from "./streamingAudioLifecycle";
import { isGainRampPending, clearAll as clearAllGainRegistry, resetGainRampDeadline } from "./gainRegistry";
import { getActivePadIds, nullAllOnEnded, stopAllVoices } from "./voiceRegistry";
import { clearAll as clearAllChainCycleState } from "./chainCycleState";
import { clearAllFades, isAnyFadeActive } from "./fadeCoordinator";

// ---------------------------------------------------------------------------
// Backward-compat re-exports — imported from sub-modules.
// Internal callers should import directly from the focused modules.
// This barrel exists so test mocks targeting "./audioState" continue to work.
// Candidates for removal once all test vi.mock() calls are migrated.
// ---------------------------------------------------------------------------
export {
  isPadActive,
  isLayerActive,
  recordVoice,
  clearVoice,
  recordLayerVoice,
  clearLayerVoice,
  stopPadVoices,
  stopLayerVoices,
  stopAllVoices,
  stopSpecificVoices,
  getLayerVoices,
  nullAllOnEnded,
  nullPadOnEnded,
  getActivePadIds,
  getAllVoices,
  getLayerIdsForPads,
  getActivePadCount,
  getActiveLayerIdSet,
  clearAllVoices,
  onLayerVoiceSetChanged,
} from "./voiceRegistry";

export {
  getPadGain,
  getLivePadVolume,
  forEachActivePadGain,
  forEachActiveLayerGain,
  getOrCreateLayerGain,
  getLayerGain,
  clearAllPadGains,
  clearAllLayerGains,
  clearInactivePadGains,
  clearPadGainsForIds,
  clearLayerGainsForIds,
  markGainRamp,
} from "./gainRegistry";

export {
  getLayerChain,
  setLayerChain,
  deleteLayerChain,
  clearAllLayerChains,
  getLayerCycleIndex,
  setLayerCycleIndex,
  deleteLayerCycleIndex,
  clearAllLayerCycleIndexes,
  setLayerPlayOrder,
  getLayerPlayOrder,
  deleteLayerPlayOrder,
  clearAllLayerPlayOrders,
  isLayerPending,
  setLayerPending,
  clearLayerPending,
  clearAllLayerPending,
  getLayerConsecutiveFailures,
  incrementLayerConsecutiveFailures,
  resetLayerConsecutiveFailures,
} from "./chainCycleState";

export {
  isPadFadingOut,
  isPadFading,
  isPadFadingIn,
  cancelPadFade,
  addFadingOutPad,
  removeFadingOutPad,
  addFadingInPad,
  removeFadingInPad,
  setPadFadeFromVolume,
  getPadFadeFromVolume,
  setFadePadTimeout,
  deleteFadePadTimeout,
  clearAllFadeTracking,
} from "./fadeCoordinator";

// ---------------------------------------------------------------------------
// Private state — progress, stop cleanup
// ---------------------------------------------------------------------------

/** Tracks the longest-duration voice per pad for playback progress display (buffer path). */
const padProgressInfo = new Map<string, { startedAt: number; duration: number; isLooping: boolean }>();

/** Tracks per-layer progress info for buffer path voices. One entry per active layer. */
const layerProgressInfo = new Map<string, { startedAt: number; duration: number; isLooping: boolean }>();

/**
 * The timeout ID from stopAllPads()'s post-ramp cleanup setTimeout.
 * Tracked so clearAllAudioState() can cancel it and prevent cross-session contamination.
 */
let _globalStopTimeoutId: ReturnType<typeof setTimeout> | null = null;

/**
 * Post-ramp cleanup timeouts from rampStopLayerVoices, stopLayerWithRamp, and the
 * afterStopCleanup callback in triggerLayer. Tracked so clearAllAudioState() can
 * cancel them and prevent stale closures from modifying audio state in a new session.
 */
const pendingStopCleanupTimeouts = new Set<ReturnType<typeof setTimeout>>();

// ---------------------------------------------------------------------------
// Gain-state queries
// ---------------------------------------------------------------------------

/**
 * Returns true when any fade or short gain ramp is currently in flight,
 * meaning gain node values may be changing this frame.
 * Used by audioTick to short-circuit the volume rebuild in steady state.
 */
export function isAnyGainChanging(): boolean {
  if (isAnyFadeActive()) return true;
  return isGainRampPending();
}

/** Returns playback progress for a pad in [0, 1], or null if not playing.
 *  Pass `currentTime` when computing progress for multiple pads in a single RAF frame
 *  so all calculations share the same AudioContext reference point. */
export function getPadProgress(padId: string, currentTime?: number): number | null {
  const info = padProgressInfo.get(padId);
  if (info) {
    const t = currentTime ?? getAudioContext().currentTime;
    const elapsed = t - info.startedAt;
    if (info.isLooping && info.duration > 0) {
      return (elapsed % info.duration) / info.duration;
    }
    return Math.min(1, Math.max(0, elapsed / info.duration));
  }
  const best = getBestForPad(padId);
  if (best !== undefined) {
    const d = best.duration;
    if (d > 0 && isFinite(d)) {
      return Math.min(1, Math.max(0, best.currentTime / d));
    }
    // duration not yet known (loadedmetadata hasn't fired) -- return 0 to show bar started
    return 0;
  }
  return null;
}

/**
 * Compute padProgress for all active pads in one pass.
 * Returns a Record<padId, progress 0–1>. Pads with no progress info are omitted.
 * Reads AudioContext.currentTime once and passes it to getPadProgress — mirrors computeAllLayerProgress.
 */
export function computeAllPadProgress(): Record<string, number> {
  const activePadIds = getActivePadIds();
  if (activePadIds.size === 0) return {};
  const currentTime = getAudioContext().currentTime;
  const result: Record<string, number> = {};
  for (const padId of activePadIds) {
    const progress = getPadProgress(padId, currentTime);
    if (progress !== null) result[padId] = progress;
  }
  return result;
}

/**
 * Compute layerProgress for all active layers in one pass.
 * Returns a Record<layerId, progress 0–1>.
 * Buffer layers are tracked via layerProgressInfo; streaming layers via streamingAudioLifecycle.iterateBestLayers.
 */
export function computeAllLayerProgress(): Record<string, number> {
  const result: Record<string, number> = {};

  // Buffer layers — tracked in layerProgressInfo
  if (layerProgressInfo.size > 0) {
    const ctx = getAudioContext();
    for (const [layerId, info] of layerProgressInfo) {
      const elapsed = ctx.currentTime - info.startedAt;
      if (info.isLooping && info.duration > 0) {
        result[layerId] = (elapsed % info.duration) / info.duration;
      } else {
        result[layerId] = Math.min(1, Math.max(0, elapsed / info.duration));
      }
    }
  }

  // Streaming layers — use streamingAudioLifecycle.iterateBestLayers (O(1) lookup per layer)
  for (const [layerId, best] of iterateBestLayers()) {
    if (layerId in result) continue; // already from buffer path
    const d = best.duration;
    result[layerId] = d > 0 && isFinite(d) ? Math.min(1, Math.max(0, best.currentTime / d)) : 0;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Pad progress tracking
// ---------------------------------------------------------------------------

export function setPadProgressInfo(padId: string, info: { startedAt: number; duration: number; isLooping: boolean }): void {
  padProgressInfo.set(padId, info);
}

export function getPadProgressInfo(padId: string): { startedAt: number; duration: number; isLooping: boolean } | undefined {
  return padProgressInfo.get(padId);
}

export function clearPadProgressInfo(padId: string): void {
  padProgressInfo.delete(padId);
}

export function clearAllPadProgressInfo(): void {
  padProgressInfo.clear();
}

// ---------------------------------------------------------------------------
// Layer progress tracking (per-layer progress bars, buffer path only)
// ---------------------------------------------------------------------------

export function setLayerProgressInfo(layerId: string, info: { startedAt: number; duration: number; isLooping: boolean }): void {
  layerProgressInfo.set(layerId, info);
}

export function getLayerProgressInfo(layerId: string): { startedAt: number; duration: number; isLooping: boolean } | undefined {
  return layerProgressInfo.get(layerId);
}

export function clearLayerProgressInfo(layerId: string): void {
  layerProgressInfo.delete(layerId);
}

export function clearAllLayerProgressInfo(): void {
  layerProgressInfo.clear();
}

// ---------------------------------------------------------------------------
// Global stop timeout tracking (stopAllPads post-ramp cleanup)
// ---------------------------------------------------------------------------

/**
 * Record the setTimeout ID from stopAllPads's post-ramp cleanup.
 * Must be cancelled by clearAllAudioState to prevent cross-session contamination.
 */
export function setGlobalStopTimeout(id: ReturnType<typeof setTimeout>): void {
  _globalStopTimeoutId = id;
}

/**
 * Cancel the pending post-ramp cleanup from stopAllPads, if any.
 * Called by clearAllAudioState on project close.
 */
export function cancelGlobalStopTimeout(): void {
  if (_globalStopTimeoutId !== null) {
    clearTimeout(_globalStopTimeoutId);
    _globalStopTimeoutId = null;
  }
}

/** Register a post-ramp cleanup timeout so clearAllAudioState() can cancel it. */
export function addStopCleanupTimeout(id: ReturnType<typeof setTimeout>): void {
  pendingStopCleanupTimeouts.add(id);
}

/** Remove a stop cleanup timeout from tracking — called when the timeout fires naturally. */
export function deleteStopCleanupTimeout(id: ReturnType<typeof setTimeout>): void {
  pendingStopCleanupTimeouts.delete(id);
}

/** Cancel all pending stop cleanup timeouts. Called by clearAllAudioState on project close. */
function clearAllStopCleanupTimeouts(): void {
  for (const id of pendingStopCleanupTimeouts) clearTimeout(id);
  pendingStopCleanupTimeouts.clear();
}

// ---------------------------------------------------------------------------
// Consolidated cleanup — instant, no gain ramp (for project close)
// ---------------------------------------------------------------------------

/**
 * Instantly release all audio engine state — no gain ramp.
 * Use on project close / component unmount where a click is acceptable.
 * For graceful in-session stopping (with gain ramp), use padPlayer.stopAllPads() instead.
 *
 * Clears in the same order as stopAllPads to respect invariants:
 *   1. Chain queues + fade tracking first (prevents onended from restarting chains)
 *   2. onended callbacks nulled (prevents callbacks from firing during voice.stop())
 *   3. Voices stopped, then gains cleared
 */
export function clearAllAudioState(): void {
  // Reset gain ramp deadline first so isAnyGainChanging() reports false during teardown,
  // letting the audioTick fast-path skip stale samples while the rest of the state unwinds.
  resetGainRampDeadline();
  // Cancel any pending stopAllPads post-ramp setTimeout to prevent cross-session contamination.
  cancelGlobalStopTimeout();
  clearAllStopCleanupTimeouts();
  clearAllFades();
  clearAllChainCycleState();
  nullAllOnEnded();
  clearAllStreamingAudio();
  clearAllPadProgressInfo();
  clearAllLayerProgressInfo();
  // Stop voices BEFORE disconnecting gain nodes so onended callbacks (already nulled above)
  // do not fire against disconnected nodes, and voice.stop() completes with a valid graph.
  stopAllVoices();
  clearAllGainRegistry();
  // Note: audio buffer / streaming element caches are cleared by the caller
  // (MainPage) — audioState is a pure state container and does not import the
  // cache modules to keep the dependency graph clean.
}
