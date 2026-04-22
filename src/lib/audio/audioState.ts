/**
 * audioState.ts — Non-serializable audio engine runtime state
 *
 * This module owns ALL runtime Maps/Sets used by the audio engine (padPlayer.ts).
 * These are kept separate from Zustand (playbackStore) because they contain
 * non-serializable Web Audio objects (GainNode, HTMLAudioElement) that cannot
 * live in a Zustand store.
 *
 * ============================================================================
 * COORDINATION WITH playbackStore
 * ============================================================================
 *
 * This module is the SINGLE owner of ALL non-serializable audio engine runtime state.
 * playbackStore (Zustand) holds only reactive UI signals (playingPadIds, padVolumes,
 * volumeTransitioningPadIds). Voice tracking functions in this module call
 * playbackStore's simple addPlayingPad/removePlayingPad/clearAllPlayingPads actions
 * to keep the reactive UI layer in sync.
 *
 * INVARIANT: Never call stopAllVoices() without first clearing chain queues and
 *   fade tracking. Reason: voice.stop() fires onended synchronously, which reads
 *   layerChainQueue. If the queue is not cleared first, onended will advance the
 *   chain and restart sounds.
 *
 * INVARIANT: Always use padPlayer.stopAllPads() as the single stop entry point.
 *   It clears fade tracking and chain queues first, nulls onended callbacks,
 *   ramps gain nodes to zero, then calls stopAllVoices().
 *
 * INVARIANT: padGainMap lifecycle mirrors voiceMap lifecycle — a pad entry in one
 *   implies an entry in the other. Both are cleared together in stopAllPads().
 *
 * INVARIANT: stopAllVoices() calls clearAllPlayingPads() on playbackStore to
 *   reset the reactive UI state after all voices are stopped.
 *
 * ============================================================================
 * STATE INVENTORY
 * ============================================================================
 *
 * Name               | Keys       | Values                                    | Purpose                                         | Cleared by
 * -------------------|------------|-------------------------------------------|-------------------------------------------------|-----------------------------------
 * padGainMap         | pad ID     | GainNode                                  | Per-pad gain node in audio graph                | clearAllPadGains() (disconnects+clears), stopAllPads()
 * layerGainMap       | layer ID   | GainNode                                  | Per-layer gain node, connects to padGain        | clearAllLayerGains() (disconnects+clears), stopAllPads()
 * voiceMap           | pad ID     | AudioVoice[]                              | Active voices per pad (UI + stop tracking)      | clearAllVoices(), stopAllVoices()
 * layerVoiceMap      | layer ID   | AudioVoice[]                              | Active voices per layer                         | clearAllVoices(), stopAllVoices()
 * padProgressInfo    | pad ID     | { startedAt, duration, isLooping }        | Tracks longest-duration voice for progress bar  | clearPadProgressInfo(), stopAllPads()
 * layerProgressInfo  | layer ID   | { startedAt, duration, isLooping }        | Per-layer progress info for per-layer bars      | clearLayerProgressInfo(), stopAllPads()
 * padStreamingAudio  | pad ID     | Map<layerId, Set<HTMLAudioElement>>        | Active streaming elements for progress/cleanup  | clearLayerStreamingAudio(), stopAllPads()
 * layerChainQueue    | layer ID   | Sound[]                                   | Remaining sounds in sequential/shuffled chain   | deleteLayerChain(), clearAllLayerChains()
 * layerCycleIndex    | layer ID   | number                                    | Next play-order index for cycleMode layers      | deleteLayerCycleIndex(), clearAllLayerCycleIndexes()
 * layerPendingMap    | layer ID   | (Set membership)                          | Guards against async race on rapid retrigger    | clearLayerPending()
 * layerConsecutiveFailureMap | layer ID | number                             | Consecutive chain load failures (circuit-break) | resetLayerConsecutiveFailures(), clearAllLayerConsecutiveFailures()
 * fadePadTimeouts    | pad ID     | timeout ID                                | Pending fade cleanup timeouts                   | cancelPadFade(), clearAllFadeTracking()
 * fadingOutPadIds    | pad ID     | (Set membership)                          | Tracks pads actively fading out (gain -> 0)     | cancelPadFade(), clearAllFadeTracking()
 * padFadeDirection   | pad ID     | "in" | "out"                              | Last direction faded — drives next toggle dir   | cancelPadFade(), clearAllFadeTracking()
 */

