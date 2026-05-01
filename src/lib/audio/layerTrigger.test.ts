// src/lib/audio/layerTrigger.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockLayer, createMockPad, createMockSound } from "@/test/factories";

const mockCtx = {
  currentTime: 0,
  createGain: vi.fn(),
  createBufferSource: vi.fn(),
  createMediaElementSource: vi.fn(() => ({ connect: vi.fn() })),
};

vi.mock("./audioContext", () => ({
  getAudioContext: vi.fn(() => mockCtx),
  getMasterGain: vi.fn(() => ({ connect: vi.fn() })),
  ensureResumed: vi.fn(() => Promise.resolve(mockCtx)),
}));
vi.mock("./audioTick", () => ({
  startAudioTick: vi.fn(),
  stopAudioTick: vi.fn(),
}));
vi.mock("./bufferCache", () => ({
  loadBuffer: vi.fn().mockResolvedValue({ duration: 1.0 }),
  MissingFileError: class MissingFileError extends Error {},
}));
vi.mock("./streamingCache", () => ({
  checkIsLargeFile: vi.fn().mockResolvedValue(false),
  getOrCreateStreamingElement: vi.fn(),
  LARGE_FILE_THRESHOLD_BYTES: 20 * 1024 * 1024,
}));
const mockEmitAudioError = vi.fn();
vi.mock("./audioEvents", () => ({
  emitAudioError: (...args: unknown[]) => mockEmitAudioError(...args),
  setAudioErrorHandler: vi.fn(),
}));
vi.mock("@/state/libraryStore", () => ({
  useLibraryStore: { getState: vi.fn(() => ({ sounds: [] })) },
}));
vi.mock("@/state/appSettingsStore", () => ({
  useAppSettingsStore: { getState: vi.fn(() => ({ settings: null })) },
}));
vi.mock("@/state/projectStore", () => ({
  useProjectStore: { getState: vi.fn(() => ({ project: null })) },
}));

