export interface NormalizationConfig {
  targetLufs: number;
  maxBoostDb: number;
  limiter: {
    threshold: number;
    knee: number;
    ratio: number;
    attack: number;
    release: number;
  };
}

export const DEFAULT_NORMALIZATION_CONFIG: NormalizationConfig = {
  targetLufs: -14,
  maxBoostDb: 12,
  limiter: {
    threshold: -2,
    knee: 0,
    ratio: 20,
    attack: 0.001,
    release: 0.1,
  },
};