import { getAudioContext, getMasterGain } from "./audioContext";
import { clearAllBuffers } from "./bufferCache";
import { clearAllStreamingElements, clearAllSizeCache } from "./streamingCache";
import { usePlaybackStore } from "@/state/playbackStore";
import type { AudioVoice } from "./audioVoice";
import type { Sound } from "@/lib/schemas";

// ---------------------------------------------------------------------------
// Private state — all 11 Maps/Sets
// ---------------------------------------------------------------------------

/** Per-pad GainNodes: source(s) -> voiceGain -> layerGain -> padGain -> masterGain -> destination */
const padGainMap = new Map<string, GainNode>();

/** Active voices per pad. Every layer voice is also in voiceMap — see recordLayerVoice invariant. */
const voiceMap = new Map<string, AudioVoice[]>();

/** Active voices per layer. */
const layerVoiceMap = new Map<string, AudioVoice[]>();

/**
 * Reverse index: pad ID → Set of layer IDs with active voices for that pad.
 * Maintained alongside layerVoiceMap to allow stopPadVoices to touch only the
 * layers belonging to the stopped pad — O(layers_in_pad) instead of O(all_layers).
 * Exported with underscore prefix for test introspection only.
 */
export const _padToLayerIds = new Map<string, Set<string>>();

/**
 * Incremented whenever a layer voice is added or removed. The audioTick loop
 * reads this to skip `new Set(layerVoiceMap.keys())` on frames where the active
 * layer set is unchanged — avoids one per-frame Set allocation during stable playback.
 */
let layerVoiceVersion = 0;

export function getLayerVoiceVersion(): number {
  return layerVoiceVersion;
}

/** Keyed by layer ID. One GainNode per active layer, connects to its padGain. */
const layerGainMap = new Map<string, GainNode>();

/** Tracks the longest-duration voice per pad for playback progress display (buffer path). */
const padProgressInfo = new Map<string, { startedAt: number; duration: number; isLooping: boolean }>();

/** Tracks per-layer progress info for buffer path voices. One entry per active layer. */
const layerProgressInfo = new Map<string, { startedAt: number; duration: number; isLooping: boolean }>();

/**
 * Tracks all active streaming elements per pad per layer for progress display and cleanup.
 * pad ID -> layer ID -> Set<HTMLAudioElement>. Per-layer keying ensures 'continue'-mode
 * retriggers preserve progress tracking for layers that do not restart.
 * HTMLAudioElement exposes currentTime/duration after loadedmetadata fires.
 *
 * @internal Mutate only via registerStreamingAudio / unregisterStreamingAudio /
 * clearLayerStreamingAudio / clearAllStreamingAudio so the best-element caches
 * (_padBestStreamingAudio / _layerBestStreamingAudio) remain consistent.
 */
const padStreamingAudio = new Map<string, Map<string, Set<HTMLAudioElement>>>();

/**
 * Cached "best" (longest-duration) streaming element per pad.
 * Recomputed on register/unregister/clear — never on the RAF hot path.
 * `getPadProgress` does a single Map lookup instead of a nested linear scan.
 * Exported with underscore prefix for test introspection only.
 */
export const _padBestStreamingAudio = new Map<string, HTMLAudioElement>();

/**
 * Cached "best" (longest-duration) streaming element per layer.
 * Same invalidation model as _padBestStreamingAudio.
 * `computeAllLayerProgress` does a single Map lookup per layer.
 * Exported with underscore prefix for test introspection only.
 */
export const _layerBestStreamingAudio = new Map<string, HTMLAudioElement>();

/** Pick the element with the longest *finite* duration from a Set. NaN-duration elements
 *  are treated as -Infinity so any finite-duration element wins over an unloaded one. */
