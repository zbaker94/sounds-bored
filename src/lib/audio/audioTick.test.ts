import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { startAudioTick, stopAudioTick } from "./audioTick";
import { usePlaybackStore, initialPlaybackState } from "@/state/playbackStore";

vi.mock("./audioState", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./audioState")>();
  return {
    ...actual,
    getActivePadCount: vi.fn().mockReturnValue(0),
    forEachActivePadGain: vi.fn(),
    forEachActiveLayerGain: vi.fn(),
    getActiveLayerIdSet: vi.fn().mockReturnValue(new Set()),
    getLayerVoiceVersion: vi.fn().mockReturnValue(0),
    computeAllPadProgress: vi.fn().mockReturnValue({}),
    computeAllLayerProgress: vi.fn().mockReturnValue({}),
  };
});

import {
  getActivePadCount,
  forEachActivePadGain,
  forEachActiveLayerGain,
  getActiveLayerIdSet,
  getLayerVoiceVersion,
  computeAllPadProgress,
  computeAllLayerProgress,
} from "./audioState";

describe("audioTick", () => {
  beforeEach(() => {
    usePlaybackStore.setState({ ...initialPlaybackState });
    vi.mocked(getActivePadCount).mockReturnValue(0);
    vi.mocked(forEachActivePadGain).mockImplementation(() => {});
    vi.mocked(forEachActiveLayerGain).mockImplementation(() => {});
    vi.mocked(getActiveLayerIdSet).mockReturnValue(new Set());
    vi.mocked(getLayerVoiceVersion).mockReturnValue(0);
    vi.mocked(computeAllPadProgress).mockReturnValue({});
    vi.mocked(computeAllLayerProgress).mockReturnValue({});
  });

  afterEach(() => {
    stopAudioTick();
  });

  it("stopAudioTick clears all tick-managed store fields", () => {
    usePlaybackStore.getState().setAudioTick({
      padVolumes: { "pad-1": 0.5 },
      layerVolumes: { "layer-1": 0.7 },
      padProgress: { "pad-1": 0.3 },
      activeLayerIds: new Set(["layer-1"]),
    });

    stopAudioTick();

    const state = usePlaybackStore.getState();
    expect(state.padVolumes).toEqual({});
    expect(state.layerVolumes).toEqual({});
    expect(state.padProgress).toEqual({});
    expect(state.activeLayerIds.size).toBe(0);
  });

  it("startAudioTick is idempotent — calling twice does not create two RAFs", () => {
    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockReturnValue(1 as unknown as ReturnType<typeof requestAnimationFrame>);
    startAudioTick();
    startAudioTick();
    expect(rafSpy).toHaveBeenCalledTimes(1);
    rafSpy.mockRestore();
  });

  it("stopAudioTick is safe to call when tick is not running", () => {
    expect(() => stopAudioTick()).not.toThrow();
  });

  it("stopAudioTick cancels a running RAF", () => {
    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockReturnValue(42 as unknown as ReturnType<typeof requestAnimationFrame>);
    const cancelSpy = vi.spyOn(globalThis, "cancelAnimationFrame");
    startAudioTick();
    stopAudioTick();
    expect(cancelSpy).toHaveBeenCalledWith(42);
    rafSpy.mockRestore();
    cancelSpy.mockRestore();
  });

  it("self-terminates and clears store when no pads are active", () => {
    // Seed the store with some values
    usePlaybackStore.getState().setAudioTick({
      padVolumes: { "pad-1": 0.5 },
      padProgress: { "pad-1": 0.3 },
      activeLayerIds: new Set(["layer-1"]),
    });

    // getActivePadCount already mocked to return 0 in beforeEach

    let capturedCallback: FrameRequestCallback | null = null;
    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      capturedCallback = cb;
      return 1 as unknown as ReturnType<typeof requestAnimationFrame>;
    });

    startAudioTick();
    expect(capturedCallback).not.toBeNull();

    // Invoke the tick callback manually — getActivePadCount returns 0, so it self-terminates
    capturedCallback!(performance.now());

    const state = usePlaybackStore.getState();
    expect(state.padVolumes).toEqual({});
    expect(state.padProgress).toEqual({});
    expect(state.activeLayerIds.size).toBe(0);

    // No further RAF should have been scheduled (tick exited)
    expect(rafSpy).toHaveBeenCalledTimes(1); // only the initial startAudioTick call

    rafSpy.mockRestore();
  });

  it("does not call getActiveLayerIdSet when layerVoiceVersion is unchanged", () => {
    vi.mocked(getActivePadCount).mockReturnValue(1);
    vi.mocked(computeAllPadProgress).mockReturnValue({ "pad-1": 0.1 });
    vi.mocked(computeAllLayerProgress).mockReturnValue({});
    // Version stays at 0 across both ticks
    vi.mocked(getLayerVoiceVersion).mockReturnValue(0);

    let capturedCallback: FrameRequestCallback | null = null;
    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      capturedCallback = cb;
      return 1 as unknown as ReturnType<typeof requestAnimationFrame>;
    });

    startAudioTick();
    capturedCallback!(performance.now()); // first tick — version seen for first time (version 0 vs prev -1 → changed)
    vi.mocked(getActiveLayerIdSet).mockClear();

    capturedCallback!(performance.now()); // second tick — same version → should skip
    expect(getActiveLayerIdSet).not.toHaveBeenCalled();

    rafSpy.mockRestore();
  });

  it("calls getActiveLayerIdSet and updates store when layerVoiceVersion changes", () => {
    vi.mocked(getActivePadCount).mockReturnValue(1);
    vi.mocked(computeAllPadProgress).mockReturnValue({ "pad-1": 0.1 });
    vi.mocked(computeAllLayerProgress).mockReturnValue({});
    vi.mocked(getLayerVoiceVersion).mockReturnValue(0);

    const newActiveIds = new Set(["layer-1"]);
    vi.mocked(getActiveLayerIdSet).mockReturnValue(newActiveIds);

    let capturedCallback: FrameRequestCallback | null = null;
    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      capturedCallback = cb;
      return 1 as unknown as ReturnType<typeof requestAnimationFrame>;
    });

    startAudioTick();
    capturedCallback!(performance.now()); // first tick — version 0 vs prev -1 → changed

    // Simulate a voice being added: version bumps to 1
    vi.mocked(getLayerVoiceVersion).mockReturnValue(1);
    capturedCallback!(performance.now()); // second tick — version changed → must call getActiveLayerIdSet

    expect(getActiveLayerIdSet).toHaveBeenCalled();
    expect(usePlaybackStore.getState().activeLayerIds).toBe(newActiveIds);

    rafSpy.mockRestore();
  });

  it("only emits padVolumes entries for gains below 0.999", () => {
    vi.mocked(getActivePadCount).mockReturnValue(2);
    vi.mocked(computeAllPadProgress).mockReturnValue({});
    vi.mocked(computeAllLayerProgress).mockReturnValue({});
    vi.mocked(getActiveLayerIdSet).mockReturnValue(new Set());
    vi.mocked(forEachActiveLayerGain).mockImplementation(() => {});

    // Simulate: pad-1 has gain 0.5, pad-2 has gain 1.0 (should be excluded)
    vi.mocked(forEachActivePadGain).mockImplementation((fn) => {
      fn("pad-1", { gain: { value: 0.5 } } as unknown as GainNode);
      fn("pad-2", { gain: { value: 1.0 } } as unknown as GainNode);
    });

    let capturedCallback: FrameRequestCallback | null = null;
    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      capturedCallback = cb;
      return 1 as unknown as ReturnType<typeof requestAnimationFrame>;
    });

    startAudioTick();
    capturedCallback!(performance.now());

    const state = usePlaybackStore.getState();
    expect(state.padVolumes["pad-1"]).toBe(0.5);
    expect(state.padVolumes["pad-2"]).toBeUndefined(); // full volume excluded

    rafSpy.mockRestore();
  });
});
