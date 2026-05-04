import { describe, it, expect } from "vitest";
import { computeNormalizationGain, normalizedVoiceGain } from "./gainNormalization";

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
    // +6 dB = 10^(6/20) ≈ 1.995
    expect(gain).toBeCloseTo(Math.pow(10, 6 / 20), 5);
  });

  it("computes correct gain for -6 dB attenuation (-8 LUFS → -14 LUFS)", () => {
    const gain = computeNormalizationGain(-8, -14);
    // -6 dB = 10^(-6/20) ≈ 0.501
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

  it("boosts a quiet sound (rawGain < 1.0 with headroom)", () => {
    // -20 LUFS → -14 LUFS = +6 dB ≈ ×1.995; rawGain 0.5 → 0.998
    const result = normalizedVoiceGain(0.5, -20);
    expect(result).toBeCloseTo(Math.pow(10, 6 / 20) * 0.5, 5);
    expect(result).toBeLessThanOrEqual(1.0);
  });

  it("clamps to 1.0 when normGain × rawGain would exceed 1.0", () => {
    // -20 LUFS → +6 dB ≈ ×1.995; rawGain 1.0 → would be 1.995 → clamped to 1.0
    expect(normalizedVoiceGain(1.0, -20)).toBe(1.0);
  });

  it("attenuates a loud sound below 1.0", () => {
    // -8 LUFS → -14 LUFS = -6 dB ≈ ×0.501; rawGain 1.0 → 0.501
    const result = normalizedVoiceGain(1.0, -8);
    expect(result).toBeCloseTo(Math.pow(10, -6 / 20), 5);
    expect(result).toBeLessThan(1.0);
  });

  it("returns 1.0 when loudness equals target (no-op normalization)", () => {
    expect(normalizedVoiceGain(1.0, -14)).toBeCloseTo(1.0);
  });
});
