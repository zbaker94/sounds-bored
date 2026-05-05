import { describe, it, expect, vi } from "vitest";
import {
  computeNormalizationGain,
  normalizedVoiceGain,
  createLimiterNode,
} from "./gainNormalization";
import { DEFAULT_NORMALIZATION_CONFIG } from "./normalizationConfig";

describe("computeNormalizationGain", () => {
  it("returns 1.0 when measured equals target", () => {
    expect(computeNormalizationGain(-14, -14)).toBeCloseTo(1.0);
  });

  it("returns gain > 1.0 for a quiet sound (measured below target)", () => {
    const gain = computeNormalizationGain(-20, -14);
    expect(gain).toBeGreaterThan(1.0);
  });

  it("returns gain < 1.0 for a loud sound (measured above target)", () => {
    const gain = computeNormalizationGain(-8, -14);
    expect(gain).toBeLessThan(1.0);
  });

  it("uses -14 LUFS as the default target", () => {
    expect(computeNormalizationGain(-14)).toBeCloseTo(1.0);
    expect(computeNormalizationGain(-20)).toBeCloseTo(computeNormalizationGain(-20, -14));
  });

  it("computes correct gain for +6 dB boost (-20 LUFS → -14 LUFS)", () => {
    const gain = computeNormalizationGain(-20, -14);
    expect(gain).toBeCloseTo(Math.pow(10, 6 / 20), 5);
  });

  it("computes correct gain for -6 dB attenuation (-8 LUFS → -14 LUFS)", () => {
    const gain = computeNormalizationGain(-8, -14);
    expect(gain).toBeCloseTo(Math.pow(10, -6 / 20), 5);
  });

  it("respects a custom targetLufs", () => {
    const gain = computeNormalizationGain(-23, -23);
    expect(gain).toBeCloseTo(1.0);
  });
});

describe("normalizedVoiceGain", () => {
  it("returns rawGain unchanged when loudnessLufs is undefined", () => {
    expect(normalizedVoiceGain(0.8, undefined)).toBe(0.8);
    expect(normalizedVoiceGain(1.0, undefined)).toBe(1.0);
    expect(normalizedVoiceGain(0.0, undefined)).toBe(0.0);
  });

  it("boosts a quiet sound (rawGain 0.5 at -20 LUFS)", () => {
    // -20 LUFS → -14 LUFS = +6 dB ≈ ×1.995; rawGain 0.5 → ≈0.998 (within cap)
    const result = normalizedVoiceGain(0.5, -20);
    expect(result).toBeCloseTo(Math.pow(10, 6 / 20) * 0.5, 5);
  });

  it("allows boost above 1.0 for quiet sounds within the max boost cap", () => {
    // -20 LUFS → +6 dB ≈ ×1.995; rawGain 1.0 → ≈1.995 (cap is +12 dB = ×3.981)
    expect(normalizedVoiceGain(1.0, -20)).toBeCloseTo(Math.pow(10, 6 / 20), 5);
  });

  it("clamps normalization gain at maxBoostDb when the required boost is too large", () => {
    // -40 LUFS wants +26 dB (×19.95) but maxBoostDb=12 caps at ×3.981
    const maxGain = Math.pow(10, DEFAULT_NORMALIZATION_CONFIG.maxBoostDb / 20);
    expect(normalizedVoiceGain(1.0, -40)).toBeCloseTo(maxGain, 4);
  });

  it("attenuates a loud sound below rawGain", () => {
    // -8 LUFS → -14 LUFS = -6 dB ≈ ×0.501; rawGain 1.0 → ≈0.501
    const result = normalizedVoiceGain(1.0, -8);
    expect(result).toBeCloseTo(Math.pow(10, -6 / 20), 5);
    expect(result).toBeLessThan(1.0);
  });

  it("returns rawGain when loudness equals target (no-op normalization)", () => {
    expect(normalizedVoiceGain(1.0, -14)).toBeCloseTo(1.0);
    expect(normalizedVoiceGain(0.5, -14)).toBeCloseTo(0.5);
  });

  it("respects a custom config with different maxBoostDb", () => {
    const config = { ...DEFAULT_NORMALIZATION_CONFIG, maxBoostDb: 6 };
    const maxGain = Math.pow(10, 6 / 20); // ≈1.995
    // -40 LUFS wants +26 dB but cap is +6 dB
    expect(normalizedVoiceGain(1.0, -40, config)).toBeCloseTo(maxGain, 4);
  });
});

describe("createLimiterNode", () => {
  it("creates a DynamicsCompressorNode configured from DEFAULT_NORMALIZATION_CONFIG", () => {
    const mockLimiter = {
      threshold: { value: 0 },
      knee: { value: 0 },
      ratio: { value: 1 },
      attack: { value: 0 },
      release: { value: 0 },
    };
    const mockCtx = {
      createDynamicsCompressor: vi.fn(() => mockLimiter),
    } as unknown as AudioContext;

    const result = createLimiterNode(mockCtx);

    expect(mockCtx.createDynamicsCompressor).toHaveBeenCalledOnce();
    expect(mockLimiter.threshold.value).toBe(DEFAULT_NORMALIZATION_CONFIG.limiter.threshold);
    expect(mockLimiter.knee.value).toBe(DEFAULT_NORMALIZATION_CONFIG.limiter.knee);
    expect(mockLimiter.ratio.value).toBe(DEFAULT_NORMALIZATION_CONFIG.limiter.ratio);
    expect(mockLimiter.attack.value).toBe(DEFAULT_NORMALIZATION_CONFIG.limiter.attack);
    expect(mockLimiter.release.value).toBe(DEFAULT_NORMALIZATION_CONFIG.limiter.release);
    expect(result).toBe(mockLimiter);
  });

  it("applies a custom config when provided", () => {
    const customConfig = {
      ...DEFAULT_NORMALIZATION_CONFIG,
      limiter: { threshold: -6, knee: 3, ratio: 10, attack: 0.005, release: 0.2 },
    };
    const mockLimiter = {
      threshold: { value: 0 },
      knee: { value: 0 },
      ratio: { value: 1 },
      attack: { value: 0 },
      release: { value: 0 },
    };
    const mockCtx = {
      createDynamicsCompressor: vi.fn(() => mockLimiter),
    } as unknown as AudioContext;

    createLimiterNode(mockCtx, customConfig);

    expect(mockLimiter.threshold.value).toBe(-6);
    expect(mockLimiter.knee.value).toBe(3);
    expect(mockLimiter.ratio.value).toBe(10);
    expect(mockLimiter.attack.value).toBe(0.005);
    expect(mockLimiter.release.value).toBe(0.2);
  });
});
