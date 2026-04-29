import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { startAudioTick, stopAudioTick, _getPrevActiveLayerIds, _stopMasterVolumeSync } from "./audioTick";
import { usePlaybackStore, initialPlaybackState } from "@/state/playbackStore";
import { applyMasterVolume } from "./audioContext";

vi.mock("./audioContext", () => ({
  getAudioContext: vi.fn(),
  getMasterGain: vi.fn(),
  applyMasterVolume: vi.fn(),
  ensureResumed: vi.fn(),
}));

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
    getLayerPlayOrder: vi.fn().mockReturnValue(undefined),
    getLayerChain: vi.fn().mockReturnValue(undefined),
    isAnyGainChanging: vi.fn().mockReturnValue(true),
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
  getLayerPlayOrder,
  getLayerChain,
  isAnyGainChanging,
} from "./audioState";

describe("audioTick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlaybackStore.setState({ ...initialPlaybackState });
    vi.mocked(getActivePadCount).mockReturnValue(0);
    vi.mocked(forEachActivePadGain).mockImplementation(() => {});
    vi.mocked(forEachActiveLayerGain).mockImplementation(() => {});
    vi.mocked(getActiveLayerIdSet).mockReturnValue(new Set());
    vi.mocked(getLayerVoiceVersion).mockReturnValue(0);
    vi.mocked(computeAllPadProgress).mockReturnValue({});
    vi.mocked(computeAllLayerProgress).mockReturnValue({});
    vi.mocked(getLayerPlayOrder).mockReturnValue(undefined);
    vi.mocked(getLayerChain).mockReturnValue(undefined);
    vi.mocked(isAnyGainChanging).mockReturnValue(true);
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
      layerPlayOrder: { "layer-1": ["s1", "s2"] },
      layerChain: { "layer-1": ["s2"] },
    });

    stopAudioTick();

    const state = usePlaybackStore.getState();
    expect(state.padVolumes).toEqual({});
    expect(state.layerVolumes).toEqual({});
    expect(state.padProgress).toEqual({});
    expect(state.activeLayerIds.size).toBe(0);
    expect(state.layerPlayOrder).toEqual({});
    expect(state.layerChain).toEqual({});
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

  it("clones nextActiveLayerIds into prevActiveLayerIds so consumer mutation cannot corrupt the next diff", () => {
    // Regression guard for: prevActiveLayerIds = new Set(nextActiveLayerIds)
    // The store receives nextActiveLayerIds; prevActiveLayerIds must be an independent
    // copy. We verify via _getPrevActiveLayerIds that mutating the store Set does NOT
    // mutate prevActiveLayerIds.
    vi.mocked(getActivePadCount).mockReturnValue(1);
    vi.mocked(computeAllPadProgress).mockReturnValue({});
    vi.mocked(computeAllLayerProgress).mockReturnValue({});

    const firstIds = new Set(["layer-a"]);
    vi.mocked(getActiveLayerIdSet).mockReturnValue(firstIds);
    vi.mocked(getLayerVoiceVersion).mockReturnValue(1);

    let capturedCallback: FrameRequestCallback | null = null;
    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      capturedCallback = cb;
      return 1 as unknown as ReturnType<typeof requestAnimationFrame>;
    });

    startAudioTick();
    capturedCallback!(performance.now()); // tick 1: version 1 vs prev -1 → changed

    // Store receives nextActiveLayerIds (which is firstIds). prevActiveLayerIds must be
    // a clone — a different object with the same contents.
    const storedSet = usePlaybackStore.getState().activeLayerIds;
    expect(storedSet).not.toBe(_getPrevActiveLayerIds()); // must be different objects
    expect(_getPrevActiveLayerIds().has("layer-a")).toBe(true);

    // Mutate the store reference — prevActiveLayerIds must be unaffected.
    storedSet.add("layer-mutated");
    expect(_getPrevActiveLayerIds().has("layer-mutated")).toBe(false);
    expect(_getPrevActiveLayerIds().has("layer-a")).toBe(true);

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

  it("skips forEachActivePadGain and forEachActiveLayerGain when isAnyGainChanging returns false", () => {
    vi.mocked(getActivePadCount).mockReturnValue(1);
    vi.mocked(computeAllPadProgress).mockReturnValue({ "pad-1": 0.5 });
    vi.mocked(computeAllLayerProgress).mockReturnValue({});
    vi.mocked(isAnyGainChanging).mockReturnValue(false);

    let capturedCallback: FrameRequestCallback | null = null;
    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      capturedCallback = cb;
      return 1 as unknown as ReturnType<typeof requestAnimationFrame>;
    });

    startAudioTick();
    capturedCallback!(performance.now());

    expect(forEachActivePadGain).not.toHaveBeenCalled();
    expect(forEachActiveLayerGain).not.toHaveBeenCalled();

    rafSpy.mockRestore();
  });

  it("calls forEachActivePadGain and forEachActiveLayerGain when isAnyGainChanging returns true", () => {
    vi.mocked(getActivePadCount).mockReturnValue(1);
    vi.mocked(computeAllPadProgress).mockReturnValue({ "pad-1": 0.5 });
    vi.mocked(computeAllLayerProgress).mockReturnValue({});
    vi.mocked(isAnyGainChanging).mockReturnValue(true);

    let capturedCallback: FrameRequestCallback | null = null;
    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      capturedCallback = cb;
      return 1 as unknown as ReturnType<typeof requestAnimationFrame>;
    });

    startAudioTick();
    capturedCallback!(performance.now());

    expect(forEachActivePadGain).toHaveBeenCalled();
    expect(forEachActiveLayerGain).toHaveBeenCalled();

    rafSpy.mockRestore();
  });

  it("preserves previous padVolumes and layerVolumes in the store when isAnyGainChanging returns false", () => {
    vi.mocked(getActivePadCount).mockReturnValue(1);
    vi.mocked(computeAllPadProgress).mockReturnValue({});
    vi.mocked(computeAllLayerProgress).mockReturnValue({});

    // Tick 1: isAnyGainChanging = true — populate volumes
    vi.mocked(isAnyGainChanging).mockReturnValue(true);
    vi.mocked(forEachActivePadGain).mockImplementation((fn) => {
      fn("pad-1", { gain: { value: 0.5 } } as unknown as GainNode);
    });
    vi.mocked(forEachActiveLayerGain).mockImplementation((fn) => {
      fn("layer-1", { gain: { value: 0.7 } } as unknown as GainNode);
    });

    let capturedCallback: FrameRequestCallback | null = null;
    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      capturedCallback = cb;
      return 1 as unknown as ReturnType<typeof requestAnimationFrame>;
    });

    startAudioTick();
    capturedCallback!(performance.now()); // tick 1: populates padVolumes/layerVolumes

    expect(usePlaybackStore.getState().padVolumes["pad-1"]).toBe(0.5);
    expect(usePlaybackStore.getState().layerVolumes["layer-1"]).toBe(0.7);

    // Tick 2: isAnyGainChanging = false — should retain the values from tick 1
    vi.mocked(isAnyGainChanging).mockReturnValue(false);
    vi.mocked(forEachActivePadGain).mockClear();
    vi.mocked(forEachActiveLayerGain).mockClear();

    capturedCallback!(performance.now()); // tick 2: short-circuit

    expect(usePlaybackStore.getState().padVolumes["pad-1"]).toBe(0.5);
    expect(usePlaybackStore.getState().layerVolumes["layer-1"]).toBe(0.7);

    rafSpy.mockRestore();
  });

  describe("layerPlayOrder / layerChain", () => {
    function mkSound(id: string) {
      return { id, name: id, filePath: `${id}.wav`, tags: [], sets: [] } as unknown as import("@/lib/schemas").Sound;
    }

    it("computes layerPlayOrder and layerChain as sound ID arrays for active layers", () => {
      vi.mocked(getActivePadCount).mockReturnValue(1);
      vi.mocked(getLayerVoiceVersion).mockReturnValue(1);
      vi.mocked(getActiveLayerIdSet).mockReturnValue(new Set(["layer-1"]));
      vi.mocked(getLayerPlayOrder).mockImplementation((layerId) =>
        layerId === "layer-1" ? [mkSound("s1"), mkSound("s2"), mkSound("s3")] : undefined,
      );
      vi.mocked(getLayerChain).mockImplementation((layerId) =>
        layerId === "layer-1" ? [mkSound("s2"), mkSound("s3")] : undefined,
      );

      let capturedCallback: FrameRequestCallback | null = null;
      const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
        capturedCallback = cb;
        return 1 as unknown as ReturnType<typeof requestAnimationFrame>;
      });

      startAudioTick();
      capturedCallback!(performance.now());

      const state = usePlaybackStore.getState();
      expect(state.layerPlayOrder["layer-1"]).toEqual(["s1", "s2", "s3"]);
      expect(state.layerChain["layer-1"]).toEqual(["s2", "s3"]);

      rafSpy.mockRestore();
    });

    it("does not include layers that are not active", () => {
      vi.mocked(getActivePadCount).mockReturnValue(1);
      vi.mocked(getLayerVoiceVersion).mockReturnValue(1);
      vi.mocked(getActiveLayerIdSet).mockReturnValue(new Set(["layer-1"]));
      // Even though audioState has data for layer-2, it's not in the active set → excluded
      vi.mocked(getLayerPlayOrder).mockImplementation((layerId) =>
        layerId === "layer-1" ? [mkSound("s1")] : [mkSound("stale")],
      );
      vi.mocked(getLayerChain).mockReturnValue(undefined);

      let capturedCallback: FrameRequestCallback | null = null;
      const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
        capturedCallback = cb;
        return 1 as unknown as ReturnType<typeof requestAnimationFrame>;
      });

      startAudioTick();
      capturedCallback!(performance.now());

      const state = usePlaybackStore.getState();
      expect(state.layerPlayOrder["layer-1"]).toEqual(["s1"]);
      expect(state.layerPlayOrder["layer-2"]).toBeUndefined();

      rafSpy.mockRestore();
    });

    it("updates store when layerChain changes between ticks", () => {
      vi.mocked(getActivePadCount).mockReturnValue(1);
      vi.mocked(getLayerVoiceVersion).mockReturnValue(1);
      vi.mocked(getActiveLayerIdSet).mockReturnValue(new Set(["layer-1"]));
      vi.mocked(getLayerPlayOrder).mockReturnValue([
        mkSound("s1"),
        mkSound("s2"),
        mkSound("s3"),
      ]);
      // Tick 1: chain has 2 remaining ([s2, s3]) — s1 is currently playing
      vi.mocked(getLayerChain).mockReturnValue([mkSound("s2"), mkSound("s3")]);

      let capturedCallback: FrameRequestCallback | null = null;
      const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
        capturedCallback = cb;
        return 1 as unknown as ReturnType<typeof requestAnimationFrame>;
      });

      startAudioTick();
      capturedCallback!(performance.now());
      expect(usePlaybackStore.getState().layerChain["layer-1"]).toEqual(["s2", "s3"]);

      // Tick 2: chain advances to [s3] — s2 is now playing
      vi.mocked(getLayerChain).mockReturnValue([mkSound("s3")]);
      capturedCallback!(performance.now());
      expect(usePlaybackStore.getState().layerChain["layer-1"]).toEqual(["s3"]);

      rafSpy.mockRestore();
    });

    it("does not re-emit setAudioTick when layerPlayOrder and layerChain are unchanged", () => {
      vi.mocked(getActivePadCount).mockReturnValue(1);
      vi.mocked(getLayerVoiceVersion).mockReturnValue(1);
      vi.mocked(getActiveLayerIdSet).mockReturnValue(new Set(["layer-1"]));
      vi.mocked(getLayerPlayOrder).mockReturnValue([mkSound("s1"), mkSound("s2")]);
      vi.mocked(getLayerChain).mockReturnValue([mkSound("s2")]);

      let capturedCallback: FrameRequestCallback | null = null;
      const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
        capturedCallback = cb;
        return 1 as unknown as ReturnType<typeof requestAnimationFrame>;
      });

      startAudioTick();
      capturedCallback!(performance.now()); // first tick populates

      // Now freeze everything: layerVoiceVersion unchanged so activeLayerIds skipped;
      // play order and chain identical → audioTick should NOT call setAudioTick.
      const setAudioTickSpy = vi.spyOn(usePlaybackStore.getState(), "setAudioTick");
      capturedCallback!(performance.now());
      expect(setAudioTickSpy).not.toHaveBeenCalled();

      setAudioTickSpy.mockRestore();
      rafSpy.mockRestore();
    });

    it("includes layerPlayOrder but omits layerChain when chain is undefined (end of chain)", () => {
      vi.mocked(getActivePadCount).mockReturnValue(1);
      vi.mocked(getLayerVoiceVersion).mockReturnValue(1);
      vi.mocked(getActiveLayerIdSet).mockReturnValue(new Set(["layer-1"]));
      vi.mocked(getLayerPlayOrder).mockReturnValue([mkSound("s1"), mkSound("s2")]);
      vi.mocked(getLayerChain).mockReturnValue(undefined);

      let capturedCallback: FrameRequestCallback | null = null;
      const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
        capturedCallback = cb;
        return 1 as unknown as ReturnType<typeof requestAnimationFrame>;
      });

      startAudioTick();
      capturedCallback!(performance.now());

      const state = usePlaybackStore.getState();
      expect(state.layerPlayOrder["layer-1"]).toEqual(["s1", "s2"]);
      expect(state.layerChain["layer-1"]).toBeUndefined();

      rafSpy.mockRestore();
    });

    it("tracks multiple active layers independently in layerPlayOrder", () => {
      vi.mocked(getActivePadCount).mockReturnValue(1);
      vi.mocked(getLayerVoiceVersion).mockReturnValue(1);
      vi.mocked(getActiveLayerIdSet).mockReturnValue(new Set(["layer-1", "layer-2"]));
      vi.mocked(getLayerPlayOrder).mockImplementation((layerId) => {
        if (layerId === "layer-1") return [mkSound("a1"), mkSound("a2")];
        if (layerId === "layer-2") return [mkSound("b1"), mkSound("b2"), mkSound("b3")];
        return undefined;
      });
      vi.mocked(getLayerChain).mockReturnValue(undefined);

      let capturedCallback: FrameRequestCallback | null = null;
      const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
        capturedCallback = cb;
        return 1 as unknown as ReturnType<typeof requestAnimationFrame>;
      });

      startAudioTick();
      capturedCallback!(performance.now());

      const state = usePlaybackStore.getState();
      expect(state.layerPlayOrder["layer-1"]).toEqual(["a1", "a2"]);
      expect(state.layerPlayOrder["layer-2"]).toEqual(["b1", "b2", "b3"]);

      rafSpy.mockRestore();
    });

    it("omits active layers whose play order is undefined (e.g., simultaneous arrangement)", () => {
      vi.mocked(getActivePadCount).mockReturnValue(1);
      vi.mocked(getLayerVoiceVersion).mockReturnValue(1);
      vi.mocked(getActiveLayerIdSet).mockReturnValue(new Set(["layer-1"]));
      vi.mocked(getLayerPlayOrder).mockReturnValue(undefined);
      vi.mocked(getLayerChain).mockReturnValue(undefined);

      let capturedCallback: FrameRequestCallback | null = null;
      const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
        capturedCallback = cb;
        return 1 as unknown as ReturnType<typeof requestAnimationFrame>;
      });

      startAudioTick();
      capturedCallback!(performance.now());

      const state = usePlaybackStore.getState();
      expect(state.layerPlayOrder["layer-1"]).toBeUndefined();

      rafSpy.mockRestore();
    });

    it("preserves array reference for a layer whose play order is unchanged when another layer's chain advances", () => {
      vi.mocked(getActivePadCount).mockReturnValue(1);
      vi.mocked(getLayerVoiceVersion).mockReturnValue(1);
      vi.mocked(getActiveLayerIdSet).mockReturnValue(new Set(["layer-1", "layer-2"]));
      // layer-1 has a stable play order across both ticks.
      // layer-2 has a chain that advances between ticks.
      vi.mocked(getLayerPlayOrder).mockImplementation((layerId) => {
        if (layerId === "layer-1") return [mkSound("a1"), mkSound("a2")];
        if (layerId === "layer-2") return [mkSound("b1"), mkSound("b2")];
        return undefined;
      });
      vi.mocked(getLayerChain).mockImplementation((layerId) => {
        if (layerId === "layer-2") return [mkSound("b2")];
        return undefined;
      });

      let capturedCallback: FrameRequestCallback | null = null;
      const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
        capturedCallback = cb;
        return 1 as unknown as ReturnType<typeof requestAnimationFrame>;
      });

      startAudioTick();
      capturedCallback!(performance.now());
      const firstRef = usePlaybackStore.getState().layerPlayOrder["layer-1"];

      // Tick 2: layer-2's chain advances to [] (empty → undefined)
      vi.mocked(getLayerChain).mockImplementation(() => undefined);
      capturedCallback!(performance.now());
      const secondRef = usePlaybackStore.getState().layerPlayOrder["layer-1"];

      // layer-1's play order array reference must be preserved — selectors
      // like (s) => s.layerPlayOrder["layer-1"] should see the same reference.
      expect(secondRef).toBe(firstRef);

      rafSpy.mockRestore();
    });

    it("removes stale layer entries when a layer is no longer active", () => {
      vi.mocked(getActivePadCount).mockReturnValue(1);
      vi.mocked(getLayerPlayOrder).mockImplementation((layerId) =>
        layerId === "layer-1" ? [mkSound("s1")] : layerId === "layer-2" ? [mkSound("s2")] : undefined,
      );
      vi.mocked(getLayerChain).mockReturnValue(undefined);

      let capturedCallback: FrameRequestCallback | null = null;
      const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
        capturedCallback = cb;
        return 1 as unknown as ReturnType<typeof requestAnimationFrame>;
      });

      // Tick 1: both layers active
      vi.mocked(getLayerVoiceVersion).mockReturnValue(1);
      vi.mocked(getActiveLayerIdSet).mockReturnValue(new Set(["layer-1", "layer-2"]));
      startAudioTick();
      capturedCallback!(performance.now());
      expect(usePlaybackStore.getState().layerPlayOrder["layer-1"]).toBeDefined();
      expect(usePlaybackStore.getState().layerPlayOrder["layer-2"]).toBeDefined();

      // Tick 2: only layer-1 active — layer-2's stale entry should drop out
      vi.mocked(getLayerVoiceVersion).mockReturnValue(2);
      vi.mocked(getActiveLayerIdSet).mockReturnValue(new Set(["layer-1"]));
      capturedCallback!(performance.now());
      expect(usePlaybackStore.getState().layerPlayOrder["layer-1"]).toBeDefined();
      expect(usePlaybackStore.getState().layerPlayOrder["layer-2"]).toBeUndefined();

      rafSpy.mockRestore();
    });
  });

  describe("masterVolume sync", () => {
    beforeEach(() => {
      // Ensure store is at default and clear any calls accumulated during beforeEach resets
      usePlaybackStore.getState().setMasterVolume(100);
      vi.mocked(applyMasterVolume).mockClear();
    });

    it("module-level subscription calls applyMasterVolume when masterVolume changes", () => {
      usePlaybackStore.getState().setMasterVolume(50);
      expect(applyMasterVolume).toHaveBeenCalledWith(50);
      expect(applyMasterVolume).toHaveBeenCalledTimes(1);
    });

    it("subscription does not call applyMasterVolume for unrelated store field changes", () => {
      usePlaybackStore.getState().addPlayingPad("pad-x");
      usePlaybackStore.getState().setAudioTick({ padVolumes: { "pad-x": 0.3 } });
      expect(applyMasterVolume).not.toHaveBeenCalled();
    });

    it("_stopMasterVolumeSync is a function that can be used to detach the subscription", () => {
      expect(typeof _stopMasterVolumeSync).toBe("function");
    });
  });
});
