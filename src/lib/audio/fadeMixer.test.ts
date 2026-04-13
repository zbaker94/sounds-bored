// src/lib/audio/fadeMixer.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockPad, createMockLayer } from "@/test/factories";

const mockCtx = {
  currentTime: 0,
  createGain: vi.fn(),
};

vi.mock("./audioContext", () => ({
  getAudioContext: vi.fn(() => mockCtx),
  getMasterGain: vi.fn(() => ({ connect: vi.fn() })),
}));

vi.mock("./gainManager", () => ({
  resetPadGain: vi.fn(),
}));

function makeMockGain(initialValue = 1.0) {
  return {
    gain: {
      value: initialValue,
      cancelScheduledValues: vi.fn(),
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

describe("fadeMixer", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.clearAllMocks();
    mockCtx.currentTime = 0;
    mockCtx.createGain.mockReset();
    const { clearAllPadGains, clearAllFadeTracking } = await import("./audioState");
    clearAllPadGains();
    clearAllFadeTracking();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("resolveFadeDuration", () => {
    it("returns pad.fadeDurationMs when set", async () => {
      const { resolveFadeDuration } = await import("./fadeMixer");
      const pad = createMockPad({ fadeDurationMs: 1500 });
      expect(resolveFadeDuration(pad, 3000)).toBe(1500);
    });

    it("returns globalFadeDurationMs when pad has no override", async () => {
      const { resolveFadeDuration } = await import("./fadeMixer");
      const pad = createMockPad({ fadeDurationMs: undefined });
      expect(resolveFadeDuration(pad, 3000)).toBe(3000);
    });

    it("returns 2000 when neither is set", async () => {
      const { resolveFadeDuration } = await import("./fadeMixer");
      const pad = createMockPad({ fadeDurationMs: undefined });
      expect(resolveFadeDuration(pad)).toBe(2000);
    });
  });

  describe("freezePadAtCurrentVolume", () => {
    it("cancels scheduled ramp and holds gain at its current value", async () => {
      const mockGain = makeMockGain();
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain } = await import("./audioState");
      getPadGain("pad-freeze");
      // getPadGain sets gain.gain.value = 1.0 after creation; override to test non-default value
      mockGain.gain.value = 0.6;
      mockGain.gain.cancelScheduledValues.mockClear();
      mockGain.gain.setValueAtTime.mockClear();
      const { freezePadAtCurrentVolume } = await import("./fadeMixer");

      freezePadAtCurrentVolume("pad-freeze");

      expect(mockGain.gain.cancelScheduledValues).toHaveBeenCalledWith(0);
      expect(mockGain.gain.setValueAtTime).toHaveBeenCalledWith(0.6, 0);
    });
  });

  describe("fadePadOut", () => {
    it("schedules a linear ramp to 0 and marks pad as fading out", async () => {
      const mockGain = makeMockGain(1.0);
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain, isPadFadingOut } = await import("./audioState");
      getPadGain("pad-fadeout");
      const { fadePadOut } = await import("./fadeMixer");
      const pad = createMockPad({ id: "pad-fadeout" });

      fadePadOut(pad, 1000);

      expect(mockGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 1);
      expect(isPadFadingOut("pad-fadeout")).toBe(true);
    });

    it("stops pad voices and resets gain after fade-to-0 completes", async () => {
      const mockGain = makeMockGain(1.0);
      mockCtx.createGain.mockReturnValue(mockGain);
      const layer = createMockLayer({ id: "layer-fadeout-stop" });
      const { getPadGain, setLayerChain, getLayerChain, getLayerCycleIndex, setLayerCycleIndex } = await import("./audioState");
      getPadGain("pad-fadeout-stop");
      setLayerChain("layer-fadeout-stop", []);
      setLayerCycleIndex("layer-fadeout-stop", 1);
      const { fadePadOut } = await import("./fadeMixer");
      const { resetPadGain } = await import("./gainManager");
      const pad = createMockPad({ id: "pad-fadeout-stop", layers: [layer] });

      fadePadOut(pad, 500);
      vi.advanceTimersByTime(600);

      // Verifies the inline-stopPad contract: chain, cycle, play-order, voices all cleared
      expect(getLayerChain("layer-fadeout-stop")).toBeUndefined();
      expect(getLayerCycleIndex("layer-fadeout-stop")).toBeUndefined();
      expect(resetPadGain).toHaveBeenCalledWith("pad-fadeout-stop");
    });

    it("nulls onended callbacks on active pad voices at fade start", async () => {
      const mockGain = makeMockGain(1.0);
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain, recordLayerVoice } = await import("./audioState");
      getPadGain("pad-null-ended");
      const mockVoice = { setOnEnded: vi.fn(), stop: vi.fn(), stopWithRamp: vi.fn() };
      recordLayerVoice("pad-null-ended", "layer-null-ended", mockVoice as unknown as import("./audioVoice").AudioVoice);
      const { fadePadOut } = await import("./fadeMixer");
      const pad = createMockPad({ id: "pad-null-ended" });

      fadePadOut(pad, 1000);

      // Prevents chain-continuation callbacks from firing during the fade window
      expect(mockVoice.setOnEnded).toHaveBeenCalledWith(null);
    });

    it("does not stop pad when fading to a non-zero volume", async () => {
      const mockGain = makeMockGain(1.0);
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain } = await import("./audioState");
      getPadGain("pad-partial-fade");
      const { fadePadOut } = await import("./fadeMixer");
      const { resetPadGain } = await import("./gainManager");
      const pad = createMockPad({ id: "pad-partial-fade" });

      fadePadOut(pad, 500, 1.0, 0.3);
      vi.advanceTimersByTime(600);

      expect(resetPadGain).not.toHaveBeenCalled();
    });

    it("uses fromVolume parameter instead of current gain", async () => {
      const mockGain = makeMockGain();
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain } = await import("./audioState");
      getPadGain("pad-from-vol");
      // getPadGain sets gain.gain.value = 1.0 — override to a different value to confirm
      // that fromVolume wins over the current gain node value.
      mockGain.gain.value = 0.8;
      mockGain.gain.setValueAtTime.mockClear();
      const { fadePadOut } = await import("./fadeMixer");
      const pad = createMockPad({ id: "pad-from-vol" });

      fadePadOut(pad, 1000, 0.5);

      // Should use fromVolume=0.5 even though current gain is 0.8
      expect(mockGain.gain.setValueAtTime).toHaveBeenCalledWith(0.5, 0);
    });
  });

  describe("fadePadInFromCurrent", () => {
    it("cancels fade-out and ramps gain up from current value to 1.0", async () => {
      const mockGain = makeMockGain();
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain } = await import("./audioState");
      getPadGain("pad-fadein");
      // getPadGain sets gain.gain.value = 1.0 after creation; override to test non-default value
      mockGain.gain.value = 0.3;
      mockGain.gain.setValueAtTime.mockClear();
      const { fadePadInFromCurrent } = await import("./fadeMixer");
      const pad = createMockPad({ id: "pad-fadein" });

      fadePadInFromCurrent(pad, 1000);

      expect(mockGain.gain.setValueAtTime).toHaveBeenCalledWith(0.3, 0);
      expect(mockGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1.0, 1);
    });

    it("ramps to toVolume when specified", async () => {
      const mockGain = makeMockGain(0.2);
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain } = await import("./audioState");
      getPadGain("pad-fadein-vol");
      const { fadePadInFromCurrent } = await import("./fadeMixer");
      const pad = createMockPad({ id: "pad-fadein-vol" });

      fadePadInFromCurrent(pad, 1000, 0.7);

      expect(mockGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.7, 1);
    });
  });
});
