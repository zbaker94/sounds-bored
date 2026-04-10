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
    computeAllPadProgress: vi.fn().mockReturnValue({}),
  };
});

import {
  getActivePadCount,
  forEachActivePadGain,
  forEachActiveLayerGain,
  getActiveLayerIdSet,
  computeAllPadProgress,
} from "./audioState";

describe("audioTick", () => {
  beforeEach(() => {
    usePlaybackStore.setState({ ...initialPlaybackState });
    vi.mocked(getActivePadCount).mockReturnValue(0);
    vi.mocked(forEachActivePadGain).mockImplementation(() => {});
    vi.mocked(forEachActiveLayerGain).mockImplementation(() => {});
    vi.mocked(getActiveLayerIdSet).mockReturnValue(new Set());
    vi.mocked(computeAllPadProgress).mockReturnValue({});
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
});
