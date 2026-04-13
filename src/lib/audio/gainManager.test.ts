// src/lib/audio/gainManager.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCtx = {
  currentTime: 0,
  createGain: vi.fn(),
};

vi.mock("./audioContext", () => ({
  getAudioContext: vi.fn(() => mockCtx),
  getMasterGain: vi.fn(() => ({ connect: vi.fn() })),
}));

vi.mock("@/state/playbackStore", () => ({
  usePlaybackStore: { getState: vi.fn(() => ({ updateLayerVolume: vi.fn() })) },
}));

vi.mock("@/state/projectStore", () => ({
  useProjectStore: { getState: vi.fn(() => ({ updateLayerVolume: vi.fn() })) },
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
    mockCtx.currentTime = 0;
    mockCtx.createGain.mockReset();
    const { clearAllPadGains, clearAllLayerGains } = await import("./audioState");
    clearAllPadGains();
    clearAllLayerGains();
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
      expect(mockGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.5, 0.016);
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
    it("updates an active layer gain node immediately (0–100 scale)", async () => {
      const mockPadGain = makeMockGain();
      const mockLayerGain = makeMockGain();
      mockCtx.createGain.mockReturnValueOnce(mockPadGain).mockReturnValueOnce(mockLayerGain);
      const { getPadGain, getOrCreateLayerGain } = await import("./audioState");
      const padGain = getPadGain("pad-sync");
      getOrCreateLayerGain("layer-sync", 80, padGain);
      const { syncLayerVolume } = await import("./gainManager");

      syncLayerVolume("layer-sync", 50);

      expect(mockLayerGain.gain.setValueAtTime).toHaveBeenCalledWith(0.5, 0);
    });

    it("is a no-op if the layer has no active gain node", async () => {
      const { syncLayerVolume } = await import("./gainManager");
      expect(() => syncLayerVolume("nonexistent-layer", 80)).not.toThrow();
    });

    it("clamps values above 100 to 1.0", async () => {
      const mockPadGain = makeMockGain();
      const mockLayerGain = makeMockGain();
      mockCtx.createGain.mockReturnValueOnce(mockPadGain).mockReturnValueOnce(mockLayerGain);
      const { getPadGain, getOrCreateLayerGain } = await import("./audioState");
      const padGain = getPadGain("pad-sync-hi");
      getOrCreateLayerGain("layer-sync-hi", 80, padGain);
      const { syncLayerVolume } = await import("./gainManager");

      syncLayerVolume("layer-sync-hi", 150);

      expect(mockLayerGain.gain.setValueAtTime).toHaveBeenCalledWith(1.0, 0);
    });

    it("clamps NaN to 1.0 (safe default, matches schema 100% default volume)", async () => {
      const mockPadGain = makeMockGain();
      const mockLayerGain = makeMockGain();
      mockCtx.createGain.mockReturnValueOnce(mockPadGain).mockReturnValueOnce(mockLayerGain);
      const { getPadGain, getOrCreateLayerGain } = await import("./audioState");
      const padGain = getPadGain("pad-sync-nan");
      getOrCreateLayerGain("layer-sync-nan", 80, padGain);
      const { syncLayerVolume } = await import("./gainManager");

      syncLayerVolume("layer-sync-nan", NaN);

      expect(mockLayerGain.gain.setValueAtTime).toHaveBeenCalledWith(1.0, 0);
    });
  });

  describe("setLayerVolume", () => {
    it("updates gain node directly when the layer is active", async () => {
      const mockPadGain = makeMockGain();
      const mockLayerGain = makeMockGain();
      mockCtx.createGain.mockReturnValueOnce(mockPadGain).mockReturnValueOnce(mockLayerGain);
      const { getPadGain, getOrCreateLayerGain } = await import("./audioState");
      const padGain = getPadGain("pad-setlvol");
      getOrCreateLayerGain("layer-setlvol", 80, padGain);
      const { setLayerVolume } = await import("./gainManager");

      setLayerVolume("layer-setlvol", 0.75);

      expect(mockLayerGain.gain.setValueAtTime).toHaveBeenCalledWith(0.75, 0);
    });

    it("pushes to playback store when layer is not active", async () => {
      const { usePlaybackStore } = await import("@/state/playbackStore");
      const mockUpdate = vi.fn();
      vi.mocked(usePlaybackStore.getState).mockReturnValue({ updateLayerVolume: mockUpdate } as unknown as ReturnType<typeof usePlaybackStore.getState>);
      const { setLayerVolume } = await import("./gainManager");

      setLayerVolume("inactive-layer", 0.6);

      expect(mockUpdate).toHaveBeenCalledWith("inactive-layer", 0.6);
    });

    it("clamps out-of-range values (above 1.0 → 1.0, below 0 → 0)", async () => {
      const { usePlaybackStore } = await import("@/state/playbackStore");
      const mockUpdate = vi.fn();
      vi.mocked(usePlaybackStore.getState).mockReturnValue({ updateLayerVolume: mockUpdate } as unknown as ReturnType<typeof usePlaybackStore.getState>);
      const { setLayerVolume } = await import("./gainManager");

      setLayerVolume("inactive-hi", 1.5);
      setLayerVolume("inactive-lo", -0.2);

      expect(mockUpdate).toHaveBeenCalledWith("inactive-hi", 1.0);
      expect(mockUpdate).toHaveBeenCalledWith("inactive-lo", 0);
    });
  });

  describe("commitLayerVolume", () => {
    it("persists clamped volume to project store", async () => {
      const { useProjectStore } = await import("@/state/projectStore");
      const mockUpdate = vi.fn();
      vi.mocked(useProjectStore.getState).mockReturnValue({ updateLayerVolume: mockUpdate } as unknown as ReturnType<typeof useProjectStore.getState>);
      const { commitLayerVolume } = await import("./gainManager");

      commitLayerVolume("layer-commit", 0.9);

      expect(mockUpdate).toHaveBeenCalledWith("layer-commit", 0.9);
    });

    it("clamps out-of-range values (1.5 → 1.0, -0.1 → 0)", async () => {
      const { useProjectStore } = await import("@/state/projectStore");
      const mockUpdate = vi.fn();
      vi.mocked(useProjectStore.getState).mockReturnValue({ updateLayerVolume: mockUpdate } as unknown as ReturnType<typeof useProjectStore.getState>);
      const { commitLayerVolume } = await import("./gainManager");

      commitLayerVolume("layer-hi", 1.5);
      commitLayerVolume("layer-lo", -0.1);

      expect(mockUpdate).toHaveBeenCalledWith("layer-hi", 1.0);
      expect(mockUpdate).toHaveBeenCalledWith("layer-lo", 0);
    });
  });
});
