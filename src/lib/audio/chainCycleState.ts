/**
 * chainCycleState.ts — Per-layer chain, cycle, pending, and consecutive-failure state.
 *
 * Self-contained module that owns five Maps/Sets keyed by layer ID. Extracted from
 * audioState.ts so chain/cycle bookkeeping can evolve independently of the audio
 * graph runtime state.
 *
 *   layerChainQueue            Remaining sounds in sequential/shuffled chain
 *   layerCycleIndex            Next play-order index for cycleMode layers
 *   layerPlayOrderMap          Original play order (for skip-back)
 *   layerPendingMap            Async-race guard for rapid retrigger
 *   layerConsecutiveFailureMap Circuit-breaker for consecutive chain load failures
 *
 * A single chain-cycle-state-changed listener slot is used by audioTick to know
 * when to rebuild the chain/playOrder metrics. Chain and play-order mutation sites
 * notify via the private helper rather than incrementing a counter, so future
 * mutation paths automatically signal the listener.
 */

import { logWarn } from "@/lib/logger";
import type { Sound } from "@/lib/schemas";

const layerChainQueue = new Map<string, Sound[]>();
const layerCycleIndex = new Map<string, number>();
const layerPlayOrderMap = new Map<string, Sound[]>();
const layerPendingMap = new Set<string>();
const layerConsecutiveFailureMap = new Map<string, number>();

// ---------------------------------------------------------------------------
// Mutation listener
// ---------------------------------------------------------------------------

type ChainCycleStateChangedListener = () => void;
let chainCycleStateChangeListener: ChainCycleStateChangedListener | null = null;

/** INVARIANT: Must be the final statement in every single-entry chain/play-order
 *  mutation (setLayerChain, deleteLayerChain, setLayerPlayOrder, deleteLayerPlayOrder)
 *  before any external side effects. Bulk-clear helpers (clearAllLayerChains, etc.)
 *  intentionally omit this call — their callers reset audioTick via resetTrackers(). */
function notifyChainCycleStateChanged(): void {
  chainCycleStateChangeListener?.();
}

/** Register a listener that fires whenever chain/play-order state is mutated.
 *  Returns an unsubscribe function. Only one listener slot exists; registering
 *  a second listener replaces the first. This slot is owned exclusively by audioTick —
 *  any other registrant will evict it. */
export function onChainCycleStateChanged(listener: ChainCycleStateChangedListener): () => void {
  if (chainCycleStateChangeListener && chainCycleStateChangeListener !== listener) {
    logWarn("onChainCycleStateChanged: replacing existing listener — only audioTick should register here");
  }
  chainCycleStateChangeListener = listener;
  return () => { if (chainCycleStateChangeListener === listener) chainCycleStateChangeListener = null; };
}

// ---------------------------------------------------------------------------
// Layer chain queue
// ---------------------------------------------------------------------------

export function getLayerChain(layerId: string): Sound[] | undefined {
  return layerChainQueue.get(layerId);
}

export function setLayerChain(layerId: string, chain: Sound[]): void {
  layerChainQueue.set(layerId, chain);
  notifyChainCycleStateChanged();
}

export function deleteLayerChain(layerId: string): void {
  layerChainQueue.delete(layerId);
  notifyChainCycleStateChanged();
}

export function clearAllLayerChains(): void {
  layerChainQueue.clear();
}

// ---------------------------------------------------------------------------
// Layer cycle index (cycleMode: one sound per trigger)
//
// Not observed by audioTick — collectLayerSoundLists only reads layerChainQueue
// and layerPlayOrderMap; changes here don't affect the chain/playOrder metrics.
// ---------------------------------------------------------------------------

export function getLayerCycleIndex(layerId: string): number | undefined {
  return layerCycleIndex.get(layerId);
}

export function setLayerCycleIndex(layerId: string, index: number): void {
  layerCycleIndex.set(layerId, index);
}

export function deleteLayerCycleIndex(layerId: string): void {
  layerCycleIndex.delete(layerId);
}

export function clearAllLayerCycleIndexes(): void {
  layerCycleIndex.clear();
}

// ---------------------------------------------------------------------------
// Layer play order tracking (for skip-back)
// ---------------------------------------------------------------------------

export function setLayerPlayOrder(layerId: string, sounds: Sound[]): void {
  layerPlayOrderMap.set(layerId, sounds);
  notifyChainCycleStateChanged();
}

export function getLayerPlayOrder(layerId: string): Sound[] | undefined {
  return layerPlayOrderMap.get(layerId);
}

export function deleteLayerPlayOrder(layerId: string): void {
  layerPlayOrderMap.delete(layerId);
  notifyChainCycleStateChanged();
}

export function clearAllLayerPlayOrders(): void {
  layerPlayOrderMap.clear();
}

// ---------------------------------------------------------------------------
// Layer pending tracking (async-race guard)
//
// Not observed by audioTick — collectLayerSoundLists only reads layerChainQueue
// and layerPlayOrderMap; changes here don't affect the chain/playOrder metrics.
// ---------------------------------------------------------------------------

export function isLayerPending(layerId: string): boolean {
  return layerPendingMap.has(layerId);
}

export function setLayerPending(layerId: string): void {
  layerPendingMap.add(layerId);
}

export function clearLayerPending(layerId: string): void {
  layerPendingMap.delete(layerId);
}

export function clearAllLayerPending(): void {
  layerPendingMap.clear();
}

// ---------------------------------------------------------------------------
// Layer consecutive failure tracking (circuit-breaker for chain load failures)
//
// Not observed by audioTick — collectLayerSoundLists only reads layerChainQueue
// and layerPlayOrderMap; changes here don't affect the chain/playOrder metrics.
// ---------------------------------------------------------------------------

export function getLayerConsecutiveFailures(layerId: string): number {
  return layerConsecutiveFailureMap.get(layerId) ?? 0;
}

export function incrementLayerConsecutiveFailures(layerId: string): number {
  const next = (layerConsecutiveFailureMap.get(layerId) ?? 0) + 1;
  layerConsecutiveFailureMap.set(layerId, next);
  return next;
}

export function resetLayerConsecutiveFailures(layerId: string): void {
  layerConsecutiveFailureMap.delete(layerId);
}

export function clearAllLayerConsecutiveFailures(): void {
  layerConsecutiveFailureMap.clear();
}

// ---------------------------------------------------------------------------
// Full reset
// ---------------------------------------------------------------------------

/** Wipe all per-layer chain/cycle/pending/failure state.
 *
 *  For production teardown (clearAllAudioState on project close) and test setup.
 *  Intentionally does NOT fire the chain-cycle-state-changed listener — the data
 *  is being wiped, so there is nothing left for audioTick to update.
 *
 *  The listener registration is preserved (unlike test-only `clearAll` helpers in
 *  other registries that drop their listener). Because this runs on every project
 *  close, dropping the listener here would permanently detach audioTick after the
 *  first close. The listener is module-lifetime state and must survive clearAll(). */
export function clearAll(): void {
  clearAllLayerChains();
  clearAllLayerCycleIndexes();
  clearAllLayerPlayOrders();
  clearAllLayerPending();
  clearAllLayerConsecutiveFailures();
}
