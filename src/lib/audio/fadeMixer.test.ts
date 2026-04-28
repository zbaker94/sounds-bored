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
  rampGainTo: vi.fn((param: AudioParam, target: number, rampS: number = 0.016, from: number = param.value) => {
    param.cancelScheduledValues(mockCtx.currentTime);
    param.setValueAtTime(from, mockCtx.currentTime);
    param.linearRampToValueAtTime(target, mockCtx.currentTime + rampS);
  }),
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

  describe("fadePad — fading down", () => {
    it("schedules a linear ramp to 0 and marks pad as fading out", async () => {
      const mockGain = makeMockGain(1.0);
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain, isPadFadingOut } = await import("./audioState");
      getPadGain("pad-fadeout");
      const { fadePad } = await import("./fadeMixer");
      const pad = createMockPad({ id: "pad-fadeout" });

      fadePad(pad, 1.0, 0, 1000);

      expect(mockGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 1);
      expect(isPadFadingOut("pad-fadeout")).toBe(true);
    });

    it("stops pad voices and resets gain after fade-to-0 completes", async () => {
      const mockGain = makeMockGain(1.0);
      mockCtx.createGain.mockReturnValue(mockGain);
      const layer = createMockLayer({ id: "layer-fadeout-stop" });
      const { getPadGain, setLayerChain, getLayerChain, getLayerCycleIndex, setLayerCycleIndex, setLayerPlayOrder, getLayerPlayOrder } = await import("./audioState");
      getPadGain("pad-fadeout-stop");
      setLayerChain("layer-fadeout-stop", []);
      setLayerCycleIndex("layer-fadeout-stop", 1);
      setLayerPlayOrder("layer-fadeout-stop", []);
      const { fadePad } = await import("./fadeMixer");
      const { resetPadGain } = await import("./gainManager");
      const pad = createMockPad({ id: "pad-fadeout-stop", layers: [layer] });

      fadePad(pad, 1.0, 0, 500);
      vi.advanceTimersByTime(600);

      // Verifies the full inline-stopPad contract: chain + cycle + play-order + voices all cleared
      expect(getLayerChain("layer-fadeout-stop")).toBeUndefined();
      expect(getLayerCycleIndex("layer-fadeout-stop")).toBeUndefined();
      expect(getLayerPlayOrder("layer-fadeout-stop")).toBeUndefined();
      expect(resetPadGain).toHaveBeenCalledWith("pad-fadeout-stop");
    });

    it("nulls onended callbacks on active pad voices at fade start", async () => {
      const mockGain = makeMockGain(1.0);
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain, recordLayerVoice } = await import("./audioState");
      getPadGain("pad-null-ended");
      const mockVoice = { setOnEnded: vi.fn(), stop: vi.fn(), stopWithRamp: vi.fn() };
      recordLayerVoice("pad-null-ended", "layer-null-ended", mockVoice as unknown as import("./audioVoice").AudioVoice);
      const { fadePad } = await import("./fadeMixer");
      const pad = createMockPad({ id: "pad-null-ended" });

      fadePad(pad, 1.0, 0, 1000);

      // Prevents chain-continuation callbacks from firing during the fade window
      expect(mockVoice.setOnEnded).toHaveBeenCalledWith(null);
    });

    it("does not execute cleanup if pad is no longer fading out when timeout fires", async () => {
      const mockGain = makeMockGain(1.0);
      mockCtx.createGain.mockReturnValue(mockGain);
      const layer = createMockLayer({ id: "layer-stale-guard" });
      const {
        getPadGain,
        removeFadingOutPad,
        isPadFadingOut,
        setLayerChain,
        setLayerCycleIndex,
        getLayerChain,
        getLayerCycleIndex,
      } = await import("./audioState");
      const { resetPadGain } = await import("./gainManager");
      getPadGain("pad-stale-guard");
      // Seed chain state so we can assert it is NOT cleared by the stale cleanup
      setLayerChain("layer-stale-guard", []);
      setLayerCycleIndex("layer-stale-guard", 1);
      const { fadePad } = await import("./fadeMixer");
      const pad = createMockPad({ id: "pad-stale-guard", layers: [layer] });

      fadePad(pad, 1.0, 0, 500);
      expect(isPadFadingOut("pad-stale-guard")).toBe(true);

      // Simulate: fade state cleared without cancelling timeout (e.g., by a re-trigger
      // that calls cancelPadFade — removeFadingOutPad alone replicates that race).
      removeFadingOutPad("pad-stale-guard");
      vi.advanceTimersByTime(600);

      // Guard should prevent ALL cleanup from running on stale timeout
      expect(resetPadGain).not.toHaveBeenCalled();
      expect(getLayerChain("layer-stale-guard")).toEqual([]); // NOT cleared
      expect(getLayerCycleIndex("layer-stale-guard")).toBe(1); // NOT cleared
    });

    it("does not stop pad when fading to a non-zero volume", async () => {
      const mockGain = makeMockGain(1.0);
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain } = await import("./audioState");
      getPadGain("pad-partial-fade");
      const { fadePad } = await import("./fadeMixer");
      const { resetPadGain } = await import("./gainManager");
      const pad = createMockPad({ id: "pad-partial-fade" });

      fadePad(pad, 1.0, 0.3, 500);
      vi.advanceTimersByTime(600);

      expect(resetPadGain).not.toHaveBeenCalled();
    });
  });

  describe("fadePad — fading up", () => {
    it("ramps gain up from provided fromVolume to 1.0", async () => {
      const mockGain = makeMockGain();
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain } = await import("./audioState");
      getPadGain("pad-fadein");
      mockGain.gain.setValueAtTime.mockClear();
      const { fadePad } = await import("./fadeMixer");
      const pad = createMockPad({ id: "pad-fadein" });

      fadePad(pad, 0.3, 1.0, 1000);

      expect(mockGain.gain.setValueAtTime).toHaveBeenCalledWith(0.3, 0);
      expect(mockGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1.0, 1);
    });

    it("ramps to specified toVolume", async () => {
      const mockGain = makeMockGain();
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain } = await import("./audioState");
      getPadGain("pad-fadein-vol");
      const { fadePad } = await import("./fadeMixer");
      const pad = createMockPad({ id: "pad-fadein-vol" });

      fadePad(pad, 0.2, 0.7, 1000);

      expect(mockGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.7, 1);
    });
  });
});