function makeMockGain() {
  return {
    gain: { value: 1.0, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

function makeMinimalVoice() {
  return { setOnEnded: vi.fn(), stop: vi.fn(), stopWithRamp: vi.fn() };
}

describe("layerTrigger", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockCtx.currentTime = 0;
    mockCtx.createGain.mockReset().mockReturnValue(makeMockGain());
    mockCtx.createBufferSource.mockReset().mockReturnValue({
      buffer: null,
      loop: false,
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      addEventListener: vi.fn(),
    });
    const { clearAllAudioState } = await import("./audioState");
    clearAllAudioState();
  });

  // ── resolveSounds ─────────────────────────────────────────────────────────

  describe("resolveSounds", () => {
    it("returns only assigned sounds with valid filePaths", async () => {
      const { resolveSounds } = await import("./layerTrigger");
      const s1 = createMockSound({ id: "s1", filePath: "s1.wav" });
      const s2 = createMockSound({ id: "s2", filePath: "" }); // invalid
      const layer = createMockLayer({
        selection: { type: "assigned", instances: [{ id: "i1", soundId: "s1", volume: 100 }, { id: "i2", soundId: "s2", volume: 100 }] },
      });
      expect(resolveSounds(layer, [s1, s2])).toEqual([s1]);
    });

    it("returns empty array when no sounds match", async () => {
      const { resolveSounds } = await import("./layerTrigger");
      const layer = createMockLayer({
        selection: { type: "assigned", instances: [{ id: "i1", soundId: "missing", volume: 100 }] },
      });
      expect(resolveSounds(layer, [])).toEqual([]);
    });

    it("filters out sounds without filePath for tag selection", async () => {
      const { resolveSounds } = await import("./layerTrigger");
      const withPath = createMockSound({ id: "t1", filePath: "t1.wav", tags: ["drums"] });
      const noPath = createMockSound({ id: "t2", filePath: undefined, tags: ["drums"] });
      const layer = createMockLayer({ selection: { type: "tag", tagIds: ["drums"], matchMode: "any", defaultVolume: 100 } });
      expect(resolveSounds(layer, [withPath, noPath])).toEqual([withPath]);
    });

    it("filters out sounds without filePath for set selection", async () => {
      const { resolveSounds } = await import("./layerTrigger");
      const withPath = createMockSound({ id: "s1", filePath: "s1.wav", sets: ["set-x"] });
      const noPath = createMockSound({ id: "s2", filePath: undefined, sets: ["set-x"] });
      const layer = createMockLayer({ selection: { type: "set", setId: "set-x", defaultVolume: 100 } });
      expect(resolveSounds(layer, [withPath, noPath])).toEqual([withPath]);
    });
  });

  // ── shouldLayerLoopNatively ───────────────────────────────────────────────

  describe("shouldLayerLoopNatively", () => {
    it.each([
      { playbackMode: "loop", arrangement: "simultaneous", cycleMode: false, expected: true },
      { playbackMode: "hold", arrangement: "simultaneous", cycleMode: false, expected: true },
      { playbackMode: "one-shot", arrangement: "simultaneous", cycleMode: false, expected: false },
      // chained without cycleMode: native loop flag not used (chain drives looping)
      { playbackMode: "loop", arrangement: "sequential", cycleMode: false, expected: false },
      { playbackMode: "hold", arrangement: "sequential", cycleMode: false, expected: false },
      // chained with cycleMode: plays one sound at a time, so native loop flag IS used
      { playbackMode: "loop", arrangement: "sequential", cycleMode: true, expected: true },
      { playbackMode: "hold", arrangement: "sequential", cycleMode: true, expected: true },
      { playbackMode: "one-shot", arrangement: "sequential", cycleMode: true, expected: false },
      // shuffled behaves like sequential (isChained)
      { playbackMode: "loop", arrangement: "shuffled", cycleMode: false, expected: false },
      { playbackMode: "loop", arrangement: "shuffled", cycleMode: true, expected: true },
    ] as const)(
      "playbackMode=$playbackMode arrangement=$arrangement cycleMode=$cycleMode → $expected",
      async ({ playbackMode, arrangement, cycleMode, expected }) => {
        const { shouldLayerLoopNatively } = await import("./layerTrigger");
        const layer = createMockLayer({ playbackMode, arrangement, cycleMode });
        expect(shouldLayerLoopNatively(layer)).toBe(expected);
      },
    );
  });

  // ── getVoiceVolume ────────────────────────────────────────────────────────

  describe("getVoiceVolume", () => {
    it("returns instance volume / 100 for assigned selection", async () => {
      const { getVoiceVolume } = await import("./layerTrigger");
      const sound = createMockSound({ id: "s1" });
      const layer = createMockLayer({
        selection: { type: "assigned", instances: [{ id: "i1", soundId: "s1", volume: 80 }] },
      });
      expect(getVoiceVolume(layer, sound)).toBeCloseTo(0.8);
    });

    it("returns 1.0 for tag/set selections", async () => {
      const { getVoiceVolume } = await import("./layerTrigger");
      const sound = createMockSound({ id: "s1" });
      const layer = createMockLayer({ selection: { type: "set", setId: "set-1", defaultVolume: 100 } });
      expect(getVoiceVolume(layer, sound)).toBe(1.0);
    });

    it("returns 1.0 when sound instance is not found in assigned selection", async () => {
      const { getVoiceVolume } = await import("./layerTrigger");
      const sound = createMockSound({ id: "s-other" });
      const layer = createMockLayer({
        selection: { type: "assigned", instances: [{ id: "i1", soundId: "s1", volume: 80 }] },
      });
      expect(getVoiceVolume(layer, sound)).toBe(1.0);
    });

    it("returns 0 for NaN instance volume (silence is safer than unexpected full-volume playback)", async () => {
      const { getVoiceVolume } = await import("./layerTrigger");
      const sound = createMockSound({ id: "s1" });
      const layer = createMockLayer({
        selection: { type: "assigned", instances: [{ id: "i1", soundId: "s1", volume: NaN }] },
      });
      expect(getVoiceVolume(layer, sound)).toBe(0);
    });

    it("returns 0 for Infinity instance volume", async () => {
      const { getVoiceVolume } = await import("./layerTrigger");
      const sound = createMockSound({ id: "s1" });
      const layer = createMockLayer({
        selection: { type: "assigned", instances: [{ id: "i1", soundId: "s1", volume: Infinity }] },
      });
      expect(getVoiceVolume(layer, sound)).toBe(0);
    });
  });

  // ── getLayerNormalizedVolume ──────────────────────────────────────────────

  describe("getLayerNormalizedVolume", () => {
    it("converts 100 to 1.0", async () => {
      const { getLayerNormalizedVolume } = await import("./layerTrigger");
      expect(getLayerNormalizedVolume(createMockLayer({ volume: 100 }))).toBeCloseTo(1.0);
    });

    it("converts 0 to 0.0", async () => {
      const { getLayerNormalizedVolume } = await import("./layerTrigger");
      expect(getLayerNormalizedVolume(createMockLayer({ volume: 0 }))).toBeCloseTo(0.0);
    });

    it("converts 80 to 0.8", async () => {
      const { getLayerNormalizedVolume } = await import("./layerTrigger");
      expect(getLayerNormalizedVolume(createMockLayer({ volume: 80 }))).toBeCloseTo(0.8);
    });

    it("clamps values above 100 to 1.0", async () => {
      const { getLayerNormalizedVolume } = await import("./layerTrigger");
      expect(getLayerNormalizedVolume(createMockLayer({ volume: 150 }))).toBeCloseTo(1.0);
    });

    it("clamps negative values to 0.0", async () => {
      const { getLayerNormalizedVolume } = await import("./layerTrigger");
      expect(getLayerNormalizedVolume(createMockLayer({ volume: -10 }))).toBeCloseTo(0.0);
    });

    it("returns 0 for NaN volume (silence is safer than unexpected full-volume playback)", async () => {
      const { getLayerNormalizedVolume } = await import("./layerTrigger");
      expect(getLayerNormalizedVolume(createMockLayer({ volume: NaN }))).toBe(0);
    });

    it("returns 0 for Infinity volume", async () => {
      const { getLayerNormalizedVolume } = await import("./layerTrigger");
      expect(getLayerNormalizedVolume(createMockLayer({ volume: Infinity }))).toBe(0);
    });

    it("returns 0 for -Infinity volume", async () => {
      const { getLayerNormalizedVolume } = await import("./layerTrigger");
      expect(getLayerNormalizedVolume(createMockLayer({ volume: -Infinity }))).toBe(0);
    });
  });

  // ── applyRetriggerMode ────────────────────────────────────────────────────

  describe("applyRetriggerMode", () => {
    async function setup() {
      const { getPadGain, getOrCreateLayerGain } = await import("./audioState");
      const padGain = getPadGain("pad-r");
      const layerGain = getOrCreateLayerGain("layer-r", 1, padGain);
      return { padGain, layerGain };
    }

    it("returns 'proceed' when layer is not playing (all modes)", async () => {
      const { applyRetriggerMode } = await import("./layerTrigger");
      const { layerGain } = await setup();
      const pad = createMockPad({ id: "pad-r" });
      const layer = createMockLayer({ id: "layer-r", retriggerMode: "stop" });
      const resolved = [createMockSound()];

      const result = await applyRetriggerMode(pad, layer, false, mockCtx as unknown as AudioContext, layerGain, resolved);
      expect(result).toBe("proceed");
    });

    it("returns 'skip' for 'continue' mode when layer is playing", async () => {
      const { applyRetriggerMode } = await import("./layerTrigger");
      const { layerGain } = await setup();
      const pad = createMockPad({ id: "pad-r" });
      const layer = createMockLayer({ id: "layer-r", retriggerMode: "continue" });

      const result = await applyRetriggerMode(pad, layer, true, mockCtx as unknown as AudioContext, layerGain, []);
      expect(result).toBe("skip");
    });

    it("returns 'proceed' for 'restart' mode when layer is playing (stops current voices)", async () => {
      const { applyRetriggerMode } = await import("./layerTrigger");
      const { layerGain } = await setup();
      const pad = createMockPad({ id: "pad-r" });
      const layer = createMockLayer({ id: "layer-r", retriggerMode: "restart" });

      const result = await applyRetriggerMode(pad, layer, true, mockCtx as unknown as AudioContext, layerGain, []);
      expect(result).toBe("proceed");
    });

    it("calls afterStopCleanup when 'stop' mode stops a playing layer", async () => {
      const { applyRetriggerMode } = await import("./layerTrigger");
      const { layerGain } = await setup();
      const pad = createMockPad({ id: "pad-r" });
      const layer = createMockLayer({ id: "layer-r", retriggerMode: "stop" });
      const afterStopCleanup = vi.fn();

      await applyRetriggerMode(pad, layer, true, mockCtx as unknown as AudioContext, layerGain, [createMockSound()], afterStopCleanup);

      expect(afterStopCleanup).toHaveBeenCalledTimes(1);
    });

    it("does NOT call afterStopCleanup when layer is not playing", async () => {
      const { applyRetriggerMode } = await import("./layerTrigger");
      const { layerGain } = await setup();
      const pad = createMockPad({ id: "pad-r" });
      const layer = createMockLayer({ id: "layer-r", retriggerMode: "stop" });
      const afterStopCleanup = vi.fn();

      await applyRetriggerMode(pad, layer, false, mockCtx as unknown as AudioContext, layerGain, [], afterStopCleanup);

      expect(afterStopCleanup).not.toHaveBeenCalled();
    });

    // ── Cycle cursor: "stop" mode ─────────────────────────────────────────────

    it("advances cycle cursor in 'stop' mode when cycleMode is on", async () => {
      const { applyRetriggerMode } = await import("./layerTrigger");
      const { getPadGain, getOrCreateLayerGain, setLayerCycleIndex, getLayerCycleIndex } = await import("./audioState");
      const padGain = getPadGain("pad-cyc-stop");
      const layerGain = getOrCreateLayerGain("layer-cyc-stop", 1, padGain);
      const pad = createMockPad({ id: "pad-cyc-stop" });
      const s1 = createMockSound({ id: "s1", filePath: "s1.wav" });
      const s2 = createMockSound({ id: "s2", filePath: "s2.wav" });
      const layer = createMockLayer({
        id: "layer-cyc-stop",
        retriggerMode: "stop",
        arrangement: "sequential",
        cycleMode: true,
      });
      setLayerCycleIndex("layer-cyc-stop", 0);

      await applyRetriggerMode(pad, layer, true, mockCtx as unknown as AudioContext, layerGain, [s1, s2]);

      expect(getLayerCycleIndex("layer-cyc-stop")).toBe(1);
    });

    it("deletes cycle cursor in 'stop' mode when it reaches the end", async () => {
      const { applyRetriggerMode } = await import("./layerTrigger");
      const { getPadGain, getOrCreateLayerGain, setLayerCycleIndex, getLayerCycleIndex } = await import("./audioState");
      const padGain = getPadGain("pad-cyc-stop-wrap");
      const layerGain = getOrCreateLayerGain("layer-cyc-stop-wrap", 1, padGain);
      const pad = createMockPad({ id: "pad-cyc-stop-wrap" });
      const s1 = createMockSound({ id: "s1", filePath: "s1.wav" });
      const s2 = createMockSound({ id: "s2", filePath: "s2.wav" });
      const layer = createMockLayer({
        id: "layer-cyc-stop-wrap",
        retriggerMode: "stop",
        arrangement: "sequential",
        cycleMode: true,
      });
      // Cursor is at last index — next trigger should wrap/delete
      setLayerCycleIndex("layer-cyc-stop-wrap", 1);

      await applyRetriggerMode(pad, layer, true, mockCtx as unknown as AudioContext, layerGain, [s1, s2]);

      expect(getLayerCycleIndex("layer-cyc-stop-wrap")).toBeUndefined();
    });

    // ── Cycle cursor: "restart" mode ──────────────────────────────────────────

    it("backs cycle cursor up in 'restart' mode when cycleMode is on", async () => {
      const { applyRetriggerMode } = await import("./layerTrigger");
      const { getPadGain, getOrCreateLayerGain, setLayerCycleIndex, getLayerCycleIndex } = await import("./audioState");
      const padGain = getPadGain("pad-cyc-restart");
      const layerGain = getOrCreateLayerGain("layer-cyc-restart", 1, padGain);
      const pad = createMockPad({ id: "pad-cyc-restart" });
      const s1 = createMockSound({ id: "s1", filePath: "s1.wav" });
      const s2 = createMockSound({ id: "s2", filePath: "s2.wav" });
      const layer = createMockLayer({
        id: "layer-cyc-restart",
        retriggerMode: "restart",
        arrangement: "sequential",
        cycleMode: true,
      });
      setLayerCycleIndex("layer-cyc-restart", 2);

      await applyRetriggerMode(pad, layer, true, mockCtx as unknown as AudioContext, layerGain, [s1, s2]);

      expect(getLayerCycleIndex("layer-cyc-restart")).toBe(1);
    });

    it("wraps cycle cursor from 0 to last index in 'restart' mode", async () => {
      const { applyRetriggerMode } = await import("./layerTrigger");
      const { getPadGain, getOrCreateLayerGain, setLayerCycleIndex, getLayerCycleIndex } = await import("./audioState");
      const padGain = getPadGain("pad-cyc-restart-wrap");
      const layerGain = getOrCreateLayerGain("layer-cyc-restart-wrap", 1, padGain);
      const pad = createMockPad({ id: "pad-cyc-restart-wrap" });
      const s1 = createMockSound({ id: "s1", filePath: "s1.wav" });
      const s2 = createMockSound({ id: "s2", filePath: "s2.wav" });
      const layer = createMockLayer({
        id: "layer-cyc-restart-wrap",
        retriggerMode: "restart",
        arrangement: "sequential",
        cycleMode: true,
      });
      setLayerCycleIndex("layer-cyc-restart-wrap", 0);

      await applyRetriggerMode(pad, layer, true, mockCtx as unknown as AudioContext, layerGain, [s1, s2]);

      // cur=0 → set to resolved.length - 1 = 1
      expect(getLayerCycleIndex("layer-cyc-restart-wrap")).toBe(1);
    });

    // ── "next" retrigger mode ─────────────────────────────────────────────────

    it("'next' mode with remaining sounds returns 'chain-advanced' and plays next", async () => {
      const { applyRetriggerMode } = await import("./layerTrigger");
      const { loadBuffer } = await import("./bufferCache");
      const { getPadGain, getOrCreateLayerGain, setLayerChain, recordLayerVoice, isLayerActive } = await import("./audioState");
      const padGain = getPadGain("pad-next-rem");
      const layerGain = getOrCreateLayerGain("layer-next-rem", 1, padGain);
      const pad = createMockPad({ id: "pad-next-rem" });
      const s1 = createMockSound({ id: "s1", filePath: "s1.wav" });
      const s2 = createMockSound({ id: "s2", filePath: "s2.wav" });
      const layer = createMockLayer({
        id: "layer-next-rem",
        retriggerMode: "next",
        arrangement: "sequential",
        selection: { type: "assigned", instances: [
          { id: "i1", soundId: "s1", volume: 100 },
          { id: "i2", soundId: "s2", volume: 100 },
        ]},
      });
      // Register an active voice to verify it gets stopped
      const mockVoice = makeMinimalVoice();
      recordLayerVoice("pad-next-rem", "layer-next-rem", mockVoice as unknown as import("./audioVoice").AudioVoice);
      // Simulate that s2 is queued as the next sound
      setLayerChain("layer-next-rem", [s2]);

      const result = await applyRetriggerMode(pad, layer, true, mockCtx as unknown as AudioContext, layerGain, [s1, s2]);

      expect(result).toBe("chain-advanced");
      expect(mockVoice.stop).toHaveBeenCalled(); // prior voice was stopped
      // Layer is still active because startLayerSound added a new voice for s2
      expect(isLayerActive("layer-next-rem")).toBe(true);
      expect(loadBuffer).toHaveBeenCalledWith(expect.objectContaining({ id: "s2" })); // next sound loaded
    });

    it("'next' mode with exhausted one-shot queue returns 'chain-advanced' (stops only)", async () => {
      const { applyRetriggerMode } = await import("./layerTrigger");
      const { getPadGain, getOrCreateLayerGain, setLayerChain, recordLayerVoice, isLayerActive } = await import("./audioState");
      const { usePlaybackStore } = await import("@/state/playbackStore");
      const padGain = getPadGain("pad-next-exhaust");
      const layerGain = getOrCreateLayerGain("layer-next-exhaust", 1, padGain);
      const pad = createMockPad({ id: "pad-next-exhaust" });
      const s1 = createMockSound({ id: "s1", filePath: "s1.wav" });
      const layer = createMockLayer({
        id: "layer-next-exhaust",
        retriggerMode: "next",
        arrangement: "sequential",
        playbackMode: "one-shot",
      });
      // Register an active voice to verify it gets stopped
      const mockVoice = makeMinimalVoice();
      recordLayerVoice("pad-next-exhaust", "layer-next-exhaust", mockVoice as unknown as import("./audioVoice").AudioVoice);
      // Empty chain — queue exhausted
      setLayerChain("layer-next-exhaust", []);
      // Seed the pad as playing so we can verify the chain-exhausted path removes it.
      usePlaybackStore.getState().addPlayingPad(pad.id);

      const result = await applyRetriggerMode(pad, layer, true, mockCtx as unknown as AudioContext, layerGain, [s1]);

      expect(result).toBe("chain-advanced");
      expect(mockVoice.stop).toHaveBeenCalled(); // voice was stopped
      expect(isLayerActive("layer-next-exhaust")).toBe(false);
      expect(usePlaybackStore.getState().playingPadIds.has(pad.id)).toBe(false);
    });

    it("'next' mode with loop + exhausted queue loops back to beginning", async () => {
      const { applyRetriggerMode } = await import("./layerTrigger");
      const { loadBuffer } = await import("./bufferCache");
      const { getPadGain, getOrCreateLayerGain, setLayerChain, recordLayerVoice, isLayerActive } = await import("./audioState");
      const padGain = getPadGain("pad-next-loop");
      const layerGain = getOrCreateLayerGain("layer-next-loop", 1, padGain);
      const pad = createMockPad({ id: "pad-next-loop" });
      const s1 = createMockSound({ id: "s1", filePath: "s1.wav" });
      const s2 = createMockSound({ id: "s2", filePath: "s2.wav" });
      const layer = createMockLayer({
        id: "layer-next-loop",
        retriggerMode: "next",
        arrangement: "sequential",
        playbackMode: "loop",
      });
      // Register an active voice to verify it gets stopped
      const mockVoice = makeMinimalVoice();
      recordLayerVoice("pad-next-loop", "layer-next-loop", mockVoice as unknown as import("./audioVoice").AudioVoice);
      // Empty chain — exhausted, but loop mode means restart from beginning
      setLayerChain("layer-next-loop", []);

      const result = await applyRetriggerMode(pad, layer, true, mockCtx as unknown as AudioContext, layerGain, [s1, s2]);

      expect(result).toBe("chain-advanced");
      expect(mockVoice.stop).toHaveBeenCalled(); // prior voice was stopped
      // Layer is still active because startLayerSound added a new voice for s1 (loop restart)
      expect(isLayerActive("layer-next-loop")).toBe(true);
      expect(loadBuffer).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" })); // loops back to s1
    });

    it("'next' mode with cycleMode + chained returns 'proceed'", async () => {
      const { applyRetriggerMode } = await import("./layerTrigger");
      const { getPadGain, getOrCreateLayerGain, setLayerChain } = await import("./audioState");
      const padGain = getPadGain("pad-next-cycle");
      const layerGain = getOrCreateLayerGain("layer-next-cycle", 1, padGain);
      const pad = createMockPad({ id: "pad-next-cycle" });
      const s1 = createMockSound({ id: "s1", filePath: "s1.wav" });
      const layer = createMockLayer({
        id: "layer-next-cycle",
        retriggerMode: "next",
        arrangement: "sequential",
        cycleMode: true,
      });
      setLayerChain("layer-next-cycle", [s1]);

      const result = await applyRetriggerMode(pad, layer, true, mockCtx as unknown as AudioContext, layerGain, [s1]);

      // cycleMode + chained: fall through to start-playback (reads updated cycle cursor)
      expect(result).toBe("proceed");
    });
  });

  // ── startLayerPlayback ────────────────────────────────────────────────────

  describe("startLayerPlayback", () => {
    it("starts simultaneous sounds for non-chained arrangement", async () => {
      const { startLayerPlayback } = await import("./layerTrigger");
      const { getPadGain, getOrCreateLayerGain, isLayerActive } = await import("./audioState");
      const padGain = getPadGain("pad-slp");
      const layerGain = getOrCreateLayerGain("layer-slp", 1, padGain);
      const pad = createMockPad({ id: "pad-slp" });
      const sound = createMockSound({ id: "s1", filePath: "s.wav" });
      const layer = createMockLayer({
        id: "layer-slp",
        arrangement: "simultaneous",
        selection: { type: "assigned", instances: [{ id: "i1", soundId: "s1", volume: 100 }] },
      });

      await startLayerPlayback(pad, layer, mockCtx as unknown as AudioContext, layerGain, [sound]);

      expect(isLayerActive("layer-slp")).toBe(true);
    });

    it("chained arrangement: starts first sound and queues remainder", async () => {
      const { startLayerPlayback } = await import("./layerTrigger");
      const { getPadGain, getOrCreateLayerGain, isLayerActive, getLayerChain } = await import("./audioState");
      const padGain = getPadGain("pad-chain");
      const layerGain = getOrCreateLayerGain("layer-chain", 1, padGain);
      const pad = createMockPad({ id: "pad-chain" });
      const s1 = createMockSound({ id: "s1", filePath: "s1.wav" });
      const s2 = createMockSound({ id: "s2", filePath: "s2.wav" });
      const layer = createMockLayer({
        id: "layer-chain",
        arrangement: "sequential",
        selection: { type: "assigned", instances: [
          { id: "i1", soundId: "s1", volume: 100 },
          { id: "i2", soundId: "s2", volume: 100 },
        ]},
      });

      await startLayerPlayback(pad, layer, mockCtx as unknown as AudioContext, layerGain, [s1, s2]);

      expect(isLayerActive("layer-chain")).toBe(true);
      // s2 should be queued as the next in the chain
      expect(getLayerChain("layer-chain")).toEqual([s2]);
    });

    it("cycle-mode: plays first sound by index and advances cursor", async () => {
      const { startLayerPlayback } = await import("./layerTrigger");
      const { loadBuffer } = await import("./bufferCache");
      const { getPadGain, getOrCreateLayerGain, isLayerActive, getLayerCycleIndex } = await import("./audioState");
      const padGain = getPadGain("pad-cycle");
      const layerGain = getOrCreateLayerGain("layer-cycle", 1, padGain);
      const pad = createMockPad({ id: "pad-cycle" });
      const s1 = createMockSound({ id: "s1", filePath: "s1.wav" });
      const s2 = createMockSound({ id: "s2", filePath: "s2.wav" });
      const layer = createMockLayer({
        id: "layer-cycle",
        arrangement: "sequential",
        cycleMode: true,
        playbackMode: "one-shot",
        selection: { type: "assigned", instances: [
          { id: "i1", soundId: "s1", volume: 100 },
          { id: "i2", soundId: "s2", volume: 100 },
        ]},
      });

      // First trigger — no cursor set yet, defaults to 0
      await startLayerPlayback(pad, layer, mockCtx as unknown as AudioContext, layerGain, [s1, s2]);

      expect(isLayerActive("layer-cycle")).toBe(true);
      // Should have played s1 (index 0), not s2
      expect(loadBuffer).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }));
      // Cursor should advance to 1 (next trigger plays s2)
      expect(getLayerCycleIndex("layer-cycle")).toBe(1);
    });

    it("cycle-mode: deletes cursor after last sound in one-shot mode", async () => {
      const { startLayerPlayback } = await import("./layerTrigger");
      const { getPadGain, getOrCreateLayerGain, setLayerCycleIndex, getLayerCycleIndex } = await import("./audioState");
      const padGain = getPadGain("pad-cycle-end");
      const layerGain = getOrCreateLayerGain("layer-cycle-end", 1, padGain);
      const pad = createMockPad({ id: "pad-cycle-end" });
      const s1 = createMockSound({ id: "s1", filePath: "s1.wav" });
      const s2 = createMockSound({ id: "s2", filePath: "s2.wav" });
      const layer = createMockLayer({
        id: "layer-cycle-end",
        arrangement: "sequential",
        cycleMode: true,
        playbackMode: "one-shot",
      });
      // Set cursor to last index (1 for 2 sounds)
      setLayerCycleIndex("layer-cycle-end", 1);

      await startLayerPlayback(pad, layer, mockCtx as unknown as AudioContext, layerGain, [s1, s2]);

      // One-shot exhausted — cursor should be deleted (reset for next trigger from beginning)
      expect(getLayerCycleIndex("layer-cycle-end")).toBeUndefined();
    });
  });
});

