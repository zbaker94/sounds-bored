import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
// _stopLayerVoiceSetListener is intentionally NOT imported — it would unsubscribe
// the module-scope listener and break _notifyLayerVoiceSetChangedForTest for the
// rest of the suite. _stopMasterVolumeSync is exposed here only as a smoke check
// that the module-level subscription handle is exported as a function.
import { startAudioTick, stopAudioTick, _getPrevActiveLayerIds, _getGainSampleNeeded, _stopMasterVolumeSync } from "./audioTick";
import { usePlaybackStore, initialPlaybackState } from "@/state/playbackStore";
import { usePadMetricsStore, initialPadMetricsState } from "@/state/padMetricsStore";
import { useLayerMetricsStore, initialLayerMetricsState } from "@/state/layerMetricsStore";
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
    computeAllPadProgress: vi.fn().mockReturnValue({}),
    computeAllLayerProgress: vi.fn().mockReturnValue({}),
    isAnyGainChanging: vi.fn().mockReturnValue(true),
  };
});

// Listener slot captured by the voiceRegistry mock — used by
// _notifyLayerVoiceSetChangedForTest to fire the audioTick subscription.
// vi.hoisted runs before vi.mock factories so the holder object is defined
// when the voiceRegistry mock factory executes.
const { _voiceListenerHolder } = vi.hoisted(() => ({
  _voiceListenerHolder: { current: null as (() => void) | null },
}));

vi.mock("./voiceRegistry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./voiceRegistry")>();
  return {
    ...actual,
    getActivePadCount: vi.fn().mockReturnValue(0),
    getActivePadIds: vi.fn().mockReturnValue(new Set()),
    getActiveLayerIdSet: vi.fn().mockReturnValue(new Set()),
    // audioTick registers its listener at module load (audioTick.ts line ~106).
    // The mock captures that registration so tests can fire it via _notifyVoiceSetChanged().
    onLayerVoiceSetChanged: vi.fn((listener: () => void) => {
      _voiceListenerHolder.current = listener;
      return () => { _voiceListenerHolder.current = null; };
    }),
  };
});

vi.mock("./gainRegistry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./gainRegistry")>();
  return {
    ...actual,
    forEachActivePadGain: vi.fn(),
    forEachActiveLayerGain: vi.fn(),
  };
});

vi.mock("./chainCycleState", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./chainCycleState")>();
  return {
    ...actual,
    getLayerPlayOrder: vi.fn().mockReturnValue(undefined),
    getLayerChain: vi.fn().mockReturnValue(undefined),
  };
});

import {
  computeAllPadProgress,
  computeAllLayerProgress,
  isAnyGainChanging,
} from "./audioState";
import {
  getActivePadCount,
  getActiveLayerIdSet,
} from "./voiceRegistry";
import {
  forEachActivePadGain,
  forEachActiveLayerGain,
} from "./gainRegistry";
import {
  getLayerPlayOrder,
  getLayerChain,
} from "./chainCycleState";

/** Test helper — fires the layer-voice-set-changed listener captured by the
 *  voiceRegistry mock. Replaces the deleted `_notifyLayerVoiceSetChangedForTest`. */
function _notifyLayerVoiceSetChangedForTest(): void {
  _voiceListenerHolder.current?.();
}

