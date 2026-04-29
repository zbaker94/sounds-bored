/**
 * audioState.ts â€” Non-serializable audio engine runtime state
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
 * playbackStore (Zustand) holds reactive UI signals split into two categories:
 *
 *   Push-based (written here on discrete events): playingPadIds, fadingPadIds,
 *   fadingOutPadIds, reversingPadIds. These are updated synchronously when a pad
 *   starts or stops â€” routing them through the RAF tick would add ~16 ms latency
 *   to UI feedback with no correctness benefit.
 *
 *   Tick-managed (written by audioTick.ts each RAF frame): padVolumes,
 *   layerVolumes, padProgress, layerProgress, activeLayerIds, layerPlayOrder,
 *   layerChain. This module MUST NOT write these fields â€” doing so bypasses the
 *   tick's diff logic and can create race conditions with the RAF loop.
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
 * NOTE: padGainMap is a persistent lazy cache — getPadGain() creates entries on
 *   first trigger and they survive until clearAllPadGains() (called in the
 *   post-ramp timeout of stopAllPads or by clearAllAudioState). voiceMap only
 *   contains pads with currently-active voices; pads leave voiceMap when their
 *   last voice stops naturally. The two maps are NOT kept in sync between a
 *   natural voice stop and the next clearAllPadGains() call.
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
 * pendingMetadataAborts | element  | Map<padId|layerId, AbortController>       | In-flight loadedmetadata listeners; aborted on clear/unregister | unregisterStreamingAudio(), clearLayerStreamingAudio(), clearAllStreamingAudio()
 * layerChainQueue    | layer ID   | Sound[]                                   | Remaining sounds in sequential/shuffled chain   | deleteLayerChain(), clearAllLayerChains()
 * layerCycleIndex    | layer ID   | number                                    | Next play-order index for cycleMode layers      | deleteLayerCycleIndex(), clearAllLayerCycleIndexes()
 * layerPendingMap    | layer ID   | (Set membership)                          | Guards against async race on rapid retrigger    | clearLayerPending()
 * layerConsecutiveFailureMap | layer ID | number                             | Consecutive chain load failures (circuit-break) | resetLayerConsecutiveFailures(), clearAllLayerConsecutiveFailures()
 * fadePadTimeouts    | pad ID     | timeout ID                                | Pending fade cleanup timeouts                   | cancelPadFade(), clearAllFadeTracking()
 * fadingOutPadIds    | pad ID     | (Set membership)                          | Tracks pads actively fading out (gain -> 0)     | cancelPadFade(), clearAllFadeTracking()
 */

import { getAudioContext, getMasterGain } from "./audioContext";
import { usePlaybackStore } from "@/state/playbackStore";
import type { AudioVoice } from "./audioVoice";
import type { Sound } from "@/lib/schemas";

// ---------------------------------------------------------------------------
// Private state â€” all 11 Maps/Sets
// ---------------------------------------------------------------------------

/** Per-pad GainNodes: source(s) -> voiceGain -> layerGain -> padGain -> masterGain -> destination */
const padGainMap = new Map<string, GainNode>();

/** Active voices per pad. Every layer voice is also in voiceMap â€” see recordLayerVoice invariant. */
const voiceMap = new Map<string, AudioVoice[]>();

/** Active voices per layer. */
const layerVoiceMap = new Map<string, AudioVoice[]>();

/**
 * Reverse index: pad ID â†’ Set of layer IDs with active voices for that pad.
 * Maintained alongside layerVoiceMap to allow stopPadVoices to touch only the
 * layers belonging to the stopped pad â€” O(layers_in_pad) instead of O(all_layers).
 * Exported with underscore prefix for test introspection only.
 */
export const _padToLayerIds = new Map<string, Set<string>>();

/**
 * Incremented whenever a layer voice is added or removed. The audioTick loop
 * reads this to skip `new Set(layerVoiceMap.keys())` on frames where the active
 * layer set is unchanged â€” avoids one per-frame Set allocation during stable playback.
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
 * Recomputed on register/unregister/clear â€” never on the RAF hot path.
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

/** AbortControllers for pending `loadedmetadata` listeners, keyed by element →
 *  `${padId}|${layerId}`. Allows removing the listener when a layer is cleared
 *  before metadata loads rather than letting dead closures accumulate on reused elements. */
const pendingMetadataAborts = new WeakMap<HTMLAudioElement, Map<string, AbortController>>();

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

/** Layer IDs currently awaiting startLayerSound â€” guards against async race on rapid retrigger. */
const layerPendingMap = new Set<string>();

/** Counts consecutive `loadLayerVoice` failures per layer, used to short-circuit
 *  a failing chain (e.g. missing library) instead of spamming one toast per
 *  chained sound. Reset on a successful voice start or when the circuit trips. */
const layerConsecutiveFailureMap = new Map<string, number>();

/** Stores the original play order for a layer chain so skip-back can derive the previous sound.
 *  Keyed by layer ID. Set when a chain is started; cleared on stopAllPads / stopPad. */
const layerPlayOrderMap = new Map<string, Sound[]>();

/** Pending fade cleanup timeouts, keyed by pad ID. */
const fadePadTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