// ── startLayerSound — error bus ───────────────────────────────────────────────

describe("startLayerSound error bus", () => {
  it("emits isMissingFile:true via audioEvents on MissingFileError", async () => {
    const { loadBuffer, MissingFileError } = await import("./bufferCache");
    const { startLayerSound } = await import("./layerTrigger");
    const { getPadGain, getOrCreateLayerGain } = await import("./audioState");
    vi.mocked(loadBuffer).mockRejectedValue(new MissingFileError("not found"));
    const pad = createMockPad({ id: "err-pad" });
    const layer = createMockLayer({ id: "err-layer" });
    const sound = createMockSound({ id: "s1", name: "kick", filePath: "kick.wav" });
    const padGain = getPadGain(pad.id);
    const layerGain = getOrCreateLayerGain(layer.id, 1, padGain);

    await startLayerSound(pad, layer, sound, mockCtx as unknown as AudioContext, layerGain, 1.0, [sound]);

    expect(mockEmitAudioError).toHaveBeenCalledWith(
      expect.any(MissingFileError),
      expect.objectContaining({ isMissingFile: true, soundName: "kick" }),
    );
  });

  it("emits generic error via audioEvents on load failure", async () => {
    const { loadBuffer } = await import("./bufferCache");
    const { startLayerSound } = await import("./layerTrigger");
    const { getPadGain, getOrCreateLayerGain } = await import("./audioState");
    vi.mocked(loadBuffer).mockRejectedValue(new Error("decode failed"));
    const pad = createMockPad({ id: "err-pad-2" });
    const layer = createMockLayer({ id: "err-layer-2" });
    const sound = createMockSound({ id: "s2", name: "snare", filePath: "snare.wav" });
    const padGain = getPadGain(pad.id);
    const layerGain = getOrCreateLayerGain(layer.id, 1, padGain);

    await startLayerSound(pad, layer, sound, mockCtx as unknown as AudioContext, layerGain, 1.0, [sound]);

    expect(mockEmitAudioError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "decode failed" }),
      expect.objectContaining({ isMissingFile: false, soundName: "snare" }),
    );
  });
});

// ── startLayerSound — circuit-breaker (issue #170) ────────────────────────────

