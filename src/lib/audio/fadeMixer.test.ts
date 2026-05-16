// src/lib/audio/fadeMixer.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockPad, createMockLayer } from "@/test/factories";

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
  applyMasterVolume: vi.fn(),
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

function makeMockVoice() {
  return { setOnEnded: vi.fn(), stop: vi.fn(), stopWithRamp: vi.fn() } as unknown as import("./audioVoice").AudioVoice;
}

describe("fadeMixer", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.clearAllMocks();
    mockCtx.currentTime = 0;
    mockCtx.createGain.mockReset();
    const { clearAllAudioState } = await import("./audioState");
    clearAllAudioState();
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
      const { getPadGain } = await import("./gainRegistry");
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

    it("clears playbackStore fadingPadIds and fadingOutPadIds", async () => {
      const mockGain = makeMockGain();
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain } = await import("./gainRegistry");
      getPadGain("pad-freeze-store");
      const { freezePadAtCurrentVolume } = await import("./fadeMixer");
      const { usePlaybackStore } = await import("@/state/playbackStore");

      // Seed both fade flags so we can verify they get cleared.
      usePlaybackStore.getState().addFadingPad("pad-freeze-store");
      usePlaybackStore.getState().addFadingOutPad("pad-freeze-store");
      expect(usePlaybackStore.getState().fadingPadIds.has("pad-freeze-store")).toBe(true);
      expect(usePlaybackStore.getState().fadingOutPadIds.has("pad-freeze-store")).toBe(true);

      freezePadAtCurrentVolume("pad-freeze-store");

      expect(usePlaybackStore.getState().fadingPadIds.has("pad-freeze-store")).toBe(false);
      expect(usePlaybackStore.getState().fadingOutPadIds.has("pad-freeze-store")).toBe(false);
    });
  });

  describe("fadePad — fading down", () => {
    it("schedules a linear ramp to 0 and marks pad as fading out", async () => {
      const mockGain = makeMockGain(1.0);
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain } = await import("./gainRegistry");
      const { isFadingOut } = await import("./fadeCoordinator");
      getPadGain("pad-fadeout");
      const { fadePad } = await import("./fadeMixer");
      const pad = createMockPad({ id: "pad-fadeout" });

      fadePad(pad, 1.0, 0, 1000, undefined);

      expect(mockGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 1);
      expect(isFadingOut("pad-fadeout")).toBe(true);
    });

    it("stops pad voices and resets gain after fade-to-0 completes", async () => {
      const mockGain = makeMockGain(1.0);
      mockCtx.createGain.mockReturnValue(mockGain);
      const layer = createMockLayer({ id: "layer-fadeout-stop" });
      const { getPadGain } = await import("./gainRegistry");
      const { setLayerChain, getLayerChain, getLayerCycleIndex, setLayerCycleIndex, setLayerPlayOrder, getLayerPlayOrder } = await import("./chainCycleState");
      getPadGain("pad-fadeout-stop");
      setLayerChain("layer-fadeout-stop", []);
      setLayerCycleIndex("layer-fadeout-stop", 1);
      setLayerPlayOrder("layer-fadeout-stop", []);
      const { fadePad } = await import("./fadeMixer");
      const { resetPadGain } = await import("./gainManager");
      const pad = createMockPad({ id: "pad-fadeout-stop", layers: [layer] });

      fadePad(pad, 1.0, 0, 500, undefined);
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
      const { getPadGain } = await import("./gainRegistry");
      const { recordLayerVoice } = await import("./voiceRegistry");
      getPadGain("pad-null-ended");
      const mockVoice = makeMockVoice();
      recordLayerVoice("pad-null-ended", "layer-null-ended", mockVoice);
      const { fadePad } = await import("./fadeMixer");
      const pad = createMockPad({ id: "pad-null-ended" });

      fadePad(pad, 1.0, 0, 1000, undefined);

      // Prevents chain-continuation callbacks from firing during the fade window
      expect(mockVoice.setOnEnded).toHaveBeenCalledWith(null);
    });

    it("does not run onComplete cleanup when fade is cancelled before timeout fires", async () => {
      const mockGain = makeMockGain(1.0);
      mockCtx.createGain.mockReturnValue(mockGain);
      const layer = createMockLayer({ id: "layer-cancel-cleanup" });
      const { getPadGain } = await import("./gainRegistry");
      const {
        cancelFade,
        isFadingOut,
      } = await import("./fadeCoordinator");
      const {
        setLayerChain,
        setLayerCycleIndex,
        getLayerChain,
        getLayerCycleIndex,
      } = await import("./chainCycleState");
      const { resetPadGain } = await import("./gainManager");
      getPadGain("pad-cancel-cleanup");
      // Seed chain state so we can assert it is NOT cleared by a cancelled fade
      setLayerChain("layer-cancel-cleanup", []);
      setLayerCycleIndex("layer-cancel-cleanup", 1);
      const { fadePad } = await import("./fadeMixer");
      const pad = createMockPad({ id: "pad-cancel-cleanup", layers: [layer] });

      fadePad(pad, 1.0, 0, 500, undefined);
      expect(isFadingOut("pad-cancel-cleanup")).toBe(true);

      // Simulate: fade cancelled by a re-trigger before the completion timeout fires.
      // cancelFade clears the timeout, fadingOut membership, and playbackStore signals
      // atomically — so the fadePad onComplete cleanup must NOT run.
      cancelFade("pad-cancel-cleanup");
      vi.advanceTimersByTime(600);

      // Cancelled timeout must not invoke the onComplete cleanup
      expect(resetPadGain).not.toHaveBeenCalled();
      expect(getLayerChain("layer-cancel-cleanup")).toEqual([]); // NOT cleared
      expect(getLayerCycleIndex("layer-cancel-cleanup")).toBe(1); // NOT cleared
    });

    it("does not stop pad when fading to a non-zero volume", async () => {
      const mockGain = makeMockGain(1.0);
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain } = await import("./gainRegistry");
      getPadGain("pad-partial-fade");
      const { fadePad } = await import("./fadeMixer");
      const { resetPadGain } = await import("./gainManager");
      const pad = createMockPad({ id: "pad-partial-fade" });

      fadePad(pad, 1.0, 0.3, 500, undefined);
      vi.advanceTimersByTime(600);

      expect(resetPadGain).not.toHaveBeenCalled();
    });

    it("cancelFade on a partial-fade clears the fading-out flag", async () => {
      const mockGain = makeMockGain(1.0);
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain } = await import("./gainRegistry");
      const { isFadingOut, cancelFade } = await import("./fadeCoordinator");
      getPadGain("pad-partial-retrigger");
      const { fadePad } = await import("./fadeMixer");
      const pad = createMockPad({ id: "pad-partial-retrigger" });

      fadePad(pad, 1.0, 0.3, 500, undefined);
      expect(isFadingOut("pad-partial-retrigger")).toBe(true);

      cancelFade("pad-partial-retrigger");
      vi.advanceTimersByTime(600);

      expect(isFadingOut("pad-partial-retrigger")).toBe(false);
    });

    it("mirrors fading-out state to playbackStore", async () => {
      const mockGain = makeMockGain(1.0);
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain } = await import("./gainRegistry");
      getPadGain("pad-store-mirror");
      const { fadePad } = await import("./fadeMixer");
      const { usePlaybackStore } = await import("@/state/playbackStore");
      const pad = createMockPad({ id: "pad-store-mirror" });

      fadePad(pad, 1.0, 0, 1000, undefined);

      expect(usePlaybackStore.getState().fadingOutPadIds.has(pad.id)).toBe(true);
      expect(usePlaybackStore.getState().fadingPadIds.has(pad.id)).toBe(true);
    });

    it("uses live pad layers at fade completion — clears state for layer added mid-fade", async () => {
      const mockGain = makeMockGain(1.0);
      mockCtx.createGain.mockReturnValue(mockGain);
      const layer1 = createMockLayer({ id: "layer-live-add-1" });
      const layer2 = createMockLayer({ id: "layer-live-add-2" });
      const { getPadGain } = await import("./gainRegistry");
      const { setLayerChain, getLayerChain } = await import("./chainCycleState");
      getPadGain("pad-live-add");
      setLayerChain("layer-live-add-1", []);
      const pad = createMockPad({ id: "pad-live-add", layers: [layer1] });
      const { fadePad } = await import("./fadeMixer");

      let livePad = pad;
      const getPad = (padId: string) => padId === pad.id ? livePad : undefined;

      fadePad(pad, 1.0, 0, 500, getPad);

      // Simulate mid-fade: layer2 added to the live pad
      setLayerChain("layer-live-add-2", []);
      livePad = { ...pad, layers: [layer1, layer2] };

      vi.advanceTimersByTime(600);

      expect(getLayerChain("layer-live-add-1")).toBeUndefined();
      expect(getLayerChain("layer-live-add-2")).toBeUndefined();
    });

    it("does not clear state for layer removed from live pad mid-fade", async () => {
      const mockGain = makeMockGain(1.0);
      mockCtx.createGain.mockReturnValue(mockGain);
      const layer1 = createMockLayer({ id: "layer-live-rm-1" });
      const layer2 = createMockLayer({ id: "layer-live-rm-2" });
      const { getPadGain } = await import("./gainRegistry");
      const { setLayerChain, getLayerChain } = await import("./chainCycleState");
      getPadGain("pad-live-rm");
      setLayerChain("layer-live-rm-1", []);
      setLayerChain("layer-live-rm-2", []);
      const pad = createMockPad({ id: "pad-live-rm", layers: [layer1, layer2] });
      const { fadePad } = await import("./fadeMixer");

      let livePad = pad;
      const getPad = (padId: string) => padId === pad.id ? livePad : undefined;

      fadePad(pad, 1.0, 0, 500, getPad);

      // Simulate mid-fade: layer1 removed from live pad
      livePad = { ...pad, layers: [layer2] };

      vi.advanceTimersByTime(600);

      // layer2 is in live pad — cleared
      expect(getLayerChain("layer-live-rm-2")).toBeUndefined();
      // layer1 was removed from live pad — NOT cleared by this timeout
      expect(getLayerChain("layer-live-rm-1")).toEqual([]);
    });

    it("falls back to captured pad when pad is removed from project mid-fade", async () => {
      const mockGain = makeMockGain(1.0);
      mockCtx.createGain.mockReturnValue(mockGain);
      const layer1 = createMockLayer({ id: "layer-live-del-1" });
      const { getPadGain } = await import("./gainRegistry");
      const { setLayerChain, getLayerChain } = await import("./chainCycleState");
      const { resetPadGain } = await import("./gainManager");
      getPadGain("pad-live-del");
      setLayerChain("layer-live-del-1", []);
      const pad = createMockPad({ id: "pad-live-del", layers: [layer1] });
      const { fadePad } = await import("./fadeMixer");

      let livePad: typeof pad | undefined = pad;
      const getPad = (padId: string) => padId === pad.id ? livePad : undefined;

      fadePad(pad, 1.0, 0, 500, getPad);

      // Simulate mid-fade: pad removed from project
      livePad = undefined;

      vi.advanceTimersByTime(600);

      // Fallback to captured pad — still runs full cleanup
      expect(getLayerChain("layer-live-del-1")).toBeUndefined();
      expect(resetPadGain).toHaveBeenCalledWith("pad-live-del");
    });
  });

  describe("fadePad — fromVolume === toVolume", () => {
    it("completes without error and does not null onended callbacks", async () => {
      const mockGain = makeMockGain(0.5);
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain } = await import("./gainRegistry");
      const { recordLayerVoice } = await import("./voiceRegistry");
      getPadGain("pad-equal-vol");
      const mockVoice = makeMockVoice();
      recordLayerVoice("pad-equal-vol", "layer-equal-vol", mockVoice);
      const { fadePad } = await import("./fadeMixer");
      const pad = createMockPad({ id: "pad-equal-vol" });

      expect(() => fadePad(pad, 0.5, 0.5, 1000, undefined)).not.toThrow();

      // fadingDown = (0.5 < 0.5) = false → nullPadOnEnded must not be called
      expect(mockVoice.setOnEnded).not.toHaveBeenCalledWith(null);
    });

    it("still schedules a gain ramp when volumes are equal", async () => {
      const mockGain = makeMockGain(0.5);
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain } = await import("./gainRegistry");
      getPadGain("pad-equal-ramp");
      const { fadePad } = await import("./fadeMixer");
      const pad = createMockPad({ id: "pad-equal-ramp" });

      fadePad(pad, 0.5, 0.5, 1000, undefined);

      expect(mockGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.5, expect.any(Number));
    });
  });

  describe("fadePad — fading up", () => {
    it("ramps gain up from provided fromVolume to 1.0", async () => {
      const mockGain = makeMockGain();
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain } = await import("./gainRegistry");
      getPadGain("pad-fadein");
      mockGain.gain.setValueAtTime.mockClear();
      const { fadePad } = await import("./fadeMixer");
      const pad = createMockPad({ id: "pad-fadein" });

      fadePad(pad, 0.3, 1.0, 1000, undefined);

      expect(mockGain.gain.setValueAtTime).toHaveBeenCalledWith(0.3, 0);
      expect(mockGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1.0, 1);
    });

    it("ramps to specified toVolume", async () => {
      const mockGain = makeMockGain();
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain } = await import("./gainRegistry");
      getPadGain("pad-fadein-vol");
      const { fadePad } = await import("./fadeMixer");
      const pad = createMockPad({ id: "pad-fadein-vol" });

      fadePad(pad, 0.2, 0.7, 1000, undefined);

      expect(mockGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.7, 1);
    });
  });

  describe("stopPadInternal", () => {
    it("clears layer chain, cycle index, and play order for all layers", async () => {
      const layer1 = createMockLayer({ id: "layer-si-1" });
      const layer2 = createMockLayer({ id: "layer-si-2" });
      const {
        setLayerChain, setLayerCycleIndex, setLayerPlayOrder,
        getLayerChain, getLayerCycleIndex, getLayerPlayOrder,
      } = await import("./chainCycleState");
      setLayerChain("layer-si-1", []);
      setLayerCycleIndex("layer-si-1", 2);
      setLayerPlayOrder("layer-si-1", []);
      setLayerChain("layer-si-2", []);
      setLayerCycleIndex("layer-si-2", 3);
      setLayerPlayOrder("layer-si-2", []);
      const { stopPadInternal } = await import("./fadeMixer");
      const pad = createMockPad({ id: "pad-si", layers: [layer1, layer2] });

      stopPadInternal(pad);

      expect(getLayerChain("layer-si-1")).toBeUndefined();
      expect(getLayerCycleIndex("layer-si-1")).toBeUndefined();
      expect(getLayerPlayOrder("layer-si-1")).toBeUndefined();
      expect(getLayerChain("layer-si-2")).toBeUndefined();
      expect(getLayerCycleIndex("layer-si-2")).toBeUndefined();
      expect(getLayerPlayOrder("layer-si-2")).toBeUndefined();
    });
  });

  describe("fadePadIn", () => {
    it("calls startPad callback and ramps gain up to toVolume", async () => {
      const mockGain = makeMockGain(0);
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain } = await import("./gainRegistry");
      getPadGain("pad-fpi");
      const { fadePadIn } = await import("./fadeMixer");
      const pad = createMockPad({ id: "pad-fpi" });
      const startPad = vi.fn().mockResolvedValue(undefined);

      await fadePadIn(pad, 0.8, 1000, startPad, undefined);

      expect(startPad).toHaveBeenCalledWith(pad);
      expect(mockGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.8, 1);
    });

    it("bails without ramping if pre-empted during startPad await", async () => {
      const mockGain = makeMockGain(0);
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain } = await import("./gainRegistry");
      const { removeFadingIn } = await import("./fadeCoordinator");
      getPadGain("pad-fpi-bail");
      const { fadePadIn } = await import("./fadeMixer");
      const pad = createMockPad({ id: "pad-fpi-bail" });
      const startPad = vi.fn().mockImplementation(async () => {
        // Simulate a pre-empting fadePad that clears the fading-in flag
        removeFadingIn("pad-fpi-bail");
      });

      await fadePadIn(pad, 0.8, 1000, startPad, undefined);

      expect(mockGain.gain.linearRampToValueAtTime).not.toHaveBeenCalled();
    });

    it("calls stopPadInternal on timeout when toVolume is 0", async () => {
      const mockGain = makeMockGain(0);
      mockCtx.createGain.mockReturnValue(mockGain);
      const layer = createMockLayer({ id: "layer-fpi-stop" });
      const { getPadGain } = await import("./gainRegistry");
      const { setLayerChain, getLayerChain } = await import("./chainCycleState");
      getPadGain("pad-fpi-stop");
      setLayerChain("layer-fpi-stop", []);
      const { fadePadIn } = await import("./fadeMixer");
      const pad = createMockPad({ id: "pad-fpi-stop", layers: [layer] });
      const startPad = vi.fn().mockResolvedValue(undefined);

      await fadePadIn(pad, 0, 500, startPad, undefined);
      vi.advanceTimersByTime(600);

      expect(getLayerChain("layer-fpi-stop")).toBeUndefined();
    });

    it("does not call stopPadInternal on timeout when toVolume is non-zero", async () => {
      const mockGain = makeMockGain(0);
      mockCtx.createGain.mockReturnValue(mockGain);
      const layer = createMockLayer({ id: "layer-fpi-nonzero" });
      const { getPadGain } = await import("./gainRegistry");
      const { setLayerChain, getLayerChain } = await import("./chainCycleState");
      getPadGain("pad-fpi-nonzero");
      setLayerChain("layer-fpi-nonzero", []);
      const { fadePadIn } = await import("./fadeMixer");
      const pad = createMockPad({ id: "pad-fpi-nonzero", layers: [layer] });
      const startPad = vi.fn().mockResolvedValue(undefined);

      await fadePadIn(pad, 0.8, 500, startPad, undefined);
      vi.advanceTimersByTime(600);

      // Chain should remain — stopPadInternal was not called
      expect(getLayerChain("layer-fpi-nonzero")).toEqual([]);
    });

    it("does not call stopPadInternal if pad fade-in is cancelled before timeout fires", async () => {
      const mockGain = makeMockGain(0);
      mockCtx.createGain.mockReturnValue(mockGain);
      const layer = createMockLayer({ id: "layer-fpi-cancel" });
      const { getPadGain } = await import("./gainRegistry");
      const { recordLayerVoice } = await import("./voiceRegistry");
      const { setLayerChain, getLayerChain } = await import("./chainCycleState");
      const { cancelFade } = await import("./fadeCoordinator");
      getPadGain("pad-fpi-cancel");
      const mockVoice = makeMockVoice();
      recordLayerVoice("pad-fpi-cancel", "layer-fpi-cancel", mockVoice);
      setLayerChain("layer-fpi-cancel", []);
      const { fadePadIn } = await import("./fadeMixer");
      const pad = createMockPad({ id: "pad-fpi-cancel", layers: [layer] });
      const startPad = vi.fn().mockResolvedValue(undefined);

      await fadePadIn(pad, 0, 500, startPad, undefined);

      cancelFade("pad-fpi-cancel");
      vi.advanceTimersByTime(600);

      expect(mockVoice.stop).not.toHaveBeenCalled();
      expect(getLayerChain("layer-fpi-cancel")).toEqual([]);
    });

    it("uses live pad layers at fade completion — clears state for layer added mid-fadePadIn", async () => {
      const mockGain = makeMockGain(0);
      mockCtx.createGain.mockReturnValue(mockGain);
      const layer1 = createMockLayer({ id: "layer-fpi-live-1" });
      const layer2 = createMockLayer({ id: "layer-fpi-live-2" });
      const { getPadGain } = await import("./gainRegistry");
      const { setLayerChain, getLayerChain } = await import("./chainCycleState");
      getPadGain("pad-fpi-live");
      setLayerChain("layer-fpi-live-1", []);
      const pad = createMockPad({ id: "pad-fpi-live", layers: [layer1] });
      const { fadePadIn } = await import("./fadeMixer");
      const startPad = vi.fn().mockResolvedValue(undefined);

      let livePad = pad;
      const getPad = (padId: string) => padId === pad.id ? livePad : undefined;

      await fadePadIn(pad, 0, 500, startPad, getPad);

      // Simulate mid-fade: layer2 added to the live pad
      setLayerChain("layer-fpi-live-2", []);
      livePad = { ...pad, layers: [layer1, layer2] };

      vi.advanceTimersByTime(600);

      expect(getLayerChain("layer-fpi-live-1")).toBeUndefined();
      expect(getLayerChain("layer-fpi-live-2")).toBeUndefined();
    });
  });
});
