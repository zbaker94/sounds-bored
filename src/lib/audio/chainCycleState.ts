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
 */

import type { Sound } from "@/lib/schemas";

const layerChainQueue = new Map<string, Sound[]>();
const layerCycleIndex = new Map<string, number>();
const layerPlayOrderMap = new Map<string, Sound[]>();
const layerPendingMap = new Set<string>();
const layerConsecutiveFailureMap = new Map<string, number>();

// ---------------------------------------------------------------------------
// Layer chain queue
// ---------------------------------------------------------------------------

export function getLayerChain(layerId: string): Sound[] | undefined {
  return layerChainQueue.get(layerId);
}

export function setLayerChain(layerId: string, chain: Sound[]): void {
  layerChainQueue.set(layerId, chain);
}

export function deleteLayerChain(layerId: string): void {
  layerChainQueue.delete(layerId);
}

export function clearAllLayerChains(): void {
  layerChainQueue.clear();
}

// ---------------------------------------------------------------------------
// Layer cycle index (cycleMode: one sound per trigger)
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
}

export function getLayerPlayOrder(layerId: string): Sound[] | undefined {
  return layerPlayOrderMap.get(layerId);
}

export function deleteLayerPlayOrder(layerId: string): void {
  layerPlayOrderMap.delete(layerId);
}

export function clearAllLayerPlayOrders(): void {
  layerPlayOrderMap.clear();
}

// ---------------------------------------------------------------------------
// Layer pending tracking (async-race guard)
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

export function clearAll(): void {
  clearAllLayerChains();
  clearAllLayerCycleIndexes();
  clearAllLayerPlayOrders();
  clearAllLayerPending();
  clearAllLayerConsecutiveFailures();
}
