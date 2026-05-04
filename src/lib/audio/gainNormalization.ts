const DEFAULT_TARGET_LUFS = -14;

export function computeNormalizationGain(
  loudnessLufs: number,
  targetLufs: number = DEFAULT_TARGET_LUFS,
): number {
  return Math.pow(10, (targetLufs - loudnessLufs) / 20);
}

/**
 * Apply loudness normalization to a raw gain value, clamping to [0, 1].
 * Returns rawGain unchanged when loudnessLufs is undefined (sound not yet analyzed).
 */
export function normalizedVoiceGain(rawGain: number, loudnessLufs: number | undefined): number {
  if (loudnessLufs === undefined) return rawGain;
  return Math.min(computeNormalizationGain(loudnessLufs) * rawGain, 1.0);
}