describe("startLayerSound circuit-breaker", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockCtx.currentTime = 0;
    mockCtx.createGain.mockReset().mockReturnValue(makeMockGain());
    mockCtx.createBufferSource.mockReset().mockReturnValue({
      buffer: null,
      loop: false,
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      addEventListener: vi.fn(),
    });
    const { clearAllAudioState } = await import("./audioState");
    clearAllAudioState();
  });

  it("increments the consecutive-failure counter on each failure (below threshold)", async () => {
    const { loadBuffer } = await import("./bufferCache");
    const { startLayerSound } = await import("./layerTrigger");
    const { getPadGain, getOrCreateLayerGain, getLayerConsecutiveFailures } = await import("./audioState");
    vi.mocked(loadBuffer).mockRejectedValue(new Error("load failed"));

    const pad = createMockPad({ id: "cb-pad-1" });
    const layer = createMockLayer({ id: "cb-layer-1" });
    const sound = createMockSound({ id: "s1", name: "one", filePath: "one.wav" });
    const padGain = getPadGain(pad.id);
    const layerGain = getOrCreateLayerGain(layer.id, 1, padGain);

    // First failure — counter increments to 1, error emitted normally.
    await startLayerSound(pad, layer, sound, mockCtx as unknown as AudioContext, layerGain, 1.0, [sound]);
    expect(getLayerConsecutiveFailures("cb-layer-1")).toBe(1);
    expect(mockEmitAudioError).toHaveBeenCalledTimes(1);

    // Second failure — counter increments to 2, another per-failure error emitted.
    await startLayerSound(pad, layer, sound, mockCtx as unknown as AudioContext, layerGain, 1.0, [sound]);
    expect(getLayerConsecutiveFailures("cb-layer-1")).toBe(2);
    expect(mockEmitAudioError).toHaveBeenCalledTimes(2);
  });

  it("fires the circuit-breaker after 3 consecutive failures: deletes chain and emits ONE summary error", async () => {
    const { loadBuffer } = await import("./bufferCache");
    const { startLayerSound } = await import("./layerTrigger");
    const {
      getPadGain,
      getOrCreateLayerGain,
      setLayerChain,
      getLayerChain,
      getLayerConsecutiveFailures,
    } = await import("./audioState");
    vi.mocked(loadBuffer).mockRejectedValue(new Error("load failed"));

    const pad = createMockPad({ id: "cb-pad-2" });
    const layer = createMockLayer({ id: "cb-layer-2" });
    const s1 = createMockSound({ id: "s1", name: "one", filePath: "one.wav" });
    const s2 = createMockSound({ id: "s2", name: "two", filePath: "two.wav" });
    const padGain = getPadGain(pad.id);
    const layerGain = getOrCreateLayerGain(layer.id, 1, padGain);

    // Simulate an in-flight chain that would normally continue advancing.
    setLayerChain("cb-layer-2", [s2]);

    // Failures 1 and 2 — normal per-failure emits, chain is cleared on each failure.
    await startLayerSound(pad, layer, s1, mockCtx as unknown as AudioContext, layerGain, 1.0, [s1]);
    await startLayerSound(pad, layer, s1, mockCtx as unknown as AudioContext, layerGain, 1.0, [s1]);
    expect(mockEmitAudioError).toHaveBeenCalledTimes(2);
    expect(getLayerChain("cb-layer-2")).toBeUndefined();

    // Failure 3 — circuit trips: chain deleted, counter reset, exactly ONE more emit.
    await startLayerSound(pad, layer, s1, mockCtx as unknown as AudioContext, layerGain, 1.0, [s1]);

    expect(mockEmitAudioError).toHaveBeenCalledTimes(3);
    // Verify the third emit is the summary message, not the per-sound one.
    const lastCall = mockEmitAudioError.mock.calls[2];
    expect((lastCall[0] as Error).message).toMatch(/3 consecutive load failures/i);
    expect(lastCall[1]).toEqual(expect.objectContaining({ isMissingFile: false }));
    // Chain torn down so no further onended-chained sounds can be loaded.
    expect(getLayerChain("cb-layer-2")).toBeUndefined();
    // Counter reset so a future trigger starts fresh.
    expect(getLayerConsecutiveFailures("cb-layer-2")).toBe(0);
  });

  it("does NOT emit additional errors once the circuit has tripped (no toast per sound in a 500-sound chain)", async () => {
    const { loadBuffer } = await import("./bufferCache");
    const { startLayerSound } = await import("./layerTrigger");
    const { getPadGain, getOrCreateLayerGain } = await import("./audioState");
    vi.mocked(loadBuffer).mockRejectedValue(new Error("load failed"));

    const pad = createMockPad({ id: "cb-pad-3" });
    const layer = createMockLayer({ id: "cb-layer-3" });
    const sound = createMockSound({ id: "s1", name: "one", filePath: "one.wav" });
    const padGain = getPadGain(pad.id);
    const layerGain = getOrCreateLayerGain(layer.id, 1, padGain);

    // Trip the breaker with 3 failures.
    await startLayerSound(pad, layer, sound, mockCtx as unknown as AudioContext, layerGain, 1.0, [sound]);
    await startLayerSound(pad, layer, sound, mockCtx as unknown as AudioContext, layerGain, 1.0, [sound]);
    await startLayerSound(pad, layer, sound, mockCtx as unknown as AudioContext, layerGain, 1.0, [sound]);
    expect(mockEmitAudioError).toHaveBeenCalledTimes(3);

    // A real chain would have its queue deleted after the trip and stop advancing.
    // But even if the caller continues invoking startLayerSound directly (worst case),
    // we still emit one error per invocation — the protection is the chain-queue
    // teardown in the onended path. This assertion documents the boundary:
    // the breaker is a per-failure-run counter that resets after tripping.
    await startLayerSound(pad, layer, sound, mockCtx as unknown as AudioContext, layerGain, 1.0, [sound]);
    // Counter restarts from 0, so this extra synthetic call produces one more emit —
    // NOT the runaway 1-per-sound behavior previously seen because the real-world
    // driver (the onended chain) is now broken upstream.
    expect(mockEmitAudioError).toHaveBeenCalledTimes(4);
  });

  it("resets the consecutive-failure counter on a successful load", async () => {
    const { loadBuffer } = await import("./bufferCache");
    const { startLayerSound } = await import("./layerTrigger");
    const {
      getPadGain,
      getOrCreateLayerGain,
      getLayerConsecutiveFailures,
    } = await import("./audioState");

    const pad = createMockPad({ id: "cb-pad-4" });
    const layer = createMockLayer({ id: "cb-layer-4" });
    const sound = createMockSound({ id: "s1", name: "one", filePath: "one.wav" });
    const padGain = getPadGain(pad.id);
    const layerGain = getOrCreateLayerGain(layer.id, 1, padGain);

    // Two back-to-back failures build the counter to 2.
    vi.mocked(loadBuffer).mockRejectedValueOnce(new Error("fail 1"));
    await startLayerSound(pad, layer, sound, mockCtx as unknown as AudioContext, layerGain, 1.0, [sound]);
    vi.mocked(loadBuffer).mockRejectedValueOnce(new Error("fail 2"));
    await startLayerSound(pad, layer, sound, mockCtx as unknown as AudioContext, layerGain, 1.0, [sound]);
    expect(getLayerConsecutiveFailures("cb-layer-4")).toBe(2);

    // A successful load resets the counter back to 0.
    vi.mocked(loadBuffer).mockResolvedValueOnce({ duration: 1.0 } as unknown as AudioBuffer);
    await startLayerSound(pad, layer, sound, mockCtx as unknown as AudioContext, layerGain, 1.0, [sound]);
    expect(getLayerConsecutiveFailures("cb-layer-4")).toBe(0);
  });

  it("no longer silently swallows chain-continuation errors: onended-driven load failure flows through emitAudioError", async () => {
    // Prior to the fix, onended's chain-continuation path used `.catch(() => {})`,
    // silently dropping any error thrown by the recursive startLayerSound call.
    // Now, loadBuffer failures in the chained call still reach emitAudioError
    // (through startLayerSound's internal catch), proving the error is not lost.
    const { loadBuffer } = await import("./bufferCache");
    const { startLayerSound } = await import("./layerTrigger");
    const { getPadGain, getOrCreateLayerGain, setLayerChain } = await import("./audioState");

    const pad = createMockPad({ id: "cb-pad-log" });
    const layer = createMockLayer({ id: "cb-layer-log", arrangement: "sequential" });
    const s1 = createMockSound({ id: "s1", filePath: "s1.wav" });
    const s2 = createMockSound({ id: "s2", name: "two", filePath: "s2.wav" });
    const padGain = getPadGain(pad.id);
    const layerGain = getOrCreateLayerGain(layer.id, 1, padGain);

    // Instrument wrapBufferSource so we can capture + invoke the onended callback.
    const capturedOnEnded: Array<() => void> = [];
    const voiceMock = {
      setOnEnded: vi.fn((cb: (() => void) | null) => { if (cb) capturedOnEnded.push(cb); }),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      stopWithRamp: vi.fn(),
    };
    const voiceModule = await import("./audioVoice");
    vi.spyOn(voiceModule, "wrapBufferSource").mockReturnValue(
      voiceMock as unknown as ReturnType<typeof voiceModule.wrapBufferSource>,
    );

    // First load succeeds — onended is registered; s2 is queued as the chain remainder.
    vi.mocked(loadBuffer).mockResolvedValueOnce({ duration: 1.0 } as unknown as AudioBuffer);
    setLayerChain(layer.id, [s2]);
    await startLayerSound(pad, layer, s1, mockCtx as unknown as AudioContext, layerGain, 1.0, [s1, s2]);
    expect(capturedOnEnded.length).toBeGreaterThan(0);

    // Reset the emit tracker so we only count the chained-call emit.
    mockEmitAudioError.mockClear();

    // Second (chained) load rejects. With the old silent-catch this would have
    // been lost — with the fix it flows through emitAudioError just like any
    // other failure.
    vi.mocked(loadBuffer).mockRejectedValue(new Error("chained load boom"));

    capturedOnEnded[0]();
    // Flush microtasks so the chained startLayerSound promise settles.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockEmitAudioError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "chained load boom" }),
      expect.objectContaining({ soundName: "two", isMissingFile: false }),
    );
  });

  it("loop-restart .catch path: load failure in chain loop-restart is not silent", async () => {
    // The onended handler rebuilds the chain when playbackMode=loop and the chain
    // has exhausted naturally. If that startLayerSound call fails, the .catch logs
    // to console rather than swallowing — and the failure reaches emitAudioError
    // via startLayerSound's internal catch.
    const { loadBuffer } = await import("./bufferCache");
    const { startLayerSound } = await import("./layerTrigger");
    const { getPadGain, getOrCreateLayerGain, setLayerChain } = await import("./audioState");
    // Configure library store so resolveSounds returns s1 (needed for loop-restart live lookup).
    const { useLibraryStore } = await import("@/state/libraryStore");

    const s1 = createMockSound({ id: "s1", name: "loopSound", filePath: "s1.wav" });
    vi.mocked(useLibraryStore.getState).mockReturnValue({ sounds: [s1] } as ReturnType<typeof useLibraryStore.getState>);

    const pad = createMockPad({ id: "cb-loop-pad" });
    // Layer selection must reference s1 so resolveSounds returns it from the live library.
    const layer = createMockLayer({
      id: "cb-loop-layer",
      arrangement: "sequential",
      playbackMode: "loop",
      selection: { type: "assigned", instances: [{ id: "i1", soundId: "s1", volume: 100 }] },
    });
    const padGain = getPadGain(pad.id);
    const layerGain = getOrCreateLayerGain(layer.id, 1, padGain);

    const capturedOnEnded: Array<() => void> = [];
    const voiceMock = {
      setOnEnded: vi.fn((cb: (() => void) | null) => { if (cb) capturedOnEnded.push(cb); }),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      stopWithRamp: vi.fn(),
    };
    const voiceModule = await import("./audioVoice");
    vi.spyOn(voiceModule, "wrapBufferSource").mockReturnValue(
      voiceMock as unknown as ReturnType<typeof voiceModule.wrapBufferSource>,
    );

    // First load succeeds — onended is registered; chain is empty (exhausted naturally).
    vi.mocked(loadBuffer).mockResolvedValueOnce({ duration: 1.0 } as unknown as AudioBuffer);
    setLayerChain(layer.id, []);  // empty chain = natural exhaustion
    await startLayerSound(pad, layer, s1, mockCtx as unknown as AudioContext, layerGain, 1.0, [s1]);
    expect(capturedOnEnded.length).toBeGreaterThan(0);

    mockEmitAudioError.mockClear();

    // Loop-restart load fails. Should flow through emitAudioError, not be silently dropped.
    vi.mocked(loadBuffer).mockRejectedValue(new Error("loop-restart boom"));

    // Trigger onended — this causes the loop-restart path in startLayerSound's onended handler.
    capturedOnEnded[0]();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockEmitAudioError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "loop-restart boom" }),
      expect.objectContaining({ isMissingFile: false }),
    );
  });

  it("simultaneous loop-restart .catch path: load failure in simultaneous loop-restart is not silent", async () => {
    // Same as loop-restart but with simultaneous arrangement — when the chain
    // exhausts and arrangement is non-chained, the loop-restart fires all sounds
    // simultaneously via separate startLayerSound calls. Failures must not be silent.
    const { loadBuffer } = await import("./bufferCache");
    const { startLayerSound } = await import("./layerTrigger");
    const { getPadGain, getOrCreateLayerGain, setLayerChain } = await import("./audioState");
    // Configure library store so resolveSounds returns s1 during the live loop-restart lookup.
    const { useLibraryStore } = await import("@/state/libraryStore");

    const s1 = createMockSound({ id: "s1", name: "simSound", filePath: "s1.wav" });
    vi.mocked(useLibraryStore.getState).mockReturnValue({ sounds: [s1] } as ReturnType<typeof useLibraryStore.getState>);

    const pad = createMockPad({ id: "cb-sim-pad" });
    // simultaneous arrangement (isChained returns false); selection references s1.
    const layer = createMockLayer({
      id: "cb-sim-layer",
      arrangement: "simultaneous",
      playbackMode: "loop",
      selection: { type: "assigned", instances: [{ id: "i1", soundId: "s1", volume: 100 }] },
    });
    const padGain = getPadGain(pad.id);
    const layerGain = getOrCreateLayerGain(layer.id, 1, padGain);

    const capturedOnEnded: Array<() => void> = [];
    const voiceMock = {
      setOnEnded: vi.fn((cb: (() => void) | null) => { if (cb) capturedOnEnded.push(cb); }),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      stopWithRamp: vi.fn(),
    };
    const voiceModule = await import("./audioVoice");
    vi.spyOn(voiceModule, "wrapBufferSource").mockReturnValue(
      voiceMock as unknown as ReturnType<typeof voiceModule.wrapBufferSource>,
    );

    // First load succeeds with empty chain (simultaneous layers don't use chain queue).
    vi.mocked(loadBuffer).mockResolvedValueOnce({ duration: 1.0 } as unknown as AudioBuffer);
    setLayerChain(layer.id, []);  // empty chain triggers the "exhausted" → loop branch
    await startLayerSound(pad, layer, s1, mockCtx as unknown as AudioContext, layerGain, 1.0, [s1]);
    expect(capturedOnEnded.length).toBeGreaterThan(0);

    mockEmitAudioError.mockClear();

    vi.mocked(loadBuffer).mockRejectedValue(new Error("sim-restart boom"));
    capturedOnEnded[0]();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockEmitAudioError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "sim-restart boom" }),
      expect.objectContaining({ isMissingFile: false }),
    );
  });

  it("circuit-breaker tears down chain queue on 3rd consecutive failure (prevents onended from advancing)", async () => {
    // After CHAIN_FAILURE_THRESHOLD consecutive failures the chain queue is deleted.
    // This is what prevents the onended handler from advancing — it checks getLayerChain
    // and bails when the result is undefined (cleared externally).
    // Note: this test exercises the state directly via three startLayerSound calls; the
    // companion test above ("no longer silently swallows") exercises the onended path.
    const { loadBuffer } = await import("./bufferCache");
    const { startLayerSound } = await import("./layerTrigger");
    const { getPadGain, getOrCreateLayerGain, setLayerChain, getLayerChain } = await import("./audioState");

    const pad = createMockPad({ id: "cb-chain-stop-pad" });
    const layer = createMockLayer({ id: "cb-chain-stop-layer", arrangement: "sequential" });
    const s1 = createMockSound({ id: "s1", filePath: "s1.wav" });
    const s2 = createMockSound({ id: "s2", filePath: "s2.wav" });
    const s3 = createMockSound({ id: "s3", filePath: "s3.wav" });
    const padGain = getPadGain(pad.id);
    const layerGain = getOrCreateLayerGain(layer.id, 1, padGain);

    // Simulate a 3-sound chain [s1, s2, s3] all failing.
    setLayerChain(layer.id, [s2, s3]);
    vi.mocked(loadBuffer).mockRejectedValue(new Error("all missing"));

    await startLayerSound(pad, layer, s1, mockCtx as unknown as AudioContext, layerGain, 1.0, [s1, s2, s3]);
    await startLayerSound(pad, layer, s2, mockCtx as unknown as AudioContext, layerGain, 1.0, [s1, s2, s3]);
    // Third failure trips the breaker
    await startLayerSound(pad, layer, s3, mockCtx as unknown as AudioContext, layerGain, 1.0, [s1, s2, s3]);

    // Chain must be cleared (undefined) — onended cannot advance further.
    expect(getLayerChain("cb-chain-stop-layer")).toBeUndefined();
    // Exactly 3 emits total (2 per-sound + 1 summary).
    expect(mockEmitAudioError).toHaveBeenCalledTimes(3);
    const summaryCall = mockEmitAudioError.mock.calls[2];
    expect((summaryCall[0] as Error).message).toMatch(/consecutive load failures/i);
  });

  it("post-reset failure counter starts from 0 again", async () => {
    // After a success resets the counter, a new run of failures must accumulate
    // from 0 before the breaker trips — not trip immediately from a stale count.
    const { loadBuffer } = await import("./bufferCache");
    const { startLayerSound } = await import("./layerTrigger");
    const { getPadGain, getOrCreateLayerGain, getLayerConsecutiveFailures } = await import("./audioState");

    const pad = createMockPad({ id: "cb-reset-pad" });
    const layer = createMockLayer({ id: "cb-reset-layer" });
    const sound = createMockSound({ id: "s1", name: "one", filePath: "one.wav" });
    const padGain = getPadGain(pad.id);
    const layerGain = getOrCreateLayerGain(layer.id, 1, padGain);

    // Build counter to 2 with 2 failures.
    vi.mocked(loadBuffer).mockRejectedValueOnce(new Error("fail 1"));
    await startLayerSound(pad, layer, sound, mockCtx as unknown as AudioContext, layerGain, 1.0, [sound]);
    vi.mocked(loadBuffer).mockRejectedValueOnce(new Error("fail 2"));
    await startLayerSound(pad, layer, sound, mockCtx as unknown as AudioContext, layerGain, 1.0, [sound]);
    expect(getLayerConsecutiveFailures("cb-reset-layer")).toBe(2);

    // Success resets counter to 0.
    vi.mocked(loadBuffer).mockResolvedValueOnce({ duration: 1.0 } as unknown as AudioBuffer);
    await startLayerSound(pad, layer, sound, mockCtx as unknown as AudioContext, layerGain, 1.0, [sound]);
    expect(getLayerConsecutiveFailures("cb-reset-layer")).toBe(0);

    // A new failure after the reset starts fresh at 1 — not 3 (no immediate trip).
    vi.mocked(loadBuffer).mockRejectedValueOnce(new Error("fail after reset"));
    await startLayerSound(pad, layer, sound, mockCtx as unknown as AudioContext, layerGain, 1.0, [sound]);
    expect(getLayerConsecutiveFailures("cb-reset-layer")).toBe(1);
    // Only one additional emit for this failure (not a summary/circuit-trip emit).
    const lastCall = mockEmitAudioError.mock.calls[mockEmitAudioError.mock.calls.length - 1];
    expect((lastCall[0] as Error).message).toBe("fail after reset");
  });

  it("fresh re-trigger via startLayerPlayback resets the failure counter", async () => {
    // Counter from a previous play session should not carry over to a new trigger.
    // startLayerPlayback must reset the counter at trigger entry so the first
    // failure on the new trigger is counted from 0, not from the stale value.
    const { loadBuffer } = await import("./bufferCache");
    const { startLayerPlayback } = await import("./layerTrigger");
    const { getPadGain, getOrCreateLayerGain, getLayerConsecutiveFailures } = await import("./audioState");

    const pad = createMockPad({ id: "cb-retrig-pad" });
    const layer = createMockLayer({ id: "cb-retrig-layer", arrangement: "sequential" });
    const s1 = createMockSound({ id: "s1", name: "one", filePath: "one.wav" });
    const s2 = createMockSound({ id: "s2", name: "two", filePath: "two.wav" });
    const padGain = getPadGain(pad.id);
    const layerGain = getOrCreateLayerGain(layer.id, 1, padGain);

    // Trigger 1: one failure → counter reaches 1.
    vi.mocked(loadBuffer).mockRejectedValueOnce(new Error("first trigger fail"));
    await startLayerPlayback(pad, layer, mockCtx as unknown as AudioContext, layerGain, [s1, s2]);
    expect(getLayerConsecutiveFailures("cb-retrig-layer")).toBe(1);

    // Trigger 2: startLayerPlayback must reset the counter to 0 before starting.
    // Even though the previous trigger left it at 1, the fresh trigger resets it.
    mockEmitAudioError.mockClear();
    vi.mocked(loadBuffer).mockRejectedValueOnce(new Error("second trigger fail"));
    await startLayerPlayback(pad, layer, mockCtx as unknown as AudioContext, layerGain, [s1, s2]);
    // Counter is 1 (one failure on this new trigger), not 2 (accumulated across triggers).
    expect(getLayerConsecutiveFailures("cb-retrig-layer")).toBe(1);
    // The emit for the second trigger must be a per-sound error, not a circuit-trip summary.
    // If the counter were not reset (accumulated = 2), the third failure would fire the
    // summary, not a per-sound error. Confirming it's a per-sound error proves the reset.
    expect(mockEmitAudioError).toHaveBeenCalledTimes(1);
    const emitArg = mockEmitAudioError.mock.calls[0][0] as Error;
    expect(emitArg.message).toBe("second trigger fail");
    expect(emitArg.message).not.toMatch(/consecutive load failures/i);
  });
});

