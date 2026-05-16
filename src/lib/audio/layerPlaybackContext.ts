/**
 * layerPlaybackContext.ts — Unified per-layer runtime context.
 *
 * Consolidates the per-layer state that was previously spread across five Maps in
 * chainCycleState.ts, one Map in gainRegistry.ts, and one Map in audioState.ts.
 * All seven fields now live together in a single LayerPlaybackContext object keyed
 * by layer ID, making the complete runtime state of a layer introspectable in one place.
 *
 * Module ownership:
 *   chainCycleState  → delegates chain/cycle/pending/failure field reads/writes here
 *   gainRegistry     → delegates layer gain reads/writes here
 *   audioState       → delegates layerProgressInfo reads/writes here
 *
 * Public API surface is split into three groups so each delegating module imports
 * only what it needs without circular visibility.
 */

import type { Sound } from "@/lib/schemas";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LayerProgressInfo {
  startedAt: number;
  duration: number;
  isLooping: boolean;
}

export interface LayerPlaybackContext {
  /** Immutable — set at creation; identity key. */
  readonly layerId: string;
  /** Written by gainRegistry.getOrCreateLayerGain; '' until a GainNode is wired. */
  padId: string;
  /** Written by gainRegistry; read by gainRegistry and audioTick. */
  gain: GainNode | null;
  /** Written/read by chainCycleState (and layerTrigger directly in trigger path). */
  chainQueue: Sound[] | undefined;
  /** Written/read by chainCycleState (and layerTrigger directly in trigger path). */
  cycleIndex: number | undefined;
  /** Written/read by chainCycleState (and layerTrigger directly in trigger path). */
  playOrder: Sound[] | undefined;
  /** Written/read by chainCycleState (and layerTrigger directly in trigger path). */
  pending: boolean;
  /** Written/read by chainCycleState (and layerTrigger directly in trigger path). */
  consecutiveFailures: number;
  /** Written by audioState.setLayerProgressInfo; read by audioState.computeAllLayerProgress. */
  progressInfo: LayerProgressInfo | undefined;
}

// ---------------------------------------------------------------------------
// Internal Map
// ---------------------------------------------------------------------------

const _contexts = new Map<string, LayerPlaybackContext>();

/** Exported for test introspection only. */
export const _getContextMap = (): ReadonlyMap<string, LayerPlaybackContext> => _contexts;

// ---------------------------------------------------------------------------
// Core accessors
// ---------------------------------------------------------------------------

/** Get context if it exists. Returns undefined for unknown layer IDs. */
export function getLayerContext(layerId: string): LayerPlaybackContext | undefined {
  return _contexts.get(layerId);
}

/**
 * Get or create context, updating gain and padId on an existing entry.
 * Called by gainRegistry when a new GainNode is wired for a layer.
 */
export function getOrCreateLayerContext(
  layerId: string,
  padId: string,
  gain: GainNode,
): LayerPlaybackContext {
  const existing = _contexts.get(layerId);
  if (existing) {
    if (existing.gain && existing.gain !== gain) {
      try { existing.gain.disconnect(); } catch { /* already disconnected */ }
    }
    existing.gain = gain;
    existing.padId = padId;
    return existing;
  }
  const ctx: LayerPlaybackContext = {
    layerId,
    padId,
    gain,
    chainQueue: undefined,
    cycleIndex: undefined,
    playOrder: undefined,
    pending: false,
    consecutiveFailures: 0,
    progressInfo: undefined,
  };
  _contexts.set(layerId, ctx);
  return ctx;
}

/**
 * Get or create context WITHOUT setting a gain node — called by chain/progress
 * setters that may run before gainRegistry has wired up a GainNode for the layer.
 */
export function ensureLayerContext(layerId: string): LayerPlaybackContext {
  const existing = _contexts.get(layerId);
  if (existing) return existing;
  const ctx: LayerPlaybackContext = {
    layerId,
    padId: '',
    gain: null,
    chainQueue: undefined,
    cycleIndex: undefined,
    playOrder: undefined,
    pending: false,
    consecutiveFailures: 0,
    progressInfo: undefined,
  };
  _contexts.set(layerId, ctx);
  return ctx;
}