function pickBestStreaming(audioSet: Iterable<HTMLAudioElement>): HTMLAudioElement | null {
  let best: HTMLAudioElement | null = null;
  let bestDur = -Infinity;
  for (const audio of audioSet) {
    const d = isFinite(audio.duration) ? audio.duration : -Infinity;
    if (!best || d > bestDur) { best = audio; bestDur = d; }
  }
  return best;
}

/** Recompute the best streaming element for a pad from scratch. */
function recomputePadBestStreaming(padId: string): void {
  const layerMap = padStreamingAudio.get(padId);
  if (!layerMap) { _padBestStreamingAudio.delete(padId); return; }
  // Flatten all elements across all layers and pick the best
  function* allElements() {
    for (const audioSet of layerMap!.values()) yield* audioSet;
  }
  const best = pickBestStreaming(allElements());
  if (best) { _padBestStreamingAudio.set(padId, best); }
  else { _padBestStreamingAudio.delete(padId); }
}

/** Recompute the best streaming element for a specific layer. */
function recomputeLayerBestStreaming(padId: string, layerId: string): void {
  const audioSet = padStreamingAudio.get(padId)?.get(layerId);
  if (!audioSet || audioSet.size === 0) { _layerBestStreamingAudio.delete(layerId); return; }
  const best = pickBestStreaming(audioSet);
  if (best) { _layerBestStreamingAudio.set(layerId, best); }
  else { _layerBestStreamingAudio.delete(layerId); }
}

/** Remaining sounds to auto-chain after the current one ends (sequential/shuffled).
 *  Keyed by layer ID. Deleted when the chain is broken (stop/restart) or exhausted. */
const layerChainQueue = new Map<string, Sound[]>();

/** Cycle cursor: tracks the next index into the play order for layers with cycleMode=true.
 *  Keyed by layer ID. Persists across triggers so each trigger advances to the next sound.
 *  Deleted when the layer is stopped via stopAllPads or when cycleMode is toggled off. */
const layerCycleIndex = new Map<string, number>();

/** Layer IDs currently awaiting startLayerSound — guards against async race on rapid retrigger. */
const layerPendingMap = new Set<string>();

/** Counts consecutive `loadLayerVoice` failures per layer, used to short-circuit
 *  a failing chain (e.g. missing library) instead of spamming one toast per
 *  chained sound. Reset on a successful voice start or when the circuit trips. */
const layerConsecutiveFailureMap = new Map<string, number>();

/** Stores the original play order for a layer chain so skip-back can derive the previous sound.
 *  Keyed by layer ID. Set when a chain is started; cleared on stopAllPads / stopPad. */
const layerPlayOrderMap = new Map<string, Sound[]>();

/** Pending fade cleanup timeouts, keyed by pad ID. Used by both fadePadOut and fadePadIn. */
const fadePadTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

/** Tracks pads that are actively fading out (gain -> 0). Cleared when fade completes or is cancelled. */
const fadingOutPadIds = new Set<string>();

/**
 * Records the direction of the most recent fade per pad ("in" or "out").
 * Set by fadePadOut / fadePadInFromCurrent / fadePadIn; cleared by cancelPadFade.
 * Lets applyFadeToggle pick the correct next direction even after boundary changes
 * have shifted fadeLowVol away from the gain node's current value.
 */
const padFadeDirection = new Map<string, "in" | "out">();

/**
 * Tracks pads that have started a fade-in but whose async triggerPad has not yet completed.
 * Set synchronously before `await triggerPad` in fadePadIn; cleared by cancelPadFade.
 * Lets fadePadIn detect post-await that it was pre-empted by a reverse-fade call during the gap.
 */
const fadingInPadIds = new Set<string>();

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
// Public query functions
// ---------------------------------------------------------------------------

export function isPadFadingOut(padId: string): boolean {
  return fadingOutPadIds.has(padId);
}

export function isPadFading(padId: string): boolean {
  return fadePadTimeouts.has(padId);
}

/** True while a streaming (large-file) voice is active for this pad. */
export function isPadStreaming(padId: string): boolean {
  const layerMap = padStreamingAudio.get(padId);
  return !!layerMap && layerMap.size > 0;
}

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
  const best = _padBestStreamingAudio.get(padId);
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
 * Get the GainNode for a pad, creating and connecting it to masterGain if it doesn't exist.
 * This is a get-or-create operation — it always returns a valid GainNode.
 * Only call this when the pad is active or about to become active.
 */