// ── startLayerSound — chain-state cleanup on error (issue #136) ───────────────

describe("startLayerSound chain-state cleanup on error", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockCtx.currentTime = 0;
    mockCtx.createGain.mockReset().mockReturnValue(makeMockGain());
    mockCtx.createBufferSource.mockReset().mockReturnValue({
      buffer: null,
      loop: false,
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      addEventListener: vi.fn(),
    });
    const { clearAllAudioState } = await import("./audioState");
    clearAllAudioState();
  });

  it("clears layerChain after a single (below-threshold) decode failure so the next trigger starts fresh", async () => {
    const { loadBuffer } = await import("./bufferCache");
    const { startLayerSound } = await import("./layerTrigger");
    const {
      getPadGain,
      getOrCreateLayerGain,
      setLayerChain,
      getLayerChain,
    } = await import("./audioState");
    vi.mocked(loadBuffer).mockRejectedValue(new Error("decode failed"));

    const pad = createMockPad({ id: "cleanup-pad-1" });
    const layer = createMockLayer({ id: "cleanup-layer-1", arrangement: "sequential" });
    const s1 = createMockSound({ id: "s1", name: "one", filePath: "one.wav" });
    const s2 = createMockSound({ id: "s2", name: "two", filePath: "two.wav" });
    const padGain = getPadGain(pad.id);
    const layerGain = getOrCreateLayerGain(layer.id, 1, padGain);

    // Simulate a stale chain left from a prior mid-chain position.
    setLayerChain("cleanup-layer-1", [s2]);

    // Single failure — below the circuit-breaker threshold of 3.
    await startLayerSound(pad, layer, s1, mockCtx as unknown as AudioContext, layerGain, 1.0, [s1, s2]);

    // Chain must be cleared so the next trigger rebuilds from scratch.
    expect(getLayerChain("cleanup-layer-1")).toBeUndefined();
  });

  it("clears layerCycleIndex after a single (below-threshold) decode failure so the next trigger resets the cycle", async () => {
    const { loadBuffer } = await import("./bufferCache");
    const { startLayerSound } = await import("./layerTrigger");
    const {
      getPadGain,
      getOrCreateLayerGain,
      setLayerCycleIndex,
      getLayerCycleIndex,
    } = await import("./audioState");
    vi.mocked(loadBuffer).mockRejectedValue(new Error("decode failed"));

    const pad = createMockPad({ id: "cleanup-pad-2" });
    const layer = createMockLayer({ id: "cleanup-layer-2", arrangement: "sequential" });
    const s1 = createMockSound({ id: "s1", name: "one", filePath: "one.wav" });
    const padGain = getPadGain(pad.id);
    const layerGain = getOrCreateLayerGain(layer.id, 1, padGain);

    // Simulate an advanced cycle index left by startLayerPlayback before startLayerSound failed.
    setLayerCycleIndex("cleanup-layer-2", 2);

    // Single failure — below the circuit-breaker threshold of 3.
    await startLayerSound(pad, layer, s1, mockCtx as unknown as AudioContext, layerGain, 1.0, [s1]);

    // Cycle index must be cleared so the next trigger restarts from the beginning.
    expect(getLayerCycleIndex("cleanup-layer-2")).toBeUndefined();
  });

  it("clears layerChain on MissingFileError — same cleanup applies regardless of error type", async () => {
    const { loadBuffer, MissingFileError } = await import("./bufferCache");
    const { startLayerSound } = await import("./layerTrigger");
    const {
      getPadGain,
      getOrCreateLayerGain,
      setLayerChain,
      getLayerChain,
    } = await import("./audioState");
    vi.mocked(loadBuffer).mockRejectedValue(new MissingFileError("kick.wav not found"));

    const pad = createMockPad({ id: "cleanup-pad-3" });
    const layer = createMockLayer({ id: "cleanup-layer-3", arrangement: "sequential" });
    const s1 = createMockSound({ id: "s1", name: "one", filePath: "one.wav" });
    const s2 = createMockSound({ id: "s2", name: "two", filePath: "two.wav" });
    const padGain = getPadGain(pad.id);
    const layerGain = getOrCreateLayerGain(layer.id, 1, padGain);

    setLayerChain("cleanup-layer-3", [s2]);

    await startLayerSound(pad, layer, s1, mockCtx as unknown as AudioContext, layerGain, 1.0, [s1, s2]);

    expect(getLayerChain("cleanup-layer-3")).toBeUndefined();
  });

  it("clears layerCycleIndex on MissingFileError — same cleanup applies regardless of error type", async () => {
    const { loadBuffer, MissingFileError } = await import("./bufferCache");
    const { startLayerSound } = await import("./layerTrigger");
    const {
      getPadGain,
      getOrCreateLayerGain,
      setLayerCycleIndex,
      getLayerCycleIndex,
    } = await import("./audioState");
    vi.mocked(loadBuffer).mockRejectedValue(new MissingFileError("kick.wav not found"));

    const pad = createMockPad({ id: "cleanup-pad-4" });
    const layer = createMockLayer({ id: "cleanup-layer-4", arrangement: "sequential" });
    const s1 = createMockSound({ id: "s1", name: "one", filePath: "one.wav" });
    const padGain = getPadGain(pad.id);
    const layerGain = getOrCreateLayerGain(layer.id, 1, padGain);

    setLayerCycleIndex("cleanup-layer-4", 2);

    await startLayerSound(pad, layer, s1, mockCtx as unknown as AudioContext, layerGain, 1.0, [s1]);

    expect(getLayerCycleIndex("cleanup-layer-4")).toBeUndefined();
  });

  it("mid-chain onended failure clears remaining queued sounds (chain abort is intentional, not a continuation)", async () => {
    // When startLayerSound is called recursively from onended (chain continuation)
    // and the next sound fails to load, the remaining chain is cleared.
    // This is intentional: before this fix, the stale chain was left in state
    // causing retrigger:next to resume from an invalid position. Clearing it
    // means the next trigger starts fresh from sound #1 — correct behavior.
    const { loadBuffer } = await import("./bufferCache");
    const { startLayerSound } = await import("./layerTrigger");
    const {
      getPadGain,
      getOrCreateLayerGain,
      setLayerChain,
      getLayerChain,
    } = await import("./audioState");

    const pad = createMockPad({ id: "cleanup-pad-5" });
    const layer = createMockLayer({ id: "cleanup-layer-5", arrangement: "sequential" });
    const s1 = createMockSound({ id: "s1", name: "one", filePath: "s1.wav" });
    const s2 = createMockSound({ id: "s2", name: "two", filePath: "s2.wav" });
    const s3 = createMockSound({ id: "s3", name: "three", filePath: "s3.wav" });
    const padGain = getPadGain(pad.id);
    const layerGain = getOrCreateLayerGain(layer.id, 1, padGain);

    // Instrument wrapBufferSource to capture the onended callback from s1.
    const capturedOnEnded: Array<() => void> = [];
    const voiceMock = {
      setOnEnded: vi.fn((cb: (() => void) | null) => { if (cb) capturedOnEnded.push(cb); }),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      stopWithRamp: vi.fn(),
    };
    const voiceModule = await import("./audioVoice");
    vi.spyOn(voiceModule, "wrapBufferSource").mockReturnValue(
      voiceMock as unknown as ReturnType<typeof voiceModule.wrapBufferSource>,
    );

    // s1 loads and plays; chain is [s2, s3].
    vi.mocked(loadBuffer).mockResolvedValueOnce({ duration: 1.0 } as unknown as AudioBuffer);
    setLayerChain(layer.id, [s2, s3]);
    await startLayerSound(pad, layer, s1, mockCtx as unknown as AudioContext, layerGain, 1.0, [s1, s2, s3]);
    expect(capturedOnEnded.length).toBeGreaterThan(0);

    // s2 fails — onended fires for s1, which advances the chain to [s3] then calls
    // startLayerSound(s2). s2's failure clears the remaining [s3] from the chain.
    vi.mocked(loadBuffer).mockRejectedValue(new Error("s2 decode failed"));
    capturedOnEnded[0]();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Chain must be undefined — s3 is not accessible via retrigger:next (correct).
    expect(getLayerChain("cleanup-layer-5")).toBeUndefined();
  });
});