describe("audioTick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlaybackStore.setState({ ...initialPlaybackState });
    usePadMetricsStore.setState({ ...initialPadMetricsState });
    useLayerMetricsStore.setState({ ...initialLayerMetricsState });
    // NOTE: _voiceListenerHolder.current is intentionally NOT reset between tests.
    // audioTick.ts registers its layer-voice-set listener at module scope (line ~106)
    // via onLayerVoiceSetChanged(...). Module-scope code only runs once across the
    // test file, so clearing the holder here would orphan the listener for every
    // subsequent test and break _notifyLayerVoiceSetChangedForTest. vi.clearAllMocks()
    // resets mock call history without invalidating the captured reference.
    vi.mocked(getActivePadCount).mockReturnValue(0);
    vi.mocked(forEachActivePadGain).mockImplementation(() => {});
    vi.mocked(forEachActiveLayerGain).mockImplementation(() => {});
    vi.mocked(getActiveLayerIdSet).mockReturnValue(new Set());
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
    usePadMetricsStore.getState().setPadMetrics({
      padVolumes: { "pad-1": 0.5 },
      padProgress: { "pad-1": 0.3 },
    });
    useLayerMetricsStore.getState().setLayerMetrics({
      layerVolumes: { "layer-1": 0.7 },
      activeLayerIds: new Set(["layer-1"]),
      layerPlayOrder: { "layer-1": ["s1", "s2"] },
      layerChain: { "layer-1": ["s2"] },
    });

    stopAudioTick();

    expect(usePadMetricsStore.getState().padVolumes).toEqual({});
    expect(usePadMetricsStore.getState().padProgress).toEqual({});
    expect(useLayerMetricsStore.getState().layerVolumes).toEqual({});
    expect(useLayerMetricsStore.getState().activeLayerIds.size).toBe(0);
    expect(useLayerMetricsStore.getState().layerPlayOrder).toEqual({});
    expect(useLayerMetricsStore.getState().layerChain).toEqual({});
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
    // Seed the metric stores with some values
    usePadMetricsStore.getState().setPadMetrics({
      padVolumes: { "pad-1": 0.5 },
      padProgress: { "pad-1": 0.3 },
    });
    useLayerMetricsStore.getState().setLayerMetrics({
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

    // padMetrics are preserved — pad GainNode persists through chain gaps; only cleared by stopAudioTick
    expect(usePadMetricsStore.getState().padVolumes).toEqual({ "pad-1": 0.5 });
    expect(usePadMetricsStore.getState().padProgress).toEqual({ "pad-1": 0.3 });
    // Layer metrics are cleared — no active voices remain
    expect(useLayerMetricsStore.getState().activeLayerIds.size).toBe(0);

    // No further RAF should have been scheduled (tick exited)
    expect(rafSpy).toHaveBeenCalledTimes(1); // only the initial startAudioTick call

    rafSpy.mockRestore();
  });

  it("does not call getActiveLayerIdSet when no layerVoiceMap mutation occurred", () => {
    vi.mocked(getActivePadCount).mockReturnValue(1);
    vi.mocked(computeAllPadProgress).mockReturnValue({ "pad-1": 0.1 });
    vi.mocked(computeAllLayerProgress).mockReturnValue({});

    let capturedCallback: FrameRequestCallback | null = null;
    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      capturedCallback = cb;
      return 1 as unknown as ReturnType<typeof requestAnimationFrame>;
    });

    startAudioTick();
    capturedCallback!(performance.now()); // first tick — layerVoiceSetChanged=true (from resetTrackers) → changed
    vi.mocked(getActiveLayerIdSet).mockClear();

    capturedCallback!(performance.now()); // second tick — no mutation fired → should skip
    expect(getActiveLayerIdSet).not.toHaveBeenCalled();

    rafSpy.mockRestore();
  });

  it("calls getActiveLayerIdSet and updates store when a layerVoiceMap mutation fires", () => {
    vi.mocked(getActivePadCount).mockReturnValue(1);
    vi.mocked(computeAllPadProgress).mockReturnValue({ "pad-1": 0.1 });
    vi.mocked(computeAllLayerProgress).mockReturnValue({});

    const newActiveIds = new Set(["layer-1"]);
    vi.mocked(getActiveLayerIdSet).mockReturnValue(newActiveIds);

    let capturedCallback: FrameRequestCallback | null = null;
    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      capturedCallback = cb;
      return 1 as unknown as ReturnType<typeof requestAnimationFrame>;
    });

    startAudioTick();
    capturedCallback!(performance.now()); // first tick — layerVoiceSetChanged=true (from resetTrackers) → changed

    // Simulate a voice being added: fire the notification listener
    _notifyLayerVoiceSetChangedForTest();
    capturedCallback!(performance.now()); // second tick — mutation fired → must call getActiveLayerIdSet

    expect(getActiveLayerIdSet).toHaveBeenCalled();
    expect(useLayerMetricsStore.getState().activeLayerIds).toEqual(newActiveIds);

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

    let capturedCallback: FrameRequestCallback | null = null;
    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      capturedCallback = cb;
      return 1 as unknown as ReturnType<typeof requestAnimationFrame>;
    });

    startAudioTick();
    capturedCallback!(performance.now()); // tick 1: layerVoiceSetChanged=true (from resetTrackers) → changed

    // Store receives nextActiveLayerIds. prevActiveLayerIds must be a clone — a
    // different object with the same contents.
    const storedSet = useLayerMetricsStore.getState().activeLayerIds;
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
    vi.mocked(forEachActivePadGain).mockImplementation((_ids, fn) => {
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

    const padState = usePadMetricsStore.getState();
    expect(padState.padVolumes["pad-1"]).toBe(0.5);
    expect(padState.padVolumes["pad-2"]).toBeUndefined(); // full volume excluded

    rafSpy.mockRestore();
  });

  it("skips forEachActivePadGain and forEachActiveLayerGain when isAnyGainChanging returns false and gainSampleNeeded is false", () => {
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
    // Tick 1: gainSampleNeeded=true (from resetTrackers in stopAudioTick afterEach) — samples even though
    // isAnyGainChanging is false. This clears gainSampleNeeded.
    capturedCallback!(performance.now());
    vi.mocked(forEachActivePadGain).mockClear();
    vi.mocked(forEachActiveLayerGain).mockClear();

    // Tick 2: gainSampleNeeded=false and isAnyGainChanging=false — must skip sampling
    capturedCallback!(performance.now());

    expect(forEachActivePadGain).not.toHaveBeenCalled();
    expect(forEachActiveLayerGain).not.toHaveBeenCalled();

    rafSpy.mockRestore();
  });

  it("samples gain nodes on first tick after self-terminate/restart even when isAnyGainChanging is false", () => {
    vi.mocked(getActivePadCount).mockReturnValue(1);
    vi.mocked(computeAllPadProgress).mockReturnValue({});
    vi.mocked(computeAllLayerProgress).mockReturnValue({});
    vi.mocked(isAnyGainChanging).mockReturnValue(false);
    vi.mocked(forEachActivePadGain).mockImplementation((_ids, fn) => {
      fn("pad-1", { gain: { value: 0.74 } } as unknown as GainNode);
    });
    vi.mocked(forEachActiveLayerGain).mockImplementation(() => {});

    let capturedCallback: FrameRequestCallback | null = null;
    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      capturedCallback = cb;
      return 1 as unknown as ReturnType<typeof requestAnimationFrame>;
    });

    startAudioTick();
    // gainSampleNeeded=true from stopAudioTick in afterEach (calls resetTrackers)
    expect(_getGainSampleNeeded()).toBe(true);

    capturedCallback!(performance.now());

    // Even though isAnyGainChanging()=false, the first tick must sample and emit padVolumes
    expect(forEachActivePadGain).toHaveBeenCalled();
    expect(usePadMetricsStore.getState().padVolumes["pad-1"]).toBe(0.74);
    // gainSampleNeeded is now cleared — subsequent ticks will fast-path
    expect(_getGainSampleNeeded()).toBe(false);

    rafSpy.mockRestore();
  });

  it("clears stale padVolumes when startAudioTick is called while tick already running", () => {
    vi.mocked(getActivePadCount).mockReturnValue(1);
    vi.mocked(computeAllPadProgress).mockReturnValue({});
    vi.mocked(computeAllLayerProgress).mockReturnValue({});
    vi.mocked(isAnyGainChanging).mockReturnValue(false);

    // First: simulate pad playing at 70%
    vi.mocked(forEachActivePadGain).mockImplementation((_ids, fn) => {
      fn("pad-1", { gain: { value: 0.7 } } as unknown as GainNode);
    });
    vi.mocked(forEachActiveLayerGain).mockImplementation(() => {});

    let capturedCallback: FrameRequestCallback | null = null;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      capturedCallback = cb;
      return 1 as unknown as ReturnType<typeof requestAnimationFrame>;
    });

    startAudioTick();
    capturedCallback!(performance.now()); // tick 1: gainSampleNeeded=true, samples 0.7
    expect(usePadMetricsStore.getState().padVolumes["pad-1"]).toBe(0.7);
    capturedCallback!(performance.now()); // tick 2: fast-path, prevPadVolumes reused
    expect(_getGainSampleNeeded()).toBe(false);

    // Pad stops and is immediately retriggered at 100% while tick still running
    vi.mocked(forEachActivePadGain).mockImplementation((_ids, fn) => {
      fn("pad-1", { gain: { value: 1.0 } } as unknown as GainNode);
    });
    // startAudioTick() must mark gainSampleNeeded so stale 0.7 entry gets cleared
    startAudioTick();
    expect(_getGainSampleNeeded()).toBe(true);

    capturedCallback!(performance.now()); // tick 3: re-samples, gain=1.0 not stored -> clears pad-1
    expect(usePadMetricsStore.getState().padVolumes["pad-1"]).toBeUndefined();
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
    vi.mocked(forEachActivePadGain).mockImplementation((_ids, fn) => {
      fn("pad-1", { gain: { value: 0.5 } } as unknown as GainNode);
    });
    vi.mocked(forEachActiveLayerGain).mockImplementation((_ids, fn) => {
      fn("layer-1", { gain: { value: 0.7 } } as unknown as GainNode);
    });

    let capturedCallback: FrameRequestCallback | null = null;
    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      capturedCallback = cb;
      return 1 as unknown as ReturnType<typeof requestAnimationFrame>;
    });

    startAudioTick();
    capturedCallback!(performance.now()); // tick 1: populates padVolumes/layerVolumes

    expect(usePadMetricsStore.getState().padVolumes["pad-1"]).toBe(0.5);
    expect(useLayerMetricsStore.getState().layerVolumes["layer-1"]).toBe(0.7);

    // Tick 2: isAnyGainChanging = false — should retain the values from tick 1
    vi.mocked(isAnyGainChanging).mockReturnValue(false);
    vi.mocked(forEachActivePadGain).mockClear();
    vi.mocked(forEachActiveLayerGain).mockClear();

    capturedCallback!(performance.now()); // tick 2: short-circuit

    expect(usePadMetricsStore.getState().padVolumes["pad-1"]).toBe(0.5);
    expect(useLayerMetricsStore.getState().layerVolumes["layer-1"]).toBe(0.7);

    rafSpy.mockRestore();
  });

  describe("padProgress / layerProgress no-op diffing", () => {
    it("does not call setPadMetrics when padProgress is unchanged between ticks", () => {
      vi.mocked(getActivePadCount).mockReturnValue(1);
      vi.mocked(computeAllPadProgress).mockReturnValue({ "pad-1": 0.5 });
      vi.mocked(computeAllLayerProgress).mockReturnValue({});

      let capturedCallback: FrameRequestCallback | null = null;
      const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
        capturedCallback = cb;
        return 1 as unknown as ReturnType<typeof requestAnimationFrame>;
      });

      startAudioTick();
      capturedCallback!(performance.now()); // tick 1: prevPadProgress={} → {pad-1:0.5} → changed

      const setPadMetricsSpy = vi.spyOn(usePadMetricsStore.getState(), "setPadMetrics");
      capturedCallback!(performance.now()); // tick 2: same value → progressEqual → no-op
      expect(setPadMetricsSpy).not.toHaveBeenCalled();

      setPadMetricsSpy.mockRestore();
      rafSpy.mockRestore();
    });

    it("calls setPadMetrics with updated padProgress when progress changes beyond PROGRESS_EPSILON", () => {
      vi.mocked(getActivePadCount).mockReturnValue(1);
      vi.mocked(computeAllPadProgress).mockReturnValue({ "pad-1": 0.5 });
      vi.mocked(computeAllLayerProgress).mockReturnValue({});

      let capturedCallback: FrameRequestCallback | null = null;
      const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
        capturedCallback = cb;
        return 1 as unknown as ReturnType<typeof requestAnimationFrame>;
      });

      startAudioTick();
      capturedCallback!(performance.now()); // tick 1: pad-1=0.5

      vi.mocked(computeAllPadProgress).mockReturnValue({ "pad-1": 0.6 }); // diff=0.1 > PROGRESS_EPSILON
      const setPadMetricsSpy = vi.spyOn(usePadMetricsStore.getState(), "setPadMetrics");
      capturedCallback!(performance.now()); // tick 2: changed → must emit
      expect(setPadMetricsSpy).toHaveBeenCalledWith(expect.objectContaining({
        padProgress: { "pad-1": 0.6 },
      }));

      setPadMetricsSpy.mockRestore();
      rafSpy.mockRestore();
    });

    it("does not call setLayerMetrics when layerProgress changes are within PROGRESS_EPSILON", () => {
      vi.mocked(getActivePadCount).mockReturnValue(1);
      vi.mocked(computeAllPadProgress).mockReturnValue({});
      vi.mocked(computeAllLayerProgress).mockReturnValue({ "layer-1": 0.5 });

      let capturedCallback: FrameRequestCallback | null = null;
      const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
        capturedCallback = cb;
        return 1 as unknown as ReturnType<typeof requestAnimationFrame>;
      });

      startAudioTick();
      capturedCallback!(performance.now()); // tick 1: layer-1=0.5

      // 0.5007 is within PROGRESS_EPSILON (0.001) of 0.5 — should be suppressed
      vi.mocked(computeAllLayerProgress).mockReturnValue({ "layer-1": 0.5007 });
      const setLayerMetricsSpy = vi.spyOn(useLayerMetricsStore.getState(), "setLayerMetrics");
      capturedCallback!(performance.now()); // tick 2: within epsilon → no-op
      expect(setLayerMetricsSpy).not.toHaveBeenCalled();

      setLayerMetricsSpy.mockRestore();
      rafSpy.mockRestore();
    });
  });

  describe("layerPlayOrder / layerChain", () => {
    function mkSound(id: string) {
      return { id, name: id, filePath: `${id}.wav`, tags: [], sets: [] } as unknown as import("@/lib/schemas").Sound;
    }

    it("computes layerPlayOrder and layerChain as sound ID arrays for active layers", () => {
      vi.mocked(getActivePadCount).mockReturnValue(1);
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

      const layerState = useLayerMetricsStore.getState();
      expect(layerState.layerPlayOrder["layer-1"]).toEqual(["s1", "s2", "s3"]);
      expect(layerState.layerChain["layer-1"]).toEqual(["s2", "s3"]);

      rafSpy.mockRestore();
    });

    it("does not include layers that are not active", () => {
      vi.mocked(getActivePadCount).mockReturnValue(1);
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

      const layerState = useLayerMetricsStore.getState();
      expect(layerState.layerPlayOrder["layer-1"]).toEqual(["s1"]);
      expect(layerState.layerPlayOrder["layer-2"]).toBeUndefined();

      rafSpy.mockRestore();
    });

    it("updates store when layerChain changes between ticks", () => {
      vi.mocked(getActivePadCount).mockReturnValue(1);
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
      expect(useLayerMetricsStore.getState().layerChain["layer-1"]).toEqual(["s2", "s3"]);

      // Tick 2: chain advances to [s3] — s2 is now playing
      vi.mocked(getLayerChain).mockReturnValue([mkSound("s3")]);
      capturedCallback!(performance.now());
      expect(useLayerMetricsStore.getState().layerChain["layer-1"]).toEqual(["s3"]);

      rafSpy.mockRestore();
    });

    it("does not re-emit metric updates when layerPlayOrder and layerChain are unchanged", () => {
      vi.mocked(getActivePadCount).mockReturnValue(1);
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

      // Now freeze everything: no mutation fired so activeLayerIds skipped;
      // play order and chain identical → audioTick should NOT call setPadMetrics or setLayerMetrics.
      const setPadMetricsSpy = vi.spyOn(usePadMetricsStore.getState(), "setPadMetrics");
      const setLayerMetricsSpy = vi.spyOn(useLayerMetricsStore.getState(), "setLayerMetrics");
      capturedCallback!(performance.now());
      expect(setPadMetricsSpy).not.toHaveBeenCalled();
      expect(setLayerMetricsSpy).not.toHaveBeenCalled();

      setPadMetricsSpy.mockRestore();
      setLayerMetricsSpy.mockRestore();
      rafSpy.mockRestore();
    });

    it("includes layerPlayOrder but omits layerChain when chain is undefined (end of chain)", () => {
      vi.mocked(getActivePadCount).mockReturnValue(1);
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

      const layerState = useLayerMetricsStore.getState();
      expect(layerState.layerPlayOrder["layer-1"]).toEqual(["s1", "s2"]);
      expect(layerState.layerChain["layer-1"]).toBeUndefined();

      rafSpy.mockRestore();
    });

    it("tracks multiple active layers independently in layerPlayOrder", () => {
      vi.mocked(getActivePadCount).mockReturnValue(1);
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

      const layerState = useLayerMetricsStore.getState();
      expect(layerState.layerPlayOrder["layer-1"]).toEqual(["a1", "a2"]);
      expect(layerState.layerPlayOrder["layer-2"]).toEqual(["b1", "b2", "b3"]);

      rafSpy.mockRestore();
    });

    it("omits active layers whose play order is undefined (e.g., simultaneous arrangement)", () => {
      vi.mocked(getActivePadCount).mockReturnValue(1);
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

      const layerState = useLayerMetricsStore.getState();
      expect(layerState.layerPlayOrder["layer-1"]).toBeUndefined();

      rafSpy.mockRestore();
    });

    it("preserves array reference for a layer whose play order is unchanged when another layer's chain advances", () => {
      vi.mocked(getActivePadCount).mockReturnValue(1);
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
      const firstRef = useLayerMetricsStore.getState().layerPlayOrder["layer-1"];

      // Tick 2: layer-2's chain advances to [] (empty → undefined)
      vi.mocked(getLayerChain).mockImplementation(() => undefined);
      capturedCallback!(performance.now());
      const secondRef = useLayerMetricsStore.getState().layerPlayOrder["layer-1"];

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
      vi.mocked(getActiveLayerIdSet).mockReturnValue(new Set(["layer-1", "layer-2"]));
      startAudioTick();
      capturedCallback!(performance.now());
      expect(useLayerMetricsStore.getState().layerPlayOrder["layer-1"]).toBeDefined();
      expect(useLayerMetricsStore.getState().layerPlayOrder["layer-2"]).toBeDefined();

      // Tick 2: only layer-1 active — layer-2's stale entry should drop out
      _notifyLayerVoiceSetChangedForTest(); // simulate voice removal firing the subscription
      vi.mocked(getActiveLayerIdSet).mockReturnValue(new Set(["layer-1"]));
      capturedCallback!(performance.now());
      expect(useLayerMetricsStore.getState().layerPlayOrder["layer-1"]).toBeDefined();
      expect(useLayerMetricsStore.getState().layerPlayOrder["layer-2"]).toBeUndefined();

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
      usePadMetricsStore.getState().setPadMetrics({ padVolumes: { "pad-x": 0.3 } });
      expect(applyMasterVolume).not.toHaveBeenCalled();
    });

    it("_stopMasterVolumeSync is a function that can be used to detach the subscription", () => {
      expect(typeof _stopMasterVolumeSync).toBe("function");
    });
  });
});