export function getPadGain(padId: string): GainNode {
  const existing = padGainMap.get(padId);
  if (existing) return existing;
  const ctx = getAudioContext();
  const gain = ctx.createGain();
  gain.gain.value = 1.0;
  gain.connect(getMasterGain());
  padGainMap.set(padId, gain);
  return gain;
}

/** Iterate all existing pad gain nodes. Used by stopAllPads to ramp all pads to zero. */
export function forEachPadGain(fn: (padId: string, gain: GainNode) => void): void {
  for (const [padId, gain] of padGainMap) {
    fn(padId, gain);
  }
}

/** Iterate active pad gain nodes — only pads currently in voiceMap (with active voices). */
export function forEachActivePadGain(fn: (padId: string, gain: GainNode) => void): void {
  for (const padId of voiceMap.keys()) {
    const gain = padGainMap.get(padId);
    if (gain) fn(padId, gain);
  }
}

/** Return the number of pads with active voices. Used by the tick to self-terminate. */
export function getActivePadCount(): number {
  return voiceMap.size;
}

/** Iterate active layer gain nodes — only layers currently in layerVoiceMap. */
export function forEachActiveLayerGain(fn: (layerId: string, gain: GainNode) => void): void {
  for (const layerId of layerVoiceMap.keys()) {
    const gain = layerGainMap.get(layerId);
    if (gain) fn(layerId, gain);
  }
}

/** Return the Set of currently active layer IDs (layers with at least one voice). */
export function getActiveLayerIdSet(): Set<string> {
  return new Set(layerVoiceMap.keys());
}

/**
 * Compute padProgress for all active pads in one pass.
 * Returns a Record<padId, progress 0–1>. Pads with no progress info are omitted.
 * Reads AudioContext.currentTime once and passes it to getPadProgress — mirrors computeAllLayerProgress.
 */
export function computeAllPadProgress(): Record<string, number> {
  const result: Record<string, number> = {};
  if (voiceMap.size === 0) return result;
  // Hoist a single currentTime read for all active pads — mirrors computeAllLayerProgress.
  const currentTime = getAudioContext().currentTime;
  for (const padId of voiceMap.keys()) {
    const progress = getPadProgress(padId, currentTime);
    if (progress !== null) result[padId] = progress;
  }
  return result;
}

/**
 * Compute layerProgress for all active layers in one pass.
 * Returns a Record<layerId, progress 0–1>.
 * Buffer layers are tracked via layerProgressInfo; streaming layers via padStreamingAudio.
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

  // Streaming layers — use cached best element per layer (O(1) lookup per layer)
  for (const [layerId, best] of _layerBestStreamingAudio) {
    if (layerId in result) continue; // already from buffer path
    const d = best.duration;
    result[layerId] = d > 0 && isFinite(d) ? Math.min(1, Math.max(0, best.currentTime / d)) : 0;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Bulk clear functions (test isolation + stopAllPads)
// ---------------------------------------------------------------------------

export function clearAllPadGains(): void {
  for (const gain of padGainMap.values()) gain.disconnect();
  padGainMap.clear();
}

export function clearAllLayerGains(): void {
  for (const gain of layerGainMap.values()) gain.disconnect();
  layerGainMap.clear();
}

export function clearAllLayerChains(): void {
  layerChainQueue.clear();
}

export function clearAllLayerCycleIndexes(): void {
  layerCycleIndex.clear();
}

export function clearAllVoices(): void {
  voiceMap.clear();
  layerVoiceMap.clear();
  _padToLayerIds.clear();
  layerVoiceVersion++;
}

export function clearAllFadeTracking(): void {
  for (const id of fadePadTimeouts.values()) clearTimeout(id);
  fadePadTimeouts.clear();
  fadingOutPadIds.clear();
  fadingInPadIds.clear();
  padFadeDirection.clear();
  // padFadeRafs removed — global audioTick owns padVolumes now.
  // Store clearing is handled by stopAudioTick() in padPlayer.stopAllPads().
}

// ---------------------------------------------------------------------------
// Fade tracking functions (used internally by padPlayer fade operations)
// ---------------------------------------------------------------------------

/**
 * Cancel all fade-related resources for a pad: pending timeout and fadingOut tracking.
 * The global audioTick handles padVolumes — no store call needed here.
 * Safe to call even if no fade is registered -- all operations are idempotent.
 */