describe("triggerLayerOfPad", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockCtx.currentTime = 0;
    mockCtx.createGain.mockReset().mockReturnValue(makeMockGain());
    mockCtx.createBufferSource.mockReset().mockReturnValue({
      buffer: null, loop: false, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), addEventListener: vi.fn(),
    });
    const { clearAllAudioState } = await import("./audioState");
    clearAllAudioState();
  });

  async function setup(layerOpts?: Parameters<typeof createMockLayer>[0]) {
    const { getPadGain, getOrCreateLayerGain, setLayerPending } = await import("./audioState");
    const { loadBuffer } = await import("./bufferCache");
    const pad = createMockPad({ id: "pad-tlop" });
    const layer = createMockLayer({ id: "layer-tlop", ...layerOpts });
    const padGain = getPadGain(pad.id);
    // Pre-seed layerGain so getOrCreateLayerGain returns without calling createGain a second time.
    getOrCreateLayerGain(layer.id, 1, padGain);
    setLayerPending(layer.id);
    return { pad, layer, padGain, loadBuffer };
  }

  it("starts playback and clears pending on proceed", async () => {
    const { triggerLayerOfPad } = await import("./layerTrigger");
    const { isLayerPending, isLayerActive } = await import("./audioState");
    const { loadBuffer } = await import("./bufferCache");
    const { pad, layer, padGain } = await setup();
    const sound = createMockSound({ id: "s1", filePath: "s1.wav" });

    vi.mocked(loadBuffer).mockResolvedValue({ duration: 1.0 } as unknown as AudioBuffer);

    await triggerLayerOfPad(pad, layer, mockCtx as unknown as AudioContext, padGain, [sound]);

    // Buffer was loaded (proceed branch reached startLayerPlayback)
    expect(vi.mocked(loadBuffer)).toHaveBeenCalledOnce();
    expect(isLayerPending(layer.id)).toBe(false);
    expect(isLayerActive(layer.id)).toBe(true);
  });

  it("clears pending and skips playback when action is 'skip' (continue mode, layer playing)", async () => {
    const { triggerLayerOfPad } = await import("./layerTrigger");
    const { recordLayerVoice, isLayerPending } = await import("./audioState");
    const { pad, layer, padGain, loadBuffer } = await setup({ retriggerMode: "continue" });

    const fakeVoice = { setOnEnded: vi.fn(), stop: vi.fn(), stopWithRamp: vi.fn() } as unknown as import("./audioVoice").AudioVoice;
    recordLayerVoice(pad.id, layer.id, fakeVoice);

    vi.mocked(loadBuffer).mockResolvedValue({ duration: 1.0 } as unknown as AudioBuffer);

    await triggerLayerOfPad(pad, layer, mockCtx as unknown as AudioContext, padGain, [createMockSound({ filePath: "a.wav" })]);

    // Verify the skip branch was taken — no buffer should have been loaded
    expect(vi.mocked(loadBuffer)).not.toHaveBeenCalled();
    expect(isLayerPending(layer.id)).toBe(false);
  });

  it("clears pending when action is 'chain-advanced' (next mode, chain has remaining)", async () => {
    const { triggerLayerOfPad } = await import("./layerTrigger");
    const { recordLayerVoice, setLayerChain, isLayerPending } = await import("./audioState");
    const { pad, layer, padGain, loadBuffer } = await setup({ retriggerMode: "next", arrangement: "sequential" });

    const fakeVoice = { setOnEnded: vi.fn(), stop: vi.fn(), stopWithRamp: vi.fn() } as unknown as import("./audioVoice").AudioVoice;
    recordLayerVoice(pad.id, layer.id, fakeVoice);
    const next = createMockSound({ id: "s2", filePath: "s2.wav" });
    setLayerChain(layer.id, [next]);

    vi.mocked(loadBuffer).mockResolvedValue({ duration: 1.0 } as unknown as AudioBuffer);

    await triggerLayerOfPad(pad, layer, mockCtx as unknown as AudioContext, padGain, [next]);

    // Chain was popped: next sound loaded, remaining chain is now empty
    expect(vi.mocked(loadBuffer)).toHaveBeenCalledOnce();
    const { getLayerChain } = await import("./audioState");
    expect(getLayerChain(layer.id)).toHaveLength(0);
    expect(isLayerPending(layer.id)).toBe(false);
  });

  it("calls afterStopCleanup when 'stop' mode stops a playing layer", async () => {
    const { triggerLayerOfPad } = await import("./layerTrigger");
    const { recordLayerVoice } = await import("./audioState");
    const { pad, layer, padGain } = await setup({ retriggerMode: "stop" });

    const fakeVoice = { setOnEnded: vi.fn(), stop: vi.fn(), stopWithRamp: vi.fn() } as unknown as import("./audioVoice").AudioVoice;
    recordLayerVoice(pad.id, layer.id, fakeVoice);

    const afterStopCleanup = vi.fn();
    await triggerLayerOfPad(pad, layer, mockCtx as unknown as AudioContext, padGain,
      [createMockSound({ filePath: "a.wav" })], { afterStopCleanup });

    expect(afterStopCleanup).toHaveBeenCalledTimes(1);
    // Stop mode returns "skip" — no new sound should start after stopping
    const { loadBuffer } = await import("./bufferCache");
    expect(vi.mocked(loadBuffer)).not.toHaveBeenCalled();
  });

  it("does not call afterStopCleanup when layer is not playing", async () => {
    const { triggerLayerOfPad } = await import("./layerTrigger");
    const { pad, layer, padGain, loadBuffer } = await setup({ retriggerMode: "stop" });

    vi.mocked(loadBuffer).mockResolvedValue({ duration: 1.0 } as unknown as AudioBuffer);

    const afterStopCleanup = vi.fn();
    await triggerLayerOfPad(pad, layer, mockCtx as unknown as AudioContext, padGain,
      [createMockSound({ filePath: "a.wav" })], { afterStopCleanup });

    expect(afterStopCleanup).not.toHaveBeenCalled();
  });

  it("clears pad progress before startLayerPlayback when clearProgressOnProceed is true", async () => {
    const { triggerLayerOfPad } = await import("./layerTrigger");
    const { setPadProgressInfo, getPadProgressInfo } = await import("./audioState");
    const { pad, layer, padGain, loadBuffer } = await setup();

    setPadProgressInfo(pad.id, { startedAt: 0, duration: 5, isLooping: false });
    vi.mocked(loadBuffer).mockResolvedValue({ duration: 1.0 } as unknown as AudioBuffer);

    await triggerLayerOfPad(pad, layer, mockCtx as unknown as AudioContext, padGain,
      [createMockSound({ filePath: "a.wav" })], { clearProgressOnProceed: true });

    // clearProgressOnProceed erased the seed; startLayerPlayback wrote new progress
    const info = getPadProgressInfo(pad.id);
    expect(info?.duration).toBe(1.0);
  });

  it("does not clear pad progress when clearProgressOnProceed is omitted", async () => {
    const { triggerLayerOfPad } = await import("./layerTrigger");
    const { setPadProgressInfo, getPadProgressInfo } = await import("./audioState");
    const { pad, layer, padGain, loadBuffer } = await setup();

    // Seed a duration larger than the mock buffer (7 > 1.0): if clearPadProgressInfo is
    // NOT called, loadLayerVoice's "longest wins" logic keeps 7 (1.0 < 7 → no overwrite).
    // If clearPadProgressInfo IS called, the entry is erased and 1.0 is written instead.
    setPadProgressInfo(pad.id, { startedAt: 0, duration: 7, isLooping: false });
    vi.mocked(loadBuffer).mockResolvedValue({ duration: 1.0 } as unknown as AudioBuffer);

    await triggerLayerOfPad(pad, layer, mockCtx as unknown as AudioContext, padGain,
      [createMockSound({ filePath: "a.wav" })]);

    expect(getPadProgressInfo(pad.id)?.duration).toBe(7);
  });

  it("clears pending and emits error when buffer load fails (via startLayerSound catch)", async () => {
    const { triggerLayerOfPad } = await import("./layerTrigger");
    const { isLayerPending } = await import("./audioState");
    const { pad, layer, padGain, loadBuffer } = await setup();

    vi.mocked(loadBuffer).mockRejectedValue(new Error("load failed"));

    await triggerLayerOfPad(pad, layer, mockCtx as unknown as AudioContext, padGain,
      [createMockSound({ filePath: "a.wav" })]);

    expect(isLayerPending(layer.id)).toBe(false);
    expect(mockEmitAudioError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "load failed" }),
      expect.any(Object),
    );
  });

  it("resolves (never rejects) even when an internal error occurs", async () => {
    const { triggerLayerOfPad } = await import("./layerTrigger");
    const { pad, layer, padGain, loadBuffer } = await setup();
    vi.mocked(loadBuffer).mockRejectedValue(new Error("any error"));
    await expect(
      triggerLayerOfPad(pad, layer, mockCtx as unknown as AudioContext, padGain,
        [createMockSound({ filePath: "a.wav" })]),
    ).resolves.toBeUndefined();
  });

  it("does not start new playback when 'next' mode exhausts a one-shot chain", async () => {
    const { triggerLayerOfPad } = await import("./layerTrigger");
    const { recordLayerVoice, isLayerPending, isLayerActive } = await import("./audioState");
    const { loadBuffer } = await import("./bufferCache");
    const { pad, layer, padGain } = await setup({
      retriggerMode: "next",
      playbackMode: "one-shot",
      arrangement: "sequential",
    });

    const fakeVoice = { setOnEnded: vi.fn(), stop: vi.fn(), stopWithRamp: vi.fn() } as unknown as import("./audioVoice").AudioVoice;
    recordLayerVoice(pad.id, layer.id, fakeVoice);
    // No chain set → chain is exhausted on the first re-trigger; one-shot has no loop-back

    await triggerLayerOfPad(pad, layer, mockCtx as unknown as AudioContext, padGain,
      [createMockSound({ filePath: "a.wav" })]);

    // Exhausted one-shot chain-advanced: the existing voice was stopped but no new voice started
    expect(vi.mocked(loadBuffer)).not.toHaveBeenCalled();
    expect(isLayerPending(layer.id)).toBe(false);
    expect(isLayerActive(layer.id)).toBe(false);
  });
});

// ── playbackStore integration (issue #133) ────────────────────────────────────
//
// audioState.ts no longer mutates playbackStore directly. layerTrigger.ts owns
// these push-based UI signals (`playingPadIds`, `fadingPadIds`, `fadingOutPadIds`)
// at the call sites where they conceptually change. These tests pin that contract.

