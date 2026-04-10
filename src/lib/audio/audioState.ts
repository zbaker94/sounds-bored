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
 * padStreamingAudio  | pad ID     | Map<layerId, Set<HTMLAudioElement>>        | Active streaming elements for progress/cleanup  | clearLayerStreamingAudio(), stopAllPads()
 * layerChainQueue    | layer ID   | Sound[]                                   | Remaining sounds in sequential/shuffled chain   | deleteLayerChain(), clearAllLayerChains()
 * layerCycleIndex    | layer ID   | number                                    | Next play-order index for cycleMode layers      | deleteLayerCycleIndex(), clearAllLayerCycleIndexes()
 * layerPendingMap    | layer ID   | (Set membership)                          | Guards against async race on rapid retrigger    | clearLayerPending()
 * fadePadTimeouts    | pad ID     | timeout ID                                | Pending fade cleanup timeouts                   | cancelPadFade(), clearAllFadeTracking()
 * padFadeRafs        | pad ID     | RAF ID                                    | Animated volume lerp loops during fades         | cancelPadFade(), clearAllFadeTracking()
 * fadingOutPadIds    | pad ID     | (Set membership)                          | Tracks pads actively fading out (gain -> 0)     | cancelPadFade(), clearAllFadeTracking()
 */

import { getAudioContext, getMasterGain } from "./audioContext";
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

/** Keyed by layer ID. One GainNode per active layer, connects to its padGain. */
const layerGainMap = new Map<string, GainNode>();

/** Tracks the longest-duration voice per pad for playback progress display (buffer path). */
const padProgressInfo = new Map<string, { startedAt: number; duration: number; isLooping: boolean }>();

/**
 * Tracks all active streaming elements per pad per layer for progress display and cleanup.
 * pad ID -> layer ID -> Set<HTMLAudioElement>. Per-layer keying ensures 'continue'-mode
 * retriggers preserve progress tracking for layers that do not restart.
 * HTMLAudioElement exposes currentTime/duration after loadedmetadata fires.
 */
const padStreamingAudio = new Map<string, Map<string, Set<HTMLAudioElement>>>();

/** Remaining sounds to auto-chain after the current one ends (sequential/shuffled).
 *  Keyed by layer ID. Deleted when the chain is broken (stop/restart) or exhausted. */
const layerChainQueue = new Map<string, Sound[]>();

/** Cycle cursor: tracks the next index into the play order for layers with cycleMode=true.
 *  Keyed by layer ID. Persists across triggers so each trigger advances to the next sound.
 *  Deleted when the layer is stopped via stopAllPads or when cycleMode is toggled off. */
const layerCycleIndex = new Map<string, number>();

/** Layer IDs currently awaiting startLayerSound — guards against async race on rapid retrigger. */
const layerPendingMap = new Set<string>();

/** Stores the original play order for a layer chain so skip-back can derive the previous sound.
 *  Keyed by layer ID. Set when a chain is started; cleared on stopAllPads / stopPad. */
const layerPlayOrderMap = new Map<string, Sound[]>();

/** Pending fade cleanup timeouts, keyed by pad ID. Used by both fadePadOut and fadePadIn. */
const fadePadTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

/** RAF IDs for animated volume lerp loops during fades, keyed by pad ID. */
const padFadeRafs = new Map<string, number>();

/** Tracks pads that are actively fading out (gain -> 0). Cleared when fade completes or is cancelled. */
const fadingOutPadIds = new Set<string>();

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