/** Tracks pads that are actively fading out (gain -> 0). Cleared when fade completes or is cancelled. */
const fadingOutPadIds = new Set<string>();

/**
 * Stores the fromVolume of each active gain ramp so reverseFade knows where to return to.
 * Reversing always goes back to where the fade started â€” this avoids direction assumptions
 * that break when fadeTargetVol > pad.volume.
 * Cleared by cancelPadFade and clearAllFadeTracking.
 */
const padFadeFromVolumes = new Map<string, number>();

/**
 * AudioContext time after which all scheduled short gain ramps have settled.
 * Set by markGainRamp(); read by isAnyGainChanging() to short-circuit the
 * audioTick volume rebuild when no fade or ramp is in flight.
 * -Infinity means no ramp is pending (steady-state fast path skips the time check).
 */
let gainRampDeadline = -Infinity;

/**
 * Tracks pads that have started a fade-in but whose async triggerPad has not yet completed.
 * Set synchronously before `await triggerPad` in triggerAndFade; cleared by cancelPadFade.
 * Lets triggerAndFade detect post-await that it was pre-empted by a reverse-fade call during the gap.
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

/**
 * Record that a gain ramp lasting `durationS` seconds was just scheduled.
 * Called by gainManager.rampGainTo so the audioTick can continue reading
 * gain node values until the ramp settles.
 */
export function markGainRamp(durationS: number): void {
  // +5 ms safety margin absorbs AudioContext scheduling jitter: the audio rendering
  // thread may commit the ramp slightly later than currentTime+durationS on loaded systems.
  const deadline = getAudioContext().currentTime + durationS + 0.005;
  if (deadline > gainRampDeadline) gainRampDeadline = deadline;
}

/**
 * Returns true when any fade or short gain ramp is currently in flight,
 * meaning gain node values may be changing this frame.
 * Used by audioTick to short-circuit the volume rebuild in steady state.
 */
