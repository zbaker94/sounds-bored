import { DEFAULT_NORMALIZATION_CONFIG, type NormalizationConfig } from "./normalizationConfig";

export { DEFAULT_NORMALIZATION_CONFIG };
export type { NormalizationConfig };

export const DEFAULT_TARGET_LUFS = DEFAULT_NORMALIZATION_CONFIG.targetLufs;

export function computeNormalizationGain(
  loudnessLufs: number,
  targetLufs: number = DEFAULT_TARGET_LUFS,
): number {
  return Math.pow(10, (targetLufs - loudnessLufs) / 20);
}

/**
 * Apply loudness normalization to a raw gain value.
 * Clamps the normalization multiplier to [0, 10^(maxBoostDb/20)] so very quiet
 * sounds get a bounded boost rather than an uncapped amplification.
 * Returns rawGain unchanged when loudnessLufs is undefined (sound not yet analyzed).
 * The per-pad limiter node handles any peaks that exceed 0 dBFS after boosting.
 */
export function normalizedVoiceGain(
  rawGain: number,
  loudnessLufs: number | undefined,
  config: NormalizationConfig = DEFAULT_NORMALIZATION_CONFIG,
): number {
  if (loudnessLufs === undefined) return rawGain;
  const maxNormGain = Math.pow(10, config.maxBoostDb / 20);
  const normGain = Math.min(computeNormalizationGain(loudnessLufs, config.targetLufs), maxNormGain);
  return normGain * rawGain;
}

/**
 * Create a DynamicsCompressorNode configured as a near-brickwall limiter.
 * Used by gainRegistry (per-pad) and preview (per-session) to catch peaks
 * that exceed 0 dBFS after normalization gain is applied.
 */
export function createLimiterNode(
  ctx: AudioContext,
  config: NormalizationConfig = DEFAULT_NORMALIZATION_CONFIG,
): DynamicsCompressorNode {
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = config.limiter.threshold;
  limiter.knee.value = config.limiter.knee;
  limiter.ratio.value = config.limiter.ratio;
  limiter.attack.value = config.limiter.attack;
  limiter.release.value = config.limiter.release;
  return limiter;
}