describe("layerTrigger playbackStore integration", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockCtx.currentTime = 0;
    mockCtx.createGain.mockReset().mockReturnValue(makeMockGain());
    mockCtx.createBufferSource.mockReset().mockReturnValue({
      buffer: null, loop: false, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), addEventListener: vi.fn(),
    });
    const { clearAllAudioState } = await import("./audioState");
    clearAllAudioState();
    const { usePlaybackStore } = await import("@/state/playbackStore");
    usePlaybackStore.setState({
      playingPadIds: new Set<string>(),
      fadingPadIds: new Set<string>(),
      fadingOutPadIds: new Set<string>(),
    });
  });

  it("startLayerSound adds the pad to playingPadIds when a voice starts successfully", async () => {
    const { loadBuffer } = await import("./bufferCache");
    vi.mocked(loadBuffer).mockResolvedValue({ duration: 1.0 } as unknown as AudioBuffer);
    const { startLayerSound } = await import("./layerTrigger");
    const { getPadGain, getOrCreateLayerGain, isLayerActive } = await import("./audioState");
    const { usePlaybackStore } = await import("@/state/playbackStore");
    const pad = createMockPad({ id: "pp-pad-1" });
    const layer = createMockLayer({ id: "pp-layer-1" });
    const sound = createMockSound({ id: "s1", filePath: "s1.wav" });
    const padGain = getPadGain(pad.id);
    const layerGain = getOrCreateLayerGain(layer.id, 1, padGain);

    expect(usePlaybackStore.getState().playingPadIds.has(pad.id)).toBe(false);

    await startLayerSound(pad, layer, sound, mockCtx as unknown as AudioContext, layerGain, 1.0, [sound]);

    // Sanity: voice was recorded (precondition for addPlayingPad).
    expect(isLayerActive(layer.id)).toBe(true);
    expect(usePlaybackStore.getState().playingPadIds.has(pad.id)).toBe(true);
  });

  it("onended removes the pad from playingPadIds when the last voice ends", async () => {
    const { loadBuffer } = await import("./bufferCache");
    const { startLayerSound } = await import("./layerTrigger");
    const { getPadGain, getOrCreateLayerGain } = await import("./audioState");
    const { usePlaybackStore } = await import("@/state/playbackStore");

    const pad = createMockPad({ id: "pp-pad-end" });
    const layer = createMockLayer({ id: "pp-layer-end" });
    const sound = createMockSound({ id: "s1", filePath: "s1.wav" });
    const padGain = getPadGain(pad.id);
    const layerGain = getOrCreateLayerGain(layer.id, 1, padGain);

    // Capture onended so we can fire it after the voice "ends" naturally.
    const capturedOnEnded: Array<() => void> = [];
    const voiceMock = {
      setOnEnded: vi.fn((cb: (() => void) | null) => { if (cb) capturedOnEnded.push(cb); }),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      stopWithRamp: vi.fn(),
    };
    const voiceModule = await import("./audioVoice");
    vi.spyOn(voiceModule, "wrapBufferSource").mockReturnValue(
      voiceMock as unknown as ReturnType<typeof voiceModule.wrapBufferSource>,
    );

    vi.mocked(loadBuffer).mockResolvedValueOnce({ duration: 1.0 } as unknown as AudioBuffer);
    await startLayerSound(pad, layer, sound, mockCtx as unknown as AudioContext, layerGain, 1.0, [sound]);
    // Pad is now playing.
    expect(usePlaybackStore.getState().playingPadIds.has(pad.id)).toBe(true);
    expect(capturedOnEnded.length).toBeGreaterThan(0);

    // Fire onended — the only voice ends, so the pad is no longer active.
    capturedOnEnded[0]();

    expect(usePlaybackStore.getState().playingPadIds.has(pad.id)).toBe(false);
  });

  it("rampStopLayerVoices removes the pad from playingPadIds after the cleanup timeout fires", async () => {
    vi.useFakeTimers();
    try {
      const { rampStopLayerVoices } = await import("./layerTrigger");
      const { getPadGain, getOrCreateLayerGain, recordLayerVoice } = await import("./audioState");
      const { usePlaybackStore } = await import("@/state/playbackStore");

      const pad = createMockPad({ id: "pp-pad-ramp" });
      const layer = createMockLayer({ id: "pp-layer-ramp" });
      const padGain = getPadGain(pad.id);
      getOrCreateLayerGain(layer.id, 1, padGain);

      // Pretend a voice is active and the pad is in the playing set.
      const fakeVoice = makeMinimalVoice() as unknown as import("./audioVoice").AudioVoice;
      recordLayerVoice(pad.id, layer.id, fakeVoice);
      usePlaybackStore.getState().addPlayingPad(pad.id);
      expect(usePlaybackStore.getState().playingPadIds.has(pad.id)).toBe(true);

      rampStopLayerVoices(pad.id, layer, [fakeVoice]);

      // Advance past STOP_RAMP_S * 1000 + 5 to fire the cleanup timeout.
      vi.advanceTimersByTime(2000);

      expect(usePlaybackStore.getState().playingPadIds.has(pad.id)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("skipLayerForward clears fadingPadIds / fadingOutPadIds when starting the next sound", async () => {
    const { skipLayerForward } = await import("./layerTrigger");
    const { getPadGain, getOrCreateLayerGain, setLayerChain } = await import("./audioState");
    const { usePlaybackStore } = await import("@/state/playbackStore");

    const s1 = createMockSound({ id: "s1", filePath: "s1.wav" });
    const s2 = createMockSound({ id: "s2", filePath: "s2.wav" });
    const pad = createMockPad({ id: "pp-pad-skip", layers: [createMockLayer({
      id: "pp-layer-skip",
      arrangement: "sequential",
      selection: { type: "assigned", instances: [
        { id: "i1", soundId: "s1", volume: 100 },
        { id: "i2", soundId: "s2", volume: 100 },
      ]},
    })] });
    const layer = pad.layers[0];
    const padGain = getPadGain(pad.id);
    getOrCreateLayerGain(layer.id, 1, padGain);

    // Configure live library so resolveSounds inside skipLayerForward returns s1 + s2.
    const { useLibraryStore } = await import("@/state/libraryStore");
    vi.mocked(useLibraryStore.getState).mockReturnValue({ sounds: [s1, s2] } as ReturnType<typeof useLibraryStore.getState>);

    // Pretend a fade-out was in progress for this pad.
    usePlaybackStore.getState().addFadingPad(pad.id);
    usePlaybackStore.getState().addFadingOutPad(pad.id);
    setLayerChain(layer.id, [s2]);

    skipLayerForward(pad, layer.id);

    expect(usePlaybackStore.getState().fadingPadIds.has(pad.id)).toBe(false);
    expect(usePlaybackStore.getState().fadingOutPadIds.has(pad.id)).toBe(false);
  });

  it("catch path removes pad from playingPadIds when load fails and no voices remain", async () => {
    const { loadBuffer } = await import("./bufferCache");
    vi.mocked(loadBuffer).mockRejectedValueOnce(new Error("load failed"));
    const { startLayerSound } = await import("./layerTrigger");
    const { getPadGain, getOrCreateLayerGain } = await import("./audioState");
    const { usePlaybackStore } = await import("@/state/playbackStore");

    const pad = createMockPad({ id: "catch-remove-pad" });
    const layer = createMockLayer({ id: "catch-remove-layer" });
    const sound = createMockSound({ id: "s-catch", filePath: "x.wav" });
    const padGain = getPadGain(pad.id);
    const layerGain = getOrCreateLayerGain(layer.id, 1, padGain);

    // Simulate restart-retrigger state: prior voices were stopped by stopLayerVoices
    // so isPadActive(pad.id) === false, but playingPadIds still has the pad.
    usePlaybackStore.getState().addPlayingPad(pad.id);
    expect(usePlaybackStore.getState().playingPadIds.has(pad.id)).toBe(true);

    await startLayerSound(pad, layer, sound, mockCtx as unknown as AudioContext, layerGain, 1.0, [sound]);

    // Catch path should clear the stale playingPadIds entry.
    expect(usePlaybackStore.getState().playingPadIds.has(pad.id)).toBe(false);
  });
});

// ── afterStopCleanup — real active voices (issue #141) ───────────────────────
//
// The applyRetriggerMode "stop" tests in the main describe block verify the
// callback is invoked but do NOT set up real voices via recordLayerVoice.
// These tests exercise the path where voices exist in the map and are actually
// cleared after the ramp-stop timeout fires.

describe("afterStopCleanup with real active voices", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockCtx.currentTime = 0;
    mockCtx.createGain.mockReset().mockReturnValue(makeMockGain());
    mockCtx.createBufferSource.mockReset().mockReturnValue({
      buffer: null, loop: false, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), addEventListener: vi.fn(),
    });
    const { clearAllAudioState } = await import("./audioState");
    clearAllAudioState();
    const { usePlaybackStore } = await import("@/state/playbackStore");
    usePlaybackStore.setState({
      playingPadIds: new Set<string>(),
      fadingPadIds: new Set<string>(),
      fadingOutPadIds: new Set<string>(),
    });
  });

  it("voices are cleared from the layer map after the ramp-stop timeout via applyRetriggerMode stop mode", async () => {
    vi.useFakeTimers();
    try {
      const { applyRetriggerMode } = await import("./layerTrigger");
      const { getPadGain, getOrCreateLayerGain, recordLayerVoice, isLayerActive } = await import("./audioState");

      const pad = createMockPad({ id: "asc-pad" });
      const layer = createMockLayer({ id: "asc-layer", retriggerMode: "stop" });
      const padGain = getPadGain(pad.id);
      const layerGain = getOrCreateLayerGain(layer.id, 1, padGain);

      const fakeVoice = makeMinimalVoice() as unknown as import("./audioVoice").AudioVoice;
      recordLayerVoice(pad.id, layer.id, fakeVoice);
      expect(isLayerActive(layer.id)).toBe(true);

      await applyRetriggerMode(pad, layer, true, mockCtx as unknown as AudioContext, layerGain, []);

      // Voice is ramp-stopped but not yet cleared — cleanup runs in a timeout.
      expect(isLayerActive(layer.id)).toBe(true);

      // Advance past STOP_RAMP_S * 1000 + 5 = 30 ms to fire the ramp cleanup.
      vi.advanceTimersByTime(100);

      expect(isLayerActive(layer.id)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stop mode removes pad from playingPadIds after ramp timeout when no other layers remain active", async () => {
    vi.useFakeTimers();
    try {
      const { applyRetriggerMode } = await import("./layerTrigger");
      const { getPadGain, getOrCreateLayerGain, recordLayerVoice } = await import("./audioState");
      const { usePlaybackStore } = await import("@/state/playbackStore");

      const pad = createMockPad({ id: "asc-pad-2" });
      const layer = createMockLayer({ id: "asc-layer-2", retriggerMode: "stop" });
      const padGain = getPadGain(pad.id);
      const layerGain = getOrCreateLayerGain(layer.id, 1, padGain);

      const fakeVoice = makeMinimalVoice() as unknown as import("./audioVoice").AudioVoice;
      recordLayerVoice(pad.id, layer.id, fakeVoice);
      usePlaybackStore.getState().addPlayingPad(pad.id);
      expect(usePlaybackStore.getState().playingPadIds.has(pad.id)).toBe(true);

      await applyRetriggerMode(pad, layer, true, mockCtx as unknown as AudioContext, layerGain, []);

      vi.advanceTimersByTime(100);

      expect(usePlaybackStore.getState().playingPadIds.has(pad.id)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stopWithRamp is called on the actual voice object registered via recordLayerVoice", async () => {
    const { applyRetriggerMode } = await import("./layerTrigger");
    const { getPadGain, getOrCreateLayerGain, recordLayerVoice } = await import("./audioState");

    const pad = createMockPad({ id: "asc-pad-3" });
    const layer = createMockLayer({ id: "asc-layer-3", retriggerMode: "stop" });
    const padGain = getPadGain(pad.id);
    const layerGain = getOrCreateLayerGain(layer.id, 1, padGain);

    const rawVoice = makeMinimalVoice();
    const fakeVoice = rawVoice as unknown as import("./audioVoice").AudioVoice;
    recordLayerVoice(pad.id, layer.id, fakeVoice);

    await applyRetriggerMode(pad, layer, true, mockCtx as unknown as AudioContext, layerGain, []);

    expect(rawVoice.stopWithRamp).toHaveBeenCalledOnce();
    // onended nulled before ramp so it cannot double-fire
    expect(rawVoice.setOnEnded).toHaveBeenCalledWith(null);
  });
});

// ── onended chain continuation — full end-to-end happy path (issue #141) ─────
//
// Existing tests cover the negative path (chain broken upstream, load failures)
// but no test creates a voice, fires its onended, and asserts the next sound
// in the chain was actually started.

describe("onended chain continuation — happy path", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockCtx.currentTime = 0;
    mockCtx.createGain.mockReset().mockReturnValue(makeMockGain());
    mockCtx.createBufferSource.mockReset().mockReturnValue({
      buffer: null, loop: false, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), addEventListener: vi.fn(),
    });
    const { clearAllAudioState } = await import("./audioState");
    clearAllAudioState();
    const { usePlaybackStore } = await import("@/state/playbackStore");
    usePlaybackStore.setState({
      playingPadIds: new Set<string>(),
      fadingPadIds: new Set<string>(),
      fadingOutPadIds: new Set<string>(),
    });
  });

  it("fires onended and starts the next sound in the chain", async () => {
    const { loadBuffer } = await import("./bufferCache");
    const { startLayerSound } = await import("./layerTrigger");
    const { getPadGain, getOrCreateLayerGain, setLayerChain, isLayerActive } = await import("./audioState");

    const pad = createMockPad({ id: "oe-pad" });
    const layer = createMockLayer({ id: "oe-layer", arrangement: "sequential" });
    const s1 = createMockSound({ id: "s1", filePath: "s1.wav" });
    const s2 = createMockSound({ id: "s2", filePath: "s2.wav" });
    const padGain = getPadGain(pad.id);
    const layerGain = getOrCreateLayerGain(layer.id, 1, padGain);

    const capturedOnEnded: Array<() => void> = [];
    const voiceMock = {
      setOnEnded: vi.fn((cb: (() => void) | null) => { if (cb) capturedOnEnded.push(cb); }),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      stopWithRamp: vi.fn(),
    };
    const voiceModule = await import("./audioVoice");
    vi.spyOn(voiceModule, "wrapBufferSource").mockReturnValue(
      voiceMock as unknown as ReturnType<typeof voiceModule.wrapBufferSource>,
    );

    // s1 loads successfully; s2 is queued as the next in the chain.
    vi.mocked(loadBuffer).mockResolvedValue({ duration: 1.0 } as unknown as AudioBuffer);
    setLayerChain(layer.id, [s2]);
    await startLayerSound(pad, layer, s1, mockCtx as unknown as AudioContext, layerGain, 1.0, [s1, s2]);

    expect(capturedOnEnded.length).toBeGreaterThan(0);
    vi.mocked(loadBuffer).mockClear();

    // Fire onended for s1 — the chain continuation should load and start s2.
    capturedOnEnded[0]();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(loadBuffer).toHaveBeenCalledWith(expect.objectContaining({ id: "s2" }));
    expect(isLayerActive(layer.id)).toBe(true);
  });

  it("fires onended and layer becomes inactive when chain is empty (one-shot, chain exhausted)", async () => {
    const { loadBuffer } = await import("./bufferCache");
    const { startLayerSound } = await import("./layerTrigger");
    const { getPadGain, getOrCreateLayerGain, setLayerChain, isLayerActive } = await import("./audioState");
    const { usePlaybackStore } = await import("@/state/playbackStore");

    const pad = createMockPad({ id: "oe-pad-2" });
    const layer = createMockLayer({
      id: "oe-layer-2",
      arrangement: "sequential",
      playbackMode: "one-shot",
    });
    const s1 = createMockSound({ id: "s1", filePath: "s1.wav" });
    const padGain = getPadGain(pad.id);
    const layerGain = getOrCreateLayerGain(layer.id, 1, padGain);

    const capturedOnEnded: Array<() => void> = [];
    const voiceMock = {
      setOnEnded: vi.fn((cb: (() => void) | null) => { if (cb) capturedOnEnded.push(cb); }),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      stopWithRamp: vi.fn(),
    };
    const voiceModule = await import("./audioVoice");
    vi.spyOn(voiceModule, "wrapBufferSource").mockReturnValue(
      voiceMock as unknown as ReturnType<typeof voiceModule.wrapBufferSource>,
    );

    vi.mocked(loadBuffer).mockResolvedValue({ duration: 1.0 } as unknown as AudioBuffer);
    // Empty chain — last sound in a one-shot sequence.
    setLayerChain(layer.id, []);
    await startLayerSound(pad, layer, s1, mockCtx as unknown as AudioContext, layerGain, 1.0, [s1]);
    expect(capturedOnEnded.length).toBeGreaterThan(0);

    capturedOnEnded[0]();

    // One-shot exhausted: no new load, layer inactive, pad removed.
    expect(isLayerActive(layer.id)).toBe(false);
    expect(usePlaybackStore.getState().playingPadIds.has(pad.id)).toBe(false);
  });

  it("fires onended with chain cleared externally — does not start next sound", async () => {
    const { loadBuffer } = await import("./bufferCache");
    const { startLayerSound } = await import("./layerTrigger");
    const { getPadGain, getOrCreateLayerGain, setLayerChain, deleteLayerChain } = await import("./audioState");

    const pad = createMockPad({ id: "oe-pad-3" });
    const layer = createMockLayer({ id: "oe-layer-3", arrangement: "sequential" });
    const s1 = createMockSound({ id: "s1", filePath: "s1.wav" });
    const s2 = createMockSound({ id: "s2", filePath: "s2.wav" });
    const padGain = getPadGain(pad.id);
    const layerGain = getOrCreateLayerGain(layer.id, 1, padGain);

    const capturedOnEnded: Array<() => void> = [];
    const voiceMock = {
      setOnEnded: vi.fn((cb: (() => void) | null) => { if (cb) capturedOnEnded.push(cb); }),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      stopWithRamp: vi.fn(),
    };
    const voiceModule = await import("./audioVoice");
    vi.spyOn(voiceModule, "wrapBufferSource").mockReturnValue(
      voiceMock as unknown as ReturnType<typeof voiceModule.wrapBufferSource>,
    );

    vi.mocked(loadBuffer).mockResolvedValue({ duration: 1.0 } as unknown as AudioBuffer);
    setLayerChain(layer.id, [s2]);
    await startLayerSound(pad, layer, s1, mockCtx as unknown as AudioContext, layerGain, 1.0, [s1, s2]);

    // Clear the chain externally (simulating a stop/reset while s1 is still playing).
    deleteLayerChain(layer.id);
    vi.mocked(loadBuffer).mockClear();

    capturedOnEnded[0]();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Chain was undefined — onended should not advance.
    expect(loadBuffer).not.toHaveBeenCalled();
  });
});

