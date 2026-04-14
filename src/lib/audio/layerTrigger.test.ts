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

    // ── Cycle cursor: "stop" mode ─────────────────────────────────────────────

    it("advances cycle cursor in 'stop' mode when cycleMode is on", async () => {
      const { applyRetriggerMode } = await import("./layerTrigger");
      const { getPadGain, getOrCreateLayerGain, setLayerCycleIndex, getLayerCycleIndex } = await import("./audioState");
      const padGain = getPadGain("pad-cyc-stop");
      const layerGain = getOrCreateLayerGain("layer-cyc-stop", 100, padGain);
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
      const layerGain = getOrCreateLayerGain("layer-cyc-stop-wrap", 100, padGain);
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
      const layerGain = getOrCreateLayerGain("layer-cyc-restart", 100, padGain);
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
      const layerGain = getOrCreateLayerGain("layer-cyc-restart-wrap", 100, padGain);
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
      const layerGain = getOrCreateLayerGain("layer-next-rem", 100, padGain);
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
      const padGain = getPadGain("pad-next-exhaust");
      const layerGain = getOrCreateLayerGain("layer-next-exhaust", 100, padGain);
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

      const result = await applyRetriggerMode(pad, layer, true, mockCtx as unknown as AudioContext, layerGain, [s1]);

      expect(result).toBe("chain-advanced");
      expect(mockVoice.stop).toHaveBeenCalled(); // voice was stopped
      expect(isLayerActive("layer-next-exhaust")).toBe(false);
    });

    it("'next' mode with loop + exhausted queue loops back to beginning", async () => {
      const { applyRetriggerMode } = await import("./layerTrigger");
      const { loadBuffer } = await import("./bufferCache");
      const { getPadGain, getOrCreateLayerGain, setLayerChain, recordLayerVoice, isLayerActive } = await import("./audioState");
      const padGain = getPadGain("pad-next-loop");
      const layerGain = getOrCreateLayerGain("layer-next-loop", 100, padGain);
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
      const layerGain = getOrCreateLayerGain("layer-next-cycle", 100, padGain);
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

    it("chained arrangement: starts first sound and queues remainder", async () => {
      const { startLayerPlayback } = await import("./layerTrigger");
      const { getPadGain, getOrCreateLayerGain, isLayerActive, getLayerChain } = await import("./audioState");
      const padGain = getPadGain("pad-chain");
      const layerGain = getOrCreateLayerGain("layer-chain", 100, padGain);
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
      const layerGain = getOrCreateLayerGain("layer-cycle", 100, padGain);
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
      const layerGain = getOrCreateLayerGain("layer-cycle-end", 100, padGain);
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
    const layerGain = getOrCreateLayerGain(layer.id, 100, padGain);

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
    const layerGain = getOrCreateLayerGain(layer.id, 100, padGain);

    await startLayerSound(pad, layer, sound, mockCtx as unknown as AudioContext, layerGain, 1.0, [sound]);

    expect(mockEmitAudioError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "decode failed" }),
      expect.objectContaining({ isMissingFile: false, soundName: "snare" }),
    );
  });
});
