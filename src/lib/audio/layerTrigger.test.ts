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
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/state/libraryStore", () => ({
  useLibraryStore: { getState: vi.fn(() => ({ sounds: [] })) },
}));
vi.mock("@/state/appSettingsStore", () => ({
  useAppSettingsStore: { getState: vi.fn(() => ({ settings: null })) },
}));
vi.mock("@/state/projectStore", () => ({
  useProjectStore: { getState: vi.fn(() => ({ project: null })) },
}));
vi.mock("@/lib/library.reconcile", () => ({
  checkMissingStatus: vi.fn(),
}));

function makeMockGain() {
  return {
    gain: { value: 1.0, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
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
    const { clearAllPadGains, clearAllLayerGains, clearAllLayerChains, clearAllFadeTracking, clearAllVoices } = await import("./audioState");
    clearAllPadGains();
    clearAllLayerGains();
    clearAllLayerChains();
    clearAllFadeTracking();
    clearAllVoices();
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
  });

  // ── applyRetriggerMode ────────────────────────────────────────────────────

  describe("applyRetriggerMode", () => {
    async function setup() {
      const { getPadGain, getOrCreateLayerGain } = await import("./audioState");
      const padGain = getPadGain("pad-r");
      const layerGain = getOrCreateLayerGain("layer-r", 100, padGain);
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
  });

  // ── startLayerPlayback ────────────────────────────────────────────────────

  describe("startLayerPlayback", () => {
    it("starts simultaneous sounds for non-chained arrangement", async () => {
      const { startLayerPlayback } = await import("./layerTrigger");
      const { getPadGain, getOrCreateLayerGain, isLayerActive } = await import("./audioState");
      const padGain = getPadGain("pad-slp");
      const layerGain = getOrCreateLayerGain("layer-slp", 100, padGain);
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
  });
});