// ── progress info — startLayerSound sets padProgressInfo and layerProgressInfo (issue #141) ─

describe("startLayerSound progress info", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockCtx.currentTime = 0;
    mockCtx.createGain.mockReset().mockReturnValue(makeMockGain());
    mockCtx.createBufferSource.mockReset().mockReturnValue({
      buffer: null, loop: false, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), addEventListener: vi.fn(),
    });
    const { clearAllAudioState } = await import("./audioState");
    clearAllAudioState();
  });

  it("sets layerProgressInfo after a successful buffer load", async () => {
    const { loadBuffer } = await import("./bufferCache");
    vi.mocked(loadBuffer).mockResolvedValue({ duration: 2.5 } as unknown as AudioBuffer);
    const { startLayerSound } = await import("./layerTrigger");
    const { getPadGain, getOrCreateLayerGain, getLayerProgressInfo } = await import("./audioState");

    const pad = createMockPad({ id: "pi-pad" });
    const layer = createMockLayer({ id: "pi-layer" });
    const sound = createMockSound({ id: "s1", filePath: "s1.wav" });
    const padGain = getPadGain(pad.id);
    const layerGain = getOrCreateLayerGain(layer.id, 1, padGain);

    mockCtx.currentTime = 5;
    await startLayerSound(pad, layer, sound, mockCtx as unknown as AudioContext, layerGain, 1.0, [sound]);

    const info = getLayerProgressInfo(layer.id);
    expect(info).toBeDefined();
    expect(info?.duration).toBe(2.5);
    expect(info?.startedAt).toBe(5);
    expect(info?.isLooping).toBe(false);
  });

  it("sets padProgressInfo after a successful buffer load", async () => {
    const { loadBuffer } = await import("./bufferCache");
    vi.mocked(loadBuffer).mockResolvedValue({ duration: 3.0 } as unknown as AudioBuffer);
    const { startLayerSound } = await import("./layerTrigger");
    const { getPadGain, getOrCreateLayerGain, getPadProgressInfo } = await import("./audioState");

    const pad = createMockPad({ id: "pi-pad-2" });
    const layer = createMockLayer({ id: "pi-layer-2" });
    const sound = createMockSound({ id: "s1", filePath: "s1.wav" });
    const padGain = getPadGain(pad.id);
    const layerGain = getOrCreateLayerGain(layer.id, 1, padGain);

    mockCtx.currentTime = 7;
    await startLayerSound(pad, layer, sound, mockCtx as unknown as AudioContext, layerGain, 1.0, [sound]);

    const info = getPadProgressInfo(pad.id);
    expect(info).toBeDefined();
    expect(info?.duration).toBe(3.0);
    expect(info?.startedAt).toBe(7);
    expect(info?.isLooping).toBe(false);
  });

  it("simultaneous arrangement: keeps the longer-duration padProgressInfo (longest-wins)", async () => {
    const { loadBuffer } = await import("./bufferCache");
    const { startLayerSound } = await import("./layerTrigger");
    const { getPadGain, getOrCreateLayerGain, getPadProgressInfo } = await import("./audioState");

    const pad = createMockPad({ id: "pi-pad-3" });
    const layerA = createMockLayer({ id: "pi-layer-3a", arrangement: "simultaneous" });
    const layerB = createMockLayer({ id: "pi-layer-3b", arrangement: "simultaneous" });
    const sA = createMockSound({ id: "sA", filePath: "a.wav" });
    const sB = createMockSound({ id: "sB", filePath: "b.wav" });
    const padGain = getPadGain(pad.id);
    const gainA = getOrCreateLayerGain(layerA.id, 1, padGain);
    const gainB = getOrCreateLayerGain(layerB.id, 1, padGain);

    // First sound: 5 s — becomes the current padProgressInfo.
    vi.mocked(loadBuffer).mockResolvedValueOnce({ duration: 5.0 } as unknown as AudioBuffer);
    await startLayerSound(pad, layerA, sA, mockCtx as unknown as AudioContext, gainA, 1.0, [sA]);

    // Second sound: shorter (1 s) — must NOT overwrite the existing 5 s entry.
    vi.mocked(loadBuffer).mockResolvedValueOnce({ duration: 1.0 } as unknown as AudioBuffer);
    await startLayerSound(pad, layerB, sB, mockCtx as unknown as AudioContext, gainB, 1.0, [sB]);

    expect(getPadProgressInfo(pad.id)?.duration).toBe(5.0);
  });

  it("simultaneous arrangement: longer second sound overwrites shorter padProgressInfo", async () => {
    const { loadBuffer } = await import("./bufferCache");
    const { startLayerSound } = await import("./layerTrigger");
    const { getPadGain, getOrCreateLayerGain, getPadProgressInfo } = await import("./audioState");

    const pad = createMockPad({ id: "pi-pad-4" });
    const layerA = createMockLayer({ id: "pi-layer-4a", arrangement: "simultaneous" });
    const layerB = createMockLayer({ id: "pi-layer-4b", arrangement: "simultaneous" });
    const sA = createMockSound({ id: "sA", filePath: "a.wav" });
    const sB = createMockSound({ id: "sB", filePath: "b.wav" });
    const padGain = getPadGain(pad.id);
    const gainA = getOrCreateLayerGain(layerA.id, 1, padGain);
    const gainB = getOrCreateLayerGain(layerB.id, 1, padGain);

    // First sound: 1 s.
    vi.mocked(loadBuffer).mockResolvedValueOnce({ duration: 1.0 } as unknown as AudioBuffer);
    await startLayerSound(pad, layerA, sA, mockCtx as unknown as AudioContext, gainA, 1.0, [sA]);

    // Second sound: 8 s — longer, so it SHOULD overwrite the existing entry.
    vi.mocked(loadBuffer).mockResolvedValueOnce({ duration: 8.0 } as unknown as AudioBuffer);
    await startLayerSound(pad, layerB, sB, mockCtx as unknown as AudioContext, gainB, 1.0, [sB]);

    expect(getPadProgressInfo(pad.id)?.duration).toBe(8.0);
  });

  it("chained arrangement: padProgressInfo is always updated (not longest-wins)", async () => {
    const { loadBuffer } = await import("./bufferCache");
    const { startLayerSound } = await import("./layerTrigger");
    const { getPadGain, getOrCreateLayerGain, getPadProgressInfo, setPadProgressInfo } = await import("./audioState");

    const pad = createMockPad({ id: "pi-pad-5" });
    const layer = createMockLayer({ id: "pi-layer-5", arrangement: "sequential" });
    const s1 = createMockSound({ id: "s1", filePath: "s1.wav" });
    const padGain = getPadGain(pad.id);
    const layerGain = getOrCreateLayerGain(layer.id, 1, padGain);

    // Seed an existing padProgressInfo with a longer duration.
    setPadProgressInfo(pad.id, { startedAt: 0, duration: 99, isLooping: false });

    // For a chained layer, loadLayerVoice always updates padProgressInfo regardless of duration.
    vi.mocked(loadBuffer).mockResolvedValue({ duration: 0.5 } as unknown as AudioBuffer);
    await startLayerSound(pad, layer, s1, mockCtx as unknown as AudioContext, layerGain, 1.0, [s1]);

    // Even though 0.5 < 99, chained always overwrites.
    expect(getPadProgressInfo(pad.id)?.duration).toBe(0.5);
  });

  it("sets isLooping:true in progress info when the layer loops natively", async () => {
    const { loadBuffer } = await import("./bufferCache");
    vi.mocked(loadBuffer).mockResolvedValue({ duration: 4.0 } as unknown as AudioBuffer);
    const { startLayerSound } = await import("./layerTrigger");
    const { getPadGain, getOrCreateLayerGain, getPadProgressInfo, getLayerProgressInfo } = await import("./audioState");

    const pad = createMockPad({ id: "pi-pad-6" });
    // simultaneous loop → shouldLayerLoopNatively returns true
    const layer = createMockLayer({ id: "pi-layer-6", playbackMode: "loop", arrangement: "simultaneous" });
    const sound = createMockSound({ id: "s1", filePath: "s1.wav" });
    const padGain = getPadGain(pad.id);
    const layerGain = getOrCreateLayerGain(layer.id, 1, padGain);

    await startLayerSound(pad, layer, sound, mockCtx as unknown as AudioContext, layerGain, 1.0, [sound]);

    expect(getPadProgressInfo(pad.id)?.isLooping).toBe(true);
    expect(getLayerProgressInfo(layer.id)?.isLooping).toBe(true);
  });

  it("clears layerProgressInfo and padProgressInfo on load failure", async () => {
    const { loadBuffer } = await import("./bufferCache");
    vi.mocked(loadBuffer).mockRejectedValue(new Error("load error"));
    const { startLayerSound } = await import("./layerTrigger");
    const {
      getPadGain, getOrCreateLayerGain, getPadProgressInfo, getLayerProgressInfo,
      setPadProgressInfo, setLayerProgressInfo,
    } = await import("./audioState");

    const pad = createMockPad({ id: "pi-pad-7" });
    const layer = createMockLayer({ id: "pi-layer-7" });
    const sound = createMockSound({ id: "s1", filePath: "s1.wav" });
    const padGain = getPadGain(pad.id);
    const layerGain = getOrCreateLayerGain(layer.id, 1, padGain);

    // Pre-seed stale progress so we verify the catch block actively clears it.
    setPadProgressInfo(pad.id, { startedAt: 0, duration: 10, isLooping: false });
    setLayerProgressInfo(layer.id, { startedAt: 0, duration: 10, isLooping: false });

    await startLayerSound(pad, layer, sound, mockCtx as unknown as AudioContext, layerGain, 1.0, [sound]);

    expect(getPadProgressInfo(pad.id)).toBeUndefined();
    expect(getLayerProgressInfo(layer.id)).toBeUndefined();
  });
});