export function cancelPadFade(padId: string): void {
  const tId = fadePadTimeouts.get(padId);
  if (tId !== undefined) {
    clearTimeout(tId);
    fadePadTimeouts.delete(padId);
  }
  fadingOutPadIds.delete(padId);
  padFadeDirection.delete(padId);
  // fadingInPadIds is NOT cleared here — triggerPad calls cancelPadFade internally
  // and must not accidentally pre-empt a fadePadIn that is still in flight.
  // Only fadePadOut (explicit reversal) and clearAllFadeTracking clear fadingInPadIds.
}

/** Record the direction of the most recent fade for a pad. */
export function setPadFadeDirection(padId: string, direction: "in" | "out"): void {
  padFadeDirection.set(padId, direction);
}

/** Return the direction of the most recent fade, or undefined if no fade has run. */
export function getPadFadeDirection(padId: string): "in" | "out" | undefined {
  return padFadeDirection.get(padId);
}

/** Mark a pad as fading out. */
export function addFadingOutPad(padId: string): void {
  fadingOutPadIds.add(padId);
}

/** Remove a pad from fading-out tracking. */
export function removeFadingOutPad(padId: string): void {
  fadingOutPadIds.delete(padId);
}

/** Mark a pad as starting a fade-in (set before await in fadePadIn to cover the async gap). */
export function addFadingInPad(padId: string): void {
  fadingInPadIds.add(padId);
}

/** Remove a pad from fading-in tracking. */
export function removeFadingInPad(padId: string): void {
  fadingInPadIds.delete(padId);
}

/** True while a fade-in is starting (async gap) or its timeout is registered. */
export function isPadFadingIn(padId: string): boolean {
  return fadingInPadIds.has(padId);
}

/** Store a fade timeout for a pad (so cancelPadFade can cancel it). */
export function setFadePadTimeout(padId: string, timeoutId: ReturnType<typeof setTimeout>): void {
  fadePadTimeouts.set(padId, timeoutId);
}

/** Delete a fade timeout entry for a pad. */
export function deleteFadePadTimeout(padId: string): void {
  fadePadTimeouts.delete(padId);
}

// ---------------------------------------------------------------------------
// Layer gain functions
// ---------------------------------------------------------------------------

/**
 * Get or create a GainNode for the given layer, connecting it to `padGain`.
 *
 * @param normalizedVolume - Normalized gain in [0,1]. Non-finite values (NaN, Infinity) clamp to 1.
 */
export function getOrCreateLayerGain(layerId: string, normalizedVolume: number, padGain: GainNode): GainNode {
  const clamped = Number.isFinite(normalizedVolume) ? Math.max(0, Math.min(1, normalizedVolume)) : 1;
  const ctx = getAudioContext();
  const existing = layerGainMap.get(layerId);
  if (existing) {
    // Sync cached gain to the current layer.volume in case it was changed via the config dialog.
    // cancelScheduledValues clears any pending reset from a previous ramp-stop timeout.
    existing.gain.cancelScheduledValues(ctx.currentTime);
    existing.gain.setValueAtTime(clamped, ctx.currentTime);
    return existing;
  }
  const gain = ctx.createGain();
  gain.gain.value = clamped;
  gain.connect(padGain);
  layerGainMap.set(layerId, gain);
  return gain;
}

/** Get a layer gain node by ID. Returns undefined if not active. */
export function getLayerGain(layerId: string): GainNode | undefined {
  return layerGainMap.get(layerId);
}

// ---------------------------------------------------------------------------
// Streaming audio tracking
// ---------------------------------------------------------------------------

