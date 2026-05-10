// src/lib/audio/gainManager.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { _CLICK_FREE_RAMP_S } from "./gainManager";

const mockCtx = {
  currentTime: 0,
  createGain: vi.fn(),
  createDynamicsCompressor: vi.fn(() => ({
    threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 1 },
    attack: { value: 0 }, release: { value: 0 },
    connect: vi.fn(), disconnect: vi.fn(),
  })),
};

vi.mock("./audioContext", () => ({
  getAudioContext: vi.fn(() => mockCtx),
  getMasterGain: vi.fn(() => ({ connect: vi.fn() })),
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

describe("gainManager", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockCtx.currentTime = 0;
    mockCtx.createGain.mockReset();
    const { clearAllAudioState } = await import("./audioState");
    clearAllAudioState();
  });

  describe("setPadVolume", () => {
    it("schedules a linear ramp on the pad gain node", async () => {
      const mockGain = makeMockGain();
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain } = await import("./audioState");
      getPadGain("pad-1");
      const { setPadVolume } = await import("./gainManager");

      setPadVolume("pad-1", 0.5);

      expect(mockGain.gain.cancelScheduledValues).toHaveBeenCalledWith(0);
      expect(mockGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.5, _CLICK_FREE_RAMP_S);
    });

    it("clamps volume above 1 to 1", async () => {
      const mockGain = makeMockGain();
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain } = await import("./audioState");
      getPadGain("pad-clamp-hi");
      const { setPadVolume } = await import("./gainManager");

      setPadVolume("pad-clamp-hi", 1.5);

      expect(mockGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, expect.any(Number));
    });

    it("clamps volume below 0 to 0", async () => {
      const mockGain = makeMockGain();
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain } = await import("./audioState");
      getPadGain("pad-clamp-lo");
      const { setPadVolume } = await import("./gainManager");

      setPadVolume("pad-clamp-lo", -0.5);

      expect(mockGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, expect.any(Number));
    });

    it("clamps NaN to 0 (guards against malformed data)", async () => {
      const mockGain = makeMockGain();
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain } = await import("./audioState");
      getPadGain("pad-nan");
      const { setPadVolume } = await import("./gainManager");

      setPadVolume("pad-nan", NaN);

      expect(mockGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, expect.any(Number));
    });
  });

  describe("resetPadGain", () => {
    it("resets gain to 1.0 and cancels any scheduled values", async () => {
      const mockGain = makeMockGain(0.3);
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain } = await import("./audioState");
      getPadGain("pad-reset");
      const { resetPadGain } = await import("./gainManager");

      resetPadGain("pad-reset");

      expect(mockGain.gain.cancelScheduledValues).toHaveBeenCalledWith(0);
      expect(mockGain.gain.setValueAtTime).toHaveBeenCalledWith(1.0, 0);
    });
  });

  describe("syncLayerVolume", () => {
    it("ramps an active layer gain node to the new value (0–1 normalized scale)", async () => {
      const mockPadGain = makeMockGain();
      const mockLayerGain = makeMockGain();
      const gainQueue = [mockPadGain, mockLayerGain];
      mockCtx.createGain.mockImplementation(() => {
        const next = gainQueue.shift();
        if (!next) throw new Error("createGain called more times than expected");
        return next;
      });
      const { getPadGain, getOrCreateLayerGain } = await import("./audioState");
      const padGain = getPadGain("pad-sync");
      getOrCreateLayerGain("layer-sync", 0.8, padGain);
      const { syncLayerVolume } = await import("./gainManager");

      syncLayerVolume("layer-sync", 0.5);

      expect(mockLayerGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.5, 0.016);
    });

    it("is a no-op if the layer has no active gain node", async () => {
      const { syncLayerVolume } = await import("./gainManager");
      expect(() => syncLayerVolume("nonexistent-layer", 0.8)).not.toThrow();
    });

    it("clamps values above 1 to 1.0", async () => {
      const mockPadGain = makeMockGain();
      const mockLayerGain = makeMockGain();
      const gainQueue = [mockPadGain, mockLayerGain];
      mockCtx.createGain.mockImplementation(() => {
        const next = gainQueue.shift();
        if (!next) throw new Error("createGain called more times than expected");
        return next;
      });
      const { getPadGain, getOrCreateLayerGain } = await import("./audioState");
      const padGain = getPadGain("pad-sync-hi");
      getOrCreateLayerGain("layer-sync-hi", 0.8, padGain);
      const { syncLayerVolume } = await import("./gainManager");

      syncLayerVolume("layer-sync-hi", 1.5);

      expect(mockLayerGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1.0, expect.any(Number));
    });

    it("clamps values below 0 to 0", async () => {
      const mockPadGain = makeMockGain();
      const mockLayerGain = makeMockGain();
      const gainQueue = [mockPadGain, mockLayerGain];
      mockCtx.createGain.mockImplementation(() => {
        const next = gainQueue.shift();
        if (!next) throw new Error("createGain called more times than expected");
        return next;
      });
      const { getPadGain, getOrCreateLayerGain } = await import("./audioState");
      const padGain = getPadGain("pad-sync-lo");
      getOrCreateLayerGain("layer-sync-lo", 0.8, padGain);
      const { syncLayerVolume } = await import("./gainManager");

      syncLayerVolume("layer-sync-lo", -0.5);

      expect(mockLayerGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, expect.any(Number));
    });

    it("clamps NaN to 0 (silence is the safe default)", async () => {
      const mockPadGain = makeMockGain();
      const mockLayerGain = makeMockGain();
      const gainQueue = [mockPadGain, mockLayerGain];
      mockCtx.createGain.mockImplementation(() => {
        const next = gainQueue.shift();
        if (!next) throw new Error("createGain called more times than expected");
        return next;
      });
      const { getPadGain, getOrCreateLayerGain } = await import("./audioState");
      const padGain = getPadGain("pad-sync-nan");
      getOrCreateLayerGain("layer-sync-nan", 0.8, padGain);
      const { syncLayerVolume } = await import("./gainManager");

      syncLayerVolume("layer-sync-nan", NaN);

      expect(mockLayerGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, expect.any(Number));
    });
  });

  describe("setLayerVolume", () => {
    it("updates gain node directly when the layer is active", async () => {
      const mockPadGain = makeMockGain();
      const mockLayerGain = makeMockGain();
      const gainQueue = [mockPadGain, mockLayerGain];
      mockCtx.createGain.mockImplementation(() => {
        const next = gainQueue.shift();
        if (!next) throw new Error("createGain called more times than expected");
        return next;
      });
      const { getPadGain, getOrCreateLayerGain } = await import("./audioState");
      const padGain = getPadGain("pad-setlvol");
      getOrCreateLayerGain("layer-setlvol", 0.8, padGain);
      const { setLayerVolume } = await import("./gainManager");

      setLayerVolume("layer-setlvol", 0.75);

      expect(mockLayerGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.75, expect.any(Number));
    });

    it("is a no-op when the layer is not active", async () => {
      const mockGain = makeMockGain();
      mockCtx.createGain.mockReturnValueOnce(mockGain);
      const { setLayerVolume } = await import("./gainManager");

      setLayerVolume("inactive-layer", 0.6);

      expect(mockGain.gain.linearRampToValueAtTime).not.toHaveBeenCalled();
    });

    it("clamps out-of-range values when the layer is active (above 1.0 → 1.0, below 0 → 0)", async () => {
      const mockPadGain = makeMockGain();
      const mockLayerGain = makeMockGain();
      const gainQueue = [mockPadGain, mockLayerGain];
      mockCtx.createGain.mockImplementation(() => {
        const next = gainQueue.shift();
        if (!next) throw new Error("createGain called more times than expected");
        return next;
      });
      const { getPadGain, getOrCreateLayerGain } = await import("./audioState");
      const padGain = getPadGain("pad-clamp");
      getOrCreateLayerGain("layer-clamp", 0.5, padGain);
      const { setLayerVolume } = await import("./gainManager");

      setLayerVolume("layer-clamp", 1.5);
      setLayerVolume("layer-clamp", -0.2);

      expect(mockLayerGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1.0, expect.any(Number));
      expect(mockLayerGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, expect.any(Number));
    });
  });

  // commitLayerVolume was removed from gainManager — persisting layer volume to
  // the project schema is a UI-layer concern.

  describe("rampGainTo", () => {
    it("schedules a ramp using the default rampS (0.016) and anchors from param.value", async () => {
      const mockGain = makeMockGain(0.4);
      const { rampGainTo } = await import("./gainManager");

      rampGainTo(mockGain.gain as unknown as AudioParam, 0.9);

      expect(mockGain.gain.cancelScheduledValues).toHaveBeenCalledWith(0);
      expect(mockGain.gain.setValueAtTime).toHaveBeenCalledWith(0.4, 0);
      expect(mockGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.9, 0.016);
    });

    it("uses a custom rampS when provided", async () => {
      const mockGain = makeMockGain(0.2);
      const { rampGainTo } = await import("./gainManager");

      rampGainTo(mockGain.gain as unknown as AudioParam, 0.7, 0.5);

      expect(mockGain.gain.setValueAtTime).toHaveBeenCalledWith(0.2, 0);
      expect(mockGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.7, 0.5);
    });

    it("uses an explicit from value when provided (does not read param.value)", async () => {
      const mockGain = makeMockGain(0.4);
      const { rampGainTo } = await import("./gainManager");

      rampGainTo(mockGain.gain as unknown as AudioParam, 0.9, 0.25, 0.0);

      expect(mockGain.gain.setValueAtTime).toHaveBeenCalledWith(0.0, 0);
      expect(mockGain.gain.setValueAtTime).not.toHaveBeenCalledWith(0.4, 0);
      expect(mockGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.9, 0.25);
    });
  });
});
