/**
 * chainCycleState.ts — Per-layer chain, cycle, pending, and consecutive-failure state.
 *
 * Delegates all per-layer storage to LayerPlaybackContext in layerPlaybackContext.ts.
 * The five Maps that previously lived here (layerChainQueue, layerCycleIndex,
 * layerPlayOrderMap, layerPendingMap, layerConsecutiveFailureMap) are replaced by
 * fields on LayerPlaybackContext so that the complete runtime state of a layer is
 * co-located in a single object.
 *
 * A single chain-cycle-state-changed listener slot is used by audioTick to know
 * when to rebuild the chain/playOrder metrics. Chain and play-order mutation sites
 * notify via the private helper rather than incrementing a counter, so future
 * mutation paths automatically signal the listener.
 */

import { logWarn } from "@/lib/logger";
import type { Sound } from "@/lib/schemas";
import {
  ensureLayerContext,
  getLayerContext,
  clearAllLayerChainFields,
} from "./layerPlaybackContext";

// ---------------------------------------------------------------------------
// Mutation listener
// ---------------------------------------------------------------------------

type ChainCycleStateChangedListener = () => void;
let chainCycleStateChangeListener: ChainCycleStateChangedListener | null = null;

/** Fire the chain/play-order change listener.
 *
 *  INVARIANT: Must be called after every single-entry chain/play-order mutation —
 *  whether via the module-level setters (setLayerChain, deleteLayerChain,
 *  setLayerPlayOrder, deleteLayerPlayOrder) or via direct LayerPlaybackContext
 *  field writes in layerTrigger's hot trigger path.
 *
 *  Bulk-clear helpers intentionally omit this call — their callers reset audioTick
 *  via resetTrackers(). */
export function notifyChainCycleStateChanged(): void {
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
  return getLayerContext(layerId)?.chainQueue;
}

export function setLayerChain(layerId: string, chain: Sound[]): void {
  ensureLayerContext(layerId).chainQueue = chain;
  notifyChainCycleStateChanged();
}

export function deleteLayerChain(layerId: string): void {
  const ctx = getLayerContext(layerId);
  if (!ctx) return;
  ctx.chainQueue = undefined;
  notifyChainCycleStateChanged();
}

// ---------------------------------------------------------------------------
// Layer cycle index (cycleMode: one sound per trigger)
//
// Not observed by audioTick — collectLayerSoundLists only reads chainQueue
// and playOrder context fields; changes here don't affect the chain/playOrder metrics.
// ---------------------------------------------------------------------------

export function getLayerCycleIndex(layerId: string): number | undefined {
  return getLayerContext(layerId)?.cycleIndex;
}

export function setLayerCycleIndex(layerId: string, index: number): void {
  ensureLayerContext(layerId).cycleIndex = index;
}

export function deleteLayerCycleIndex(layerId: string): void {
  const ctx = getLayerContext(layerId);
  if (ctx) ctx.cycleIndex = undefined;
}

// ---------------------------------------------------------------------------
// Layer play order tracking (for skip-back)
// ---------------------------------------------------------------------------

export function setLayerPlayOrder(layerId: string, sounds: Sound[]): void {
  ensureLayerContext(layerId).playOrder = sounds;
  notifyChainCycleStateChanged();
}

export function getLayerPlayOrder(layerId: string): Sound[] | undefined {
  return getLayerContext(layerId)?.playOrder;
}

export function deleteLayerPlayOrder(layerId: string): void {
  const ctx = getLayerContext(layerId);
  if (!ctx) return;
  ctx.playOrder = undefined;
  notifyChainCycleStateChanged();
}

// ---------------------------------------------------------------------------
// Layer pending tracking (async-race guard)
//
// Not observed by audioTick — collectLayerSoundLists only reads chainQueue
// and playOrder context fields; changes here don't affect the chain/playOrder metrics.
// ---------------------------------------------------------------------------

export function isLayerPending(layerId: string): boolean {
  return getLayerContext(layerId)?.pending ?? false;
}

export function setLayerPending(layerId: string): void {
  ensureLayerContext(layerId).pending = true;
}

export function clearLayerPending(layerId: string): void {
  const ctx = getLayerContext(layerId);
  if (ctx) ctx.pending = false;
}

// ---------------------------------------------------------------------------
// Layer consecutive failure tracking (circuit-breaker for chain load failures)
//
// Not observed by audioTick — collectLayerSoundLists only reads chainQueue
// and playOrder context fields; changes here don't affect the chain/playOrder metrics.
// ---------------------------------------------------------------------------

export function getLayerConsecutiveFailures(layerId: string): number {
  return getLayerContext(layerId)?.consecutiveFailures ?? 0;
}

export function incrementLayerConsecutiveFailures(layerId: string): number {
  const ctx = ensureLayerContext(layerId);
  ctx.consecutiveFailures = ctx.consecutiveFailures + 1;
  return ctx.consecutiveFailures;
}

export function resetLayerConsecutiveFailures(layerId: string): void {
  const ctx = getLayerContext(layerId);
  if (ctx) ctx.consecutiveFailures = 0;
}

// ---------------------------------------------------------------------------
// Full reset
// ---------------------------------------------------------------------------

/** Wipe all per-layer chain/cycle/pending/failure fields on every context.
 *
 *  Scope: chain/cycle/pending/failure state only. Context entries and gain nodes
 *  are owned by layerPlaybackContext/gainRegistry and are left intact — gainRegistry
 *  tears them down after voices have stopped.
 *
 *  Intentionally does NOT fire the chain-cycle-state-changed listener — the data
 *  is being wiped, so there is nothing left for audioTick to update.
 *
 *  The listener registration is preserved (unlike test-only `clearAll` helpers in
 *  other registries that drop their listener). Because this runs on every project
 *  close, dropping the listener here would permanently detach audioTick after the
 *  first close. The listener is module-lifetime state and must survive clearAll(). */
export function clearAll(): void {
  clearAllLayerChainFields();
}