/** Remove a single layer's streaming audio entry. Called when retrigger modes null
 *  the onended callback before stopping, preventing the normal cleanup path. */
export function clearLayerStreamingAudio(padId: string, layerId: string): void {
  const padLayerMap = padStreamingAudio.get(padId);
  if (!padLayerMap) return;
  padLayerMap.delete(layerId);
  if (padLayerMap.size === 0) padStreamingAudio.delete(padId);
  _layerBestStreamingAudio.delete(layerId);
  recomputePadBestStreaming(padId);
}

export function registerStreamingAudio(padId: string, layerId: string, el: HTMLAudioElement): void {
  let padLayerMap = padStreamingAudio.get(padId);
  if (!padLayerMap) {
    padLayerMap = new Map();
    padStreamingAudio.set(padId, padLayerMap);
  }
  const audioSet = padLayerMap.get(layerId) ?? new Set<HTMLAudioElement>();
  audioSet.add(el);
  padLayerMap.set(layerId, audioSet);
  recomputePadBestStreaming(padId);
  recomputeLayerBestStreaming(padId, layerId);
  // If duration is not yet known, re-evaluate once metadata loads so the cache
  // reflects the true duration rather than NaN.
  // Membership guard: only recompute if the element is still registered at fire time.
  // This makes the listener a safe no-op after unregister and prevents stale closures
  // from corrupting the cache when the same HTMLAudioElement is reused across triggers
  // (streamingCache reuses elements per sound.id).
  if (!isFinite(el.duration)) {
    el.addEventListener("loadedmetadata", () => {
      if (padStreamingAudio.get(padId)?.get(layerId)?.has(el)) {
        recomputePadBestStreaming(padId);
        recomputeLayerBestStreaming(padId, layerId);
      }
    }, { once: true });
  }
}

export function unregisterStreamingAudio(padId: string, layerId: string, el: HTMLAudioElement): void {
  const padLayerMap = padStreamingAudio.get(padId);
  if (!padLayerMap) return;
  const audioSet = padLayerMap.get(layerId);
  if (!audioSet) return;
  audioSet.delete(el);
  if (audioSet.size === 0) padLayerMap.delete(layerId);
  if (padLayerMap.size === 0) padStreamingAudio.delete(padId);
  recomputePadBestStreaming(padId);
  recomputeLayerBestStreaming(padId, layerId);
}