export function getPadProgress(padId: string): number | null {
  const info = padProgressInfo.get(padId);
  if (info) {
    const elapsed = getAudioContext().currentTime - info.startedAt;
    if (info.isLooping && info.duration > 0) {
      return (elapsed % info.duration) / info.duration;
    }
    return Math.min(1, Math.max(0, elapsed / info.duration));
  }
  const layerMap = padStreamingAudio.get(padId);
  if (layerMap && layerMap.size > 0) {
    // Pick the element with the longest duration across all streaming layers,
    // matching how padProgressInfo picks the longest-duration buffer voice.
    // layerMap.size > 0 and empty Sets are never kept, so best is always assigned.
    let best: HTMLAudioElement | null = null;
    for (const audioSet of layerMap.values()) {
      for (const audio of audioSet) {
        if (!best || (isFinite(audio.duration) && audio.duration > (best.duration || 0))) {
          best = audio;
        }
      }
    }
    if (!best) return 0;
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
}

export function clearAllFadeTracking(): void {
  for (const id of fadePadTimeouts.values()) clearTimeout(id);
  fadePadTimeouts.clear();
  for (const id of padFadeRafs.values()) cancelAnimationFrame(id);
  padFadeRafs.clear();
  fadingOutPadIds.clear();
  const store = usePlaybackStore.getState();
  store.clearAllVolumeTransitions();
  store.resetAllPadVolumes();
  // NOTE: resetAllPadVolumes fires synchronously here, while stopAllVoices()
  // is called later in the STOP_RAMP_S deferred timeout in stopAllPads(). There is
  // a brief window where padVolumes are reset but voices are still ramping down.
  // This is intentional — the fade bar should disappear immediately on stop.
}

// ---------------------------------------------------------------------------
// Fade tracking functions (used internally by padPlayer fade operations)
// ---------------------------------------------------------------------------

/**
 * Cancel all fade-related resources for a pad: RAF loop, pending timeout, and store signal.
 * Safe to call even if no fade is registered -- all operations are idempotent.
 */
export function cancelPadFade(padId: string): void {
  const rafId = padFadeRafs.get(padId);
  if (rafId !== undefined) {
    cancelAnimationFrame(rafId);
    padFadeRafs.delete(padId);
  }
  const tId = fadePadTimeouts.get(padId);
  if (tId !== undefined) {
    clearTimeout(tId);
    fadePadTimeouts.delete(padId);
  }
  fadingOutPadIds.delete(padId);
  usePlaybackStore.getState().clearVolumeTransition(padId);
}

/** Animate padVolumes via requestAnimationFrame for the duration of a fade. */
export function startFadeRaf(padId: string, fromVolume: number, toVolume: number, durationMs: number): void {
  const startTime = performance.now();

  function frame() {
    const elapsed = performance.now() - startTime;
    const t = Math.min(1, elapsed / durationMs);
    usePlaybackStore.getState().updatePadVolume(padId, fromVolume + (toVolume - fromVolume) * t);
    if (t < 1) {
      padFadeRafs.set(padId, requestAnimationFrame(frame));
    } else {
      padFadeRafs.delete(padId);
    }
  }

  padFadeRafs.set(padId, requestAnimationFrame(frame));
}

/** Mark a pad as fading out. */
export function addFadingOutPad(padId: string): void {
  fadingOutPadIds.add(padId);
}

/** Remove a pad from fading-out tracking. */
export function removeFadingOutPad(padId: string): void {
  fadingOutPadIds.delete(padId);
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

export function getOrCreateLayerGain(layerId: string, volume: number, padGain: GainNode): GainNode {
  const existing = layerGainMap.get(layerId);
  if (existing) {
    // Sync cached gain to the current layer.volume in case it was changed via the config dialog.
    // cancelScheduledValues clears any pending reset from a previous ramp-stop timeout.
    const ctx = getAudioContext();
    existing.gain.cancelScheduledValues(ctx.currentTime);
    existing.gain.setValueAtTime(volume / 100, ctx.currentTime);
    return existing;
  }
  const ctx = getAudioContext();
  const gain = ctx.createGain();
  gain.gain.value = volume / 100;
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
}

export function unregisterStreamingAudio(padId: string, layerId: string, el: HTMLAudioElement): void {
  const padLayerMap = padStreamingAudio.get(padId);
  if (!padLayerMap) return;
  const audioSet = padLayerMap.get(layerId);
  if (!audioSet) return;
  audioSet.delete(el);
  if (audioSet.size === 0) padLayerMap.delete(layerId);
  if (padLayerMap.size === 0) padStreamingAudio.delete(padId);
}

/** Clear all streaming audio tracking. */
export function clearAllStreamingAudio(): void {
  padStreamingAudio.clear();
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
  // Also clean layerVoiceMap for layers on this pad
  for (const [layerId, layerVoices] of layerVoiceMap) {
    const remaining = layerVoices.filter((v) => !stoppedSet.has(v));
    if (remaining.length === 0) {
      layerVoiceMap.delete(layerId);
    } else {
      layerVoiceMap.set(layerId, remaining);
    }
  }
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
  usePlaybackStore.getState().clearAllPlayingPads();
  for (const voice of allVoices) {
    try { voice.stop(); } catch { /* already ended */ }
  }
}

export function recordLayerVoice(padId: string, layerId: string, voice: AudioVoice): void {
  layerVoiceMap.set(layerId, [...(layerVoiceMap.get(layerId) ?? []), voice]);
  recordVoice(padId, voice);
}

export function clearLayerVoice(padId: string, layerId: string, voice: AudioVoice): void {
  const updated = (layerVoiceMap.get(layerId) ?? []).filter((v) => v !== voice);
  if (updated.length === 0) {
    layerVoiceMap.delete(layerId);
  } else {
    layerVoiceMap.set(layerId, updated);
  }
  clearVoice(padId, voice);
}

export function stopLayerVoices(padId: string, layerId: string): void {
  const voices = layerVoiceMap.get(layerId) ?? [];
  const stoppedSet = new Set(voices);

  // Clean up maps BEFORE calling stop() — wrapStreamingElement.stop()
  // fires onended synchronously, so clearing first makes clearLayerVoice a safe no-op.
  layerVoiceMap.delete(layerId);
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
