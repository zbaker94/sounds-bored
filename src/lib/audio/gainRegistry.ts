/**
 * gainRegistry.ts — Per-pad and per-layer GainNode tracking.
 *
 * Owns the GainNode/DynamicsCompressorNode Maps used to wire the audio graph
 * (source(s) -> voiceGain -> layerGain -> padGain -> padLimiter -> masterGain -> destination)
 * and the gain-ramp deadline used by the audioTick fast-path.
 *
 * Layer GainNodes are now stored in LayerPlaybackContext (layerPlaybackContext.ts) rather
 * than a local Map. The public API surface is unchanged — callers continue to use
 * getOrCreateLayerGain / getLayerGain / clearAllLayerGains / clearLayerGainsForIds /
 * forEachActiveLayerGain exactly as before.
 *
 * This module is voice-agnostic: callers (audioTick / audioState) pass in the
 * set of currently-active pad or layer IDs from the voice registry. Keeping
 * the read of voiceMap on the caller side avoids a circular import between
 * the voice and gain modules.
 */

import { getAudioContext, getMasterGain } from "./audioContext";
import { createLimiterNode } from "./gainNormalization";
import {
  ensureLayerContext,
  getLayerContext,
  clearAllLayerContexts,
  clearAllLayerContextGains,
  clearLayerContextGainsForIds,
  forEachLayerContextWithGain,
} from "./layerPlaybackContext";

const padGainMap = new Map<string, GainNode>();
const padLimiterMap = new Map<string, DynamicsCompressorNode>();
let gainRampDeadline = -Infinity;

export function getPadGain(padId: string): GainNode {
  const existing = padGainMap.get(padId);
  if (existing) return existing;
  const ctx = getAudioContext();
  const gain = ctx.createGain();
  gain.gain.value = 1.0;
  const limiter = createLimiterNode(ctx);
  gain.connect(limiter);
  limiter.connect(getMasterGain());
  padLimiterMap.set(padId, limiter);
  padGainMap.set(padId, gain);
  return gain;
}

export function getLivePadVolume(padId: string): number | undefined {
  return padGainMap.get(padId)?.gain.value;
}

export function forEachActivePadGain(
  activePadIds: ReadonlySet<string>,
  fn: (padId: string, gain: GainNode) => void,
): void {
  for (const padId of activePadIds) {
    const gain = padGainMap.get(padId);
    if (gain) fn(padId, gain);
  }
}

export function forEachActiveLayerGain(
  activeLayerIds: ReadonlySet<string>,
  fn: (layerId: string, gain: GainNode) => void,
): void {
  forEachLayerContextWithGain(activeLayerIds, fn);
}

/**
 * Get or create a GainNode for the given layer, connecting it to `padGain`.
 *
 * @param layerId - The layer ID.
 * @param normalizedVolume - Normalized gain in [0,1]. Non-finite values (NaN, Infinity) clamp to 1.
 * @param padGain - The pad-level GainNode to connect the layer gain to.
 */
export function getOrCreateLayerGain(layerId: string, normalizedVolume: number, padGain: GainNode): GainNode {
  const clamped = Number.isFinite(normalizedVolume) ? Math.max(0, Math.min(1, normalizedVolume)) : 1;
  const audioCtx = getAudioContext();

  const layerCtx = ensureLayerContext(layerId);

  if (layerCtx.gain) {
    layerCtx.gain.gain.cancelScheduledValues(audioCtx.currentTime);
    layerCtx.gain.gain.setValueAtTime(clamped, audioCtx.currentTime);
    return layerCtx.gain;
  }

  const gain = audioCtx.createGain();
  gain.gain.value = clamped;
  gain.connect(padGain);
  layerCtx.gain = gain;
  return gain;
}

export function getLayerGain(layerId: string): GainNode | undefined {
  const gain = getLayerContext(layerId)?.gain;
  return gain ?? undefined;
}

export function clearAllPadGains(): void {
  for (const gain of padGainMap.values()) gain.disconnect();
  padGainMap.clear();
  for (const limiter of padLimiterMap.values()) limiter.disconnect();
  padLimiterMap.clear();
}

export function clearAllLayerGains(): void {
  clearAllLayerContextGains();
}

/**
 * Immediately disconnect pad gain nodes whose pad ID is NOT in `activePadIds`.
 * Called synchronously in stopAllPads before the ramp starts so stale entries
 * from previous natural stops don't linger into the race window.
 */
export function clearInactivePadGains(activePadIds: ReadonlySet<string>): void {
  for (const padId of [...padGainMap.keys()]) {
    if (!activePadIds.has(padId)) {
      padGainMap.get(padId)!.disconnect();
      padGainMap.delete(padId);
      const limiter = padLimiterMap.get(padId);
      if (limiter) {
        limiter.disconnect();
        padLimiterMap.delete(padId);
      }
    }
  }
}

export function clearPadGainsForIds(padIds: ReadonlySet<string>): void {
  for (const padId of padIds) {
    const gain = padGainMap.get(padId);
    if (gain) {
      gain.disconnect();
      padGainMap.delete(padId);
    }
    const limiter = padLimiterMap.get(padId);
    if (limiter) {
      limiter.disconnect();
      padLimiterMap.delete(padId);
    }
  }
}

export function clearLayerGainsForIds(layerIds: ReadonlySet<string>): void {
  clearLayerContextGainsForIds(layerIds);
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
 * Reset the gain ramp deadline back to its steady-state sentinel value.
 * Used by clearAllAudioState() during teardown so a stale deadline from a
 * prior session cannot keep the audioTick fast-path off after reset.
 */
export function resetGainRampDeadline(): void {
  gainRampDeadline = -Infinity;
}

/**
 * True while the most recently scheduled gain ramp's deadline is still in the
 * future. Resets the deadline to -Infinity (steady-state fast path) once it
 * has expired.
 */
export function isGainRampPending(): boolean {
  if (gainRampDeadline === -Infinity) return false;
  if (getAudioContext().currentTime >= gainRampDeadline) {
    gainRampDeadline = -Infinity;
    return false;
  }
  return true;
}

export function clearAll(): void {
  for (const gain of padGainMap.values()) gain.disconnect();
  padGainMap.clear();
  for (const limiter of padLimiterMap.values()) limiter.disconnect();
  padLimiterMap.clear();
  // Disconnect and delete all layer contexts. chainCycleState.clearAll() only zeroes
  // chain fields — context/gain teardown is this module's responsibility, running
  // after stopAllVoices() so voices stop while the downstream graph is still connected.
  clearAllLayerContexts();
  gainRampDeadline = -Infinity;
}