export function deleteLayerContext(layerId: string): void {
  const ctx = _contexts.get(layerId);
  if (!ctx) return;
  if (ctx.gain) {
    try {
      ctx.gain.disconnect();
    } catch {
      // Gain may already be disconnected during teardown sequences — safe to ignore.
    }
  }
  _contexts.delete(layerId);
}

// ---------------------------------------------------------------------------
// Chain/cycle/pending/failure field helpers (used by chainCycleState)
// ---------------------------------------------------------------------------

/**
 * Zero out chain/cycle/pending/failure fields on all contexts.
 * Gain and progress fields are left intact — those are cleared by their
 * own modules (gainRegistry and audioState respectively).
 *
 * `consecutiveFailures` is intentionally reset here: a fresh stop is a clean
 * slate — any new trigger will start a new failure sequence from zero.
 * `startLayerPlayback` also resets it at trigger time, so this is belt-and-suspenders.
 */
export function clearAllLayerChainFields(): void {
  for (const ctx of _contexts.values()) {
    ctx.chainQueue = undefined;
    ctx.cycleIndex = undefined;
    ctx.playOrder = undefined;
    ctx.pending = false;
    ctx.consecutiveFailures = 0;
  }
}

// ---------------------------------------------------------------------------
// Progress field helpers (used by audioState)
// ---------------------------------------------------------------------------

export function clearLayerContextProgress(layerId: string): void {
  const ctx = _contexts.get(layerId);
  if (ctx) ctx.progressInfo = undefined;
}

export function clearAllLayerContextProgress(): void {
  for (const ctx of _contexts.values()) ctx.progressInfo = undefined;
}

/** Iterate all contexts (used by audioState.computeAllLayerProgress). */
export function getAllLayerContextEntries(): IterableIterator<[string, LayerPlaybackContext]> {
  return _contexts.entries();
}

// ---------------------------------------------------------------------------
// Gain field helpers (used by gainRegistry)
// ---------------------------------------------------------------------------

/** Disconnect and null the gain for a single layer context. */
export function clearLayerContextGain(layerId: string): void {
  const ctx = _contexts.get(layerId);
  if (ctx?.gain) {
    try { ctx.gain.disconnect(); } catch { /* already disconnected */ }
    ctx.gain = null;
  }
}

/** Disconnect and null gains on all layer contexts. */
export function clearAllLayerContextGains(): void {
  for (const ctx of _contexts.values()) {
    if (ctx.gain) {
      try { ctx.gain.disconnect(); } catch { /* already disconnected */ }
      ctx.gain = null;
    }
  }
}

/** Disconnect and null gains for a specific set of layer IDs.
 *  Context entries are preserved — the same layer ID may be re-triggered
 *  during the ramp window and would lose its chain state if the context were deleted. */
export function clearLayerContextGainsForIds(layerIds: ReadonlySet<string>): void {
  for (const layerId of layerIds) clearLayerContextGain(layerId);
}

/**
 * Iterate contexts that have an active GainNode for the given active layer IDs.
 * Used by gainRegistry.forEachActiveLayerGain (which is called by audioTick).
 */
export function forEachLayerContextWithGain(
  activeLayerIds: ReadonlySet<string>,
  fn: (layerId: string, gain: GainNode) => void,
): void {
  for (const layerId of activeLayerIds) {
    const gain = _contexts.get(layerId)?.gain;
    if (gain) fn(layerId, gain);
  }
}

// ---------------------------------------------------------------------------
// Full teardown (project close / test reset)
// ---------------------------------------------------------------------------

/**
 * Disconnect all layer gains and delete all context entries.
 *
 * Called by gainRegistry.clearAll() after stopAllVoices(), so gains are
 * disconnected only after voices have stopped — preserving the invariant that
 * voices stop against a connected downstream graph.
 *
 * Also called directly in test beforeEach hooks for full isolation when
 * chainCycleState.clearAll() alone (chain fields only) is insufficient.
 */
export function clearAllLayerContexts(): void {
  for (const ctx of _contexts.values()) {
    if (ctx.gain) {
      try {
        ctx.gain.disconnect();
      } catch {
        // Gain may already be disconnected during teardown sequences — safe to ignore.
      }
    }
  }
  _contexts.clear();
}