/** Clear all streaming audio tracking. */
export function clearAllStreamingAudio(): void {
  padStreamingAudio.clear();
  _padBestStreamingAudio.clear();
  _layerBestStreamingAudio.clear();
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

/** Clear all pad progress info. */
export function clearAllPadProgressInfo(): void {
  padProgressInfo.clear();
}

// ---------------------------------------------------------------------------
// Layer progress tracking (per-layer progress bars, buffer path only)
// ---------------------------------------------------------------------------

export function setLayerProgressInfo(layerId: string, info: { startedAt: number; duration: number; isLooping: boolean }): void {
  layerProgressInfo.set(layerId, info);
}

export function clearLayerProgressInfo(layerId: string): void {
  layerProgressInfo.delete(layerId);
}

export function clearAllLayerProgressInfo(): void {
  layerProgressInfo.clear();
}

// ---------------------------------------------------------------------------
// Layer pending tracking
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

/** Read the current consecutive-failure count for a layer (0 when absent). */
export function getLayerConsecutiveFailures(layerId: string): number {
  return layerConsecutiveFailureMap.get(layerId) ?? 0;
}

/** Increment the consecutive-failure count for a layer and return the new value. */
export function incrementLayerConsecutiveFailures(layerId: string): number {
  const next = (layerConsecutiveFailureMap.get(layerId) ?? 0) + 1;
  layerConsecutiveFailureMap.set(layerId, next);
  return next;
}

/** Reset the consecutive-failure count for a layer (call after a successful start). */
export function resetLayerConsecutiveFailures(layerId: string): void {
  layerConsecutiveFailureMap.delete(layerId);
}

/** Clear all consecutive-failure state (called from clearAllAudioState). */
export function clearAllLayerConsecutiveFailures(): void {
  layerConsecutiveFailureMap.clear();
}

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

// ---------------------------------------------------------------------------
// Voice tracking
// ---------------------------------------------------------------------------

export function isPadActive(padId: string): boolean {
  return (voiceMap.get(padId)?.length ?? 0) > 0;
}

export function isLayerActive(layerId: string): boolean {
  return (layerVoiceMap.get(layerId)?.length ?? 0) > 0;
}

export function recordVoice(padId: string, voice: AudioVoice): void {
  voiceMap.set(padId, [...(voiceMap.get(padId) ?? []), voice]);
  usePlaybackStore.getState().addPlayingPad(padId);
}

/**
 * Clear padVolumes[padId] from the store in the same synchronous transaction as
 * removePlayingPad. The audioTick only clears padVolumes in the next RAF frame;
 * without this, there is a one-frame window where playingPadIds is cleared but
 * padVolumes still has a value, causing the volume bar to flash after a pad ends.
 * Called from every code path that removes the last voice for a pad.
 */
function clearPadVolumesEntry(padId: string): void {
  const store = usePlaybackStore.getState();
  if (padId in store.padVolumes) {
    const { [padId]: _dropped, ...rest } = store.padVolumes;
    store.setAudioTick({ padVolumes: rest });
  }
}

export function clearVoice(padId: string, voice: AudioVoice): void {
  const updated = (voiceMap.get(padId) ?? []).filter((v) => v !== voice);
  if (updated.length === 0) {
    voiceMap.delete(padId);
    usePlaybackStore.getState().removePlayingPad(padId);
    clearPadVolumesEntry(padId);
  } else {
    voiceMap.set(padId, updated);
  }
}

export function stopPadVoices(padId: string): void {
  const voices = voiceMap.get(padId) ?? [];
  const stoppedSet = new Set(voices);
  voiceMap.delete(padId);
  usePlaybackStore.getState().removePlayingPad(padId);
  clearPadVolumesEntry(padId);
  // Use reverse index to touch only layers belonging to this pad — O(layers_in_pad).
  // Per invariant, every layer voice is also a pad voice, so stoppedSet covers all
  // voices in every tracked layer. The `remaining.length > 0` branch is dead under
  // normal operation but kept defensively; when triggered, the layer stays in the
  // index so the reverse-index remains consistent.
  const padLayers = _padToLayerIds.get(padId);
  if (padLayers) {
    for (const layerId of padLayers) {
      const remaining = (layerVoiceMap.get(layerId) ?? []).filter((v) => !stoppedSet.has(v));
      if (remaining.length === 0) {
        layerVoiceMap.delete(layerId);
        padLayers.delete(layerId);
      } else {
        layerVoiceMap.set(layerId, remaining);
      }
    }
    if (padLayers.size === 0) _padToLayerIds.delete(padId);
  }
  layerVoiceVersion++;
  for (const voice of voices) {
    try { voice.stop(); } catch { /* already ended */ }
  }
}

export function stopAllVoices(): void {
  // NOTE: Always call padPlayer.stopAllPads() instead of this directly.
  // stopAllPads() ensures chain queues, fade tracking, and gain ramps are
  // handled before voices are stopped.
  const allVoices = [...voiceMap.values()].flat();
  voiceMap.clear();
  layerVoiceMap.clear();
  _padToLayerIds.clear();
  layerVoiceVersion++;
  const store = usePlaybackStore.getState();
  store.clearAllPlayingPads();
  // Clear padVolumes in the same transaction as clearAllPlayingPads (same race as #217).
  store.setAudioTick({ padVolumes: {} });
  for (const voice of allVoices) {
    try { voice.stop(); } catch { /* already ended */ }
  }
}

export function recordLayerVoice(padId: string, layerId: string, voice: AudioVoice): void {
  layerVoiceMap.set(layerId, [...(layerVoiceMap.get(layerId) ?? []), voice]);
  let padLayers = _padToLayerIds.get(padId);
  if (!padLayers) {
    padLayers = new Set();
    _padToLayerIds.set(padId, padLayers);
  }
  padLayers.add(layerId);
  layerVoiceVersion++;
  recordVoice(padId, voice);
}

export function clearLayerVoice(padId: string, layerId: string, voice: AudioVoice): void {
  const updated = (layerVoiceMap.get(layerId) ?? []).filter((v) => v !== voice);
  if (updated.length === 0) {
    layerVoiceMap.delete(layerId);
    const padLayers = _padToLayerIds.get(padId);
    if (padLayers) {
      padLayers.delete(layerId);
      if (padLayers.size === 0) _padToLayerIds.delete(padId);
    }
  } else {
    layerVoiceMap.set(layerId, updated);
  }
  layerVoiceVersion++;
  clearVoice(padId, voice);
}

export function stopLayerVoices(padId: string, layerId: string): void {
  const voices = layerVoiceMap.get(layerId) ?? [];
  const stoppedSet = new Set(voices);

  // Clean up maps BEFORE calling stop() — wrapStreamingElement.stop()
  // fires onended synchronously, so clearing first makes clearLayerVoice a safe no-op.
  layerVoiceMap.delete(layerId);
  const padLayers = _padToLayerIds.get(padId);
  if (padLayers) {
    padLayers.delete(layerId);
    if (padLayers.size === 0) _padToLayerIds.delete(padId);
  }
  layerVoiceVersion++;
  const padVoices = (voiceMap.get(padId) ?? []).filter((v) => !stoppedSet.has(v));
  if (padVoices.length === 0) {
    voiceMap.delete(padId);
    usePlaybackStore.getState().removePlayingPad(padId);
    clearPadVolumesEntry(padId);
  } else {
    voiceMap.set(padId, padVoices);
  }

  for (const voice of voices) {
    try { voice.stop(); } catch { /* already ended */ }
  }
}

export function getLayerVoices(layerId: string): readonly AudioVoice[] {
  return layerVoiceMap.get(layerId) ?? [];
}

export function nullAllOnEnded(): void {
  for (const voices of voiceMap.values()) {
    for (const voice of voices) {
      voice.setOnEnded(null);
    }
  }
}

/** Null onended callbacks for all voices belonging to a specific pad. */
export function nullPadOnEnded(padId: string): void {
  const voices = voiceMap.get(padId) ?? [];
  for (const voice of voices) {
    voice.setOnEnded(null);
  }
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
// Layer volume accessor
// ---------------------------------------------------------------------------

/** Read the current gain value for a layer. Returns 1.0 if the layer has no active gain node. */
export function getLayerVolume(layerId: string): number {
  const gain = layerGainMap.get(layerId);
  return gain ? gain.gain.value : 1.0;
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
export function clearAllStopCleanupTimeouts(): void {
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
  // Cancel any pending stopAllPads post-ramp setTimeout to prevent cross-session contamination.
  cancelGlobalStopTimeout();
  clearAllStopCleanupTimeouts();
  clearAllFadeTracking();
  clearAllLayerChains();
  clearAllLayerCycleIndexes();
  clearAllLayerPlayOrders();
  clearAllLayerPending();
  clearAllLayerConsecutiveFailures();
  nullAllOnEnded();
  clearAllStreamingAudio();
  clearAllPadProgressInfo();
  clearAllLayerProgressInfo();
  // Stop voices BEFORE disconnecting gain nodes so onended callbacks (already nulled above)
  // do not fire against disconnected nodes, and voice.stop() completes with a valid graph.
  stopAllVoices();
  clearAllLayerGains();
  clearAllPadGains();
  // Release decoded PCM memory from the closed project and discard pre-buffered
  // HTMLAudioElements so they do not accumulate across project switches.
  clearAllBuffers();
  clearAllStreamingElements();
  clearAllSizeCache();
  // Defensive clear of tick-managed volume maps. Production callers are expected to call
  // stopAudioTick() first (which clears these via _clearAllTickFields), but clearAllAudioState()
  // may also be called independently (e.g. in tests or future callers). stopAllVoices() above
  // only clears padVolumes — not layerVolumes — so this is the single authoritative reset
  // for both maps on tear-down, preventing stale values from leaking into the next session.
  usePlaybackStore.getState().clearVolumes();
}