export function isAnyGainChanging(): boolean {
  if (fadePadTimeouts.size > 0 || fadingOutPadIds.size > 0 || fadingInPadIds.size > 0) return true;
  if (gainRampDeadline === -Infinity) return false;
  if (getAudioContext().currentTime >= gainRampDeadline) {
    gainRampDeadline = -Infinity; // reclaim the steady-state fast path
    return false;
  }
  return true;
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
 * This is a get-or-create operation â€” it always returns a valid GainNode.
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

/** Iterate active pad gain nodes â€” only pads currently in voiceMap (with active voices). */
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

/** Iterate active layer gain nodes â€” only layers currently in layerVoiceMap. */
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
 * Returns a Record<padId, progress 0â€“1>. Pads with no progress info are omitted.
 * Reads AudioContext.currentTime once and passes it to getPadProgress â€” mirrors computeAllLayerProgress.
 */
export function computeAllPadProgress(): Record<string, number> {
  const result: Record<string, number> = {};
  if (voiceMap.size === 0) return result;
  // Hoist a single currentTime read for all active pads â€” mirrors computeAllLayerProgress.
  const currentTime = getAudioContext().currentTime;
  for (const padId of voiceMap.keys()) {
    const progress = getPadProgress(padId, currentTime);
    if (progress !== null) result[padId] = progress;
  }
  return result;
}

/**
 * Compute layerProgress for all active layers in one pass.
 * Returns a Record<layerId, progress 0â€“1>.
 * Buffer layers are tracked via layerProgressInfo; streaming layers via padStreamingAudio.
 */
export function computeAllLayerProgress(): Record<string, number> {
  const result: Record<string, number> = {};

  // Buffer layers â€” tracked in layerProgressInfo
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

  // Streaming layers â€” use cached best element per layer (O(1) lookup per layer)
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
  padFadeFromVolumes.clear();
}

// ---------------------------------------------------------------------------
// Fade tracking functions (used internally by padPlayer fade operations)
// ---------------------------------------------------------------------------

/**
 * Cancel all fade-related resources for a pad: pending timeout and fadingOut tracking.
 * The global audioTick handles padVolumes â€” no store call needed here.
 * Safe to call even if no fade is registered -- all operations are idempotent.
 */
export function cancelPadFade(padId: string): void {
  const tId = fadePadTimeouts.get(padId);
  if (tId !== undefined) {
    clearTimeout(tId);
    fadePadTimeouts.delete(padId);
  }
  fadingOutPadIds.delete(padId);
  padFadeFromVolumes.delete(padId);
  usePlaybackStore.getState().removeFadingPad(padId);
  // fadingInPadIds is NOT cleared here â€” triggerPad calls cancelPadFade internally
  // and must not accidentally pre-empt a triggerAndFade that is still in flight.
  // Only fadePad (explicit reversal) and clearAllFadeTracking clear fadingInPadIds.
}

/** Mark a pad as fading out. */
export function addFadingOutPad(padId: string): void {
  fadingOutPadIds.add(padId);
}

/** Remove a pad from fading-out tracking. */
export function removeFadingOutPad(padId: string): void {
  fadingOutPadIds.delete(padId);
}

/** Mark a pad as starting a fade-in (set before await in triggerAndFade to cover the async gap). */
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

export function setPadFadeFromVolume(padId: string, fromVolume: number): void {
  padFadeFromVolumes.set(padId, fromVolume);
}

export function getPadFadeFromVolume(padId: string): number | undefined {
  return padFadeFromVolumes.get(padId);
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
  const audioSet = padLayerMap.get(layerId);
  if (audioSet) {
    const key = `${padId}|${layerId}`;
    for (const el of audioSet) {
      const controllers = pendingMetadataAborts.get(el);
      if (controllers) {
        controllers.get(key)?.abort();
        controllers.delete(key);
        if (controllers.size === 0) pendingMetadataAborts.delete(el);
      }
    }
  }
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
  // Re-evaluate once metadata loads so the cache reflects the true duration rather than NaN.
  // The listener is aborted on clear/unregister to prevent accumulation on reused elements;
  // the membership guard is defense-in-depth.
  if (!isFinite(el.duration)) {
    const key = `${padId}|${layerId}`;
    let controllers = pendingMetadataAborts.get(el);
    if (!controllers) {
      controllers = new Map();
      pendingMetadataAborts.set(el, controllers);
    }
    controllers.get(key)?.abort();
    const ac = new AbortController();
    controllers.set(key, ac);
    el.addEventListener("loadedmetadata", () => {
      controllers!.delete(key);
      if (padStreamingAudio.get(padId)?.get(layerId)?.has(el)) {
        recomputePadBestStreaming(padId);
        recomputeLayerBestStreaming(padId, layerId);
      }
    }, { once: true, signal: ac.signal });
  }
}

export function unregisterStreamingAudio(padId: string, layerId: string, el: HTMLAudioElement): void {
  const padLayerMap = padStreamingAudio.get(padId);
  if (!padLayerMap) return;
  const audioSet = padLayerMap.get(layerId);
  if (!audioSet) return;
  const key = `${padId}|${layerId}`;
  const controllers = pendingMetadataAborts.get(el);
  if (controllers) {
    controllers.get(key)?.abort();
    controllers.delete(key);
    if (controllers.size === 0) pendingMetadataAborts.delete(el);
  }
  audioSet.delete(el);
  if (audioSet.size === 0) padLayerMap.delete(layerId);
  if (padLayerMap.size === 0) padStreamingAudio.delete(padId);
  recomputePadBestStreaming(padId);
  recomputeLayerBestStreaming(padId, layerId);
}

/** Clear all streaming audio tracking. */
export function clearAllStreamingAudio(): void {
  for (const [padId, padLayerMap] of padStreamingAudio) {
    for (const [layerId, audioSet] of padLayerMap) {
      const key = `${padId}|${layerId}`;
      for (const el of audioSet) {
        const controllers = pendingMetadataAborts.get(el);
        if (controllers) {
          controllers.get(key)?.abort();
          controllers.delete(key);
          if (controllers.size === 0) pendingMetadataAborts.delete(el);
        }
      }
    }
  }
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

export function clearVoice(padId: string, voice: AudioVoice): void {
  const updated = (voiceMap.get(padId) ?? []).filter((v) => v !== voice);
  if (updated.length === 0) {
    voiceMap.delete(padId);
    usePlaybackStore.getState().removePlayingPad(padId);
  } else {
    voiceMap.set(padId, updated);
  }
}

export function stopPadVoices(padId: string): void {
  const voices = voiceMap.get(padId) ?? [];
  const stoppedSet = new Set(voices);
  voiceMap.delete(padId);
  usePlaybackStore.getState().removePlayingPad(padId);
  // Use reverse index to touch only layers belonging to this pad â€” O(layers_in_pad).
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
  usePlaybackStore.getState().clearAllPlayingPads();
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

  // Clean up maps BEFORE calling stop() â€” wrapStreamingElement.stop()
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

/** Remove a stop cleanup timeout from tracking â€” called when the timeout fires naturally. */
export function deleteStopCleanupTimeout(id: ReturnType<typeof setTimeout>): void {
  pendingStopCleanupTimeouts.delete(id);
}

/** Cancel all pending stop cleanup timeouts. Called by clearAllAudioState on project close. */
export function clearAllStopCleanupTimeouts(): void {
  for (const id of pendingStopCleanupTimeouts) clearTimeout(id);
  pendingStopCleanupTimeouts.clear();
}

// ---------------------------------------------------------------------------
// Consolidated cleanup â€” instant, no gain ramp (for project close)
// ---------------------------------------------------------------------------

/**
 * Instantly release all audio engine state â€” no gain ramp.
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
  gainRampDeadline = -Infinity;
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
  // Note: audio buffer / streaming element caches are cleared by the caller
  // (MainPage) â€” audioState is a pure state container and does not import the
  // cache modules to keep the dependency graph clean.
  // Defensive clear of tick-managed volume maps. Callers must call stopAudioTick() first
  // (which clears these via _clearAllTickFields). This is a belt-and-suspenders reset
  // in case clearAllAudioState() is called without a preceding stopAudioTick() (e.g. tests).
  usePlaybackStore.getState().clearVolumes();
}
