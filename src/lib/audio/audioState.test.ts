import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockCtx = {
  currentTime: 0,
  createGain: vi.fn(),
};

vi.mock("./audioContext", () => ({
  getAudioContext: vi.fn(() => mockCtx),
  getMasterGain: vi.fn(() => ({ connect: vi.fn() })),
}));

const mockPlaybackState = {
  addPlayingPad: vi.fn(),
  removePlayingPad: vi.fn(),
  clearAllPlayingPads: vi.fn(),
};

vi.mock("@/state/playbackStore", () => ({
  usePlaybackStore: {
    getState: vi.fn(() => mockPlaybackState),
  },
}));

function makeMockGain() {
  return {
    gain: {
      value: 1,
      setValueAtTime: vi.fn(),
      cancelScheduledValues: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

// ── Imports (after mocks) ────────────────────────────────────────────────────

import {
  getPadProgress,
  getPadGain,
  getOrCreateLayerGain,
  cancelPadFade,
  clearAllFadeTracking,
  clearAllPadGains,
  clearAllLayerGains,
  clearAllLayerChains,
  clearAllLayerCycleIndexes,
  clearAllStreamingAudio,
  clearAllPadProgressInfo,
  clearAllLayerPending,
  clearAllVoices,
  setPadProgressInfo,
  registerStreamingAudio,
  isPadFadingOut,
  isPadFading,
  addFadingOutPad,
  setFadePadTimeout,
  getLayerCycleIndex,
  setLayerCycleIndex,
  deleteLayerCycleIndex,
  recordVoice,
  clearVoice,
  recordLayerVoice,
  clearLayerVoice,
  stopPadVoices,
  stopAllVoices,
  stopLayerVoices,
  getLayerVoices,
  nullAllOnEnded,
  isPadActive,
  isLayerActive,
  forEachActivePadGain,
  getActivePadCount,
  forEachActiveLayerGain,
  getActiveLayerIdSet,
  computeAllPadProgress,
} from "./audioState";
import type { AudioVoice } from "./audioVoice";

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockCtx.currentTime = 0;
  mockCtx.createGain.mockImplementation(() => makeMockGain());
  clearAllPadGains();
  clearAllLayerGains();
  clearAllLayerChains();
  clearAllLayerCycleIndexes();
  clearAllStreamingAudio();
  clearAllPadProgressInfo();
  clearAllLayerPending();
  clearAllFadeTracking();
  clearAllVoices();
});

// ── getPadProgress ───────────────────────────────────────────────────────────

describe("getPadProgress", () => {
  it("returns elapsed/duration clamped to [0,1] for non-looping buffer path", () => {
    setPadProgressInfo("pad-1", { startedAt: 0, duration: 4, isLooping: false });

    mockCtx.currentTime = 2;
    expect(getPadProgress("pad-1")).toBeCloseTo(0.5);

    // Clamped at 1 when elapsed exceeds duration
    mockCtx.currentTime = 10;
    expect(getPadProgress("pad-1")).toBe(1);
  });

  it("returns elapsed % duration / duration for looping buffer path", () => {
    setPadProgressInfo("pad-1", { startedAt: 0, duration: 4, isLooping: true });

    mockCtx.currentTime = 2;
    expect(getPadProgress("pad-1")).toBeCloseTo(0.5);

    // Wraps around via modulo
    mockCtx.currentTime = 5;
    // elapsed=5, 5%4=1, 1/4=0.25
    expect(getPadProgress("pad-1")).toBeCloseTo(0.25);
  });

  it("returns progress from the streaming element with the longest duration", () => {
    const audio1 = {
      duration: 10,
      currentTime: 3,
    } as unknown as HTMLAudioElement;
    const audio2 = {
      duration: 20,
      currentTime: 5,
    } as unknown as HTMLAudioElement;

    registerStreamingAudio("pad-1", "layer-1", audio1);
    registerStreamingAudio("pad-1", "layer-2", audio2);

    // Should pick audio2 (longest duration=20), progress = 5/20 = 0.25
    expect(getPadProgress("pad-1")).toBeCloseTo(0.25);
  });

  it("returns null when no progress info and no streaming audio", () => {
    expect(getPadProgress("pad-1")).toBeNull();
  });

  it("returns 0 when streaming element duration is not yet known", () => {
    const audio = {
      duration: NaN,
      currentTime: 0,
    } as unknown as HTMLAudioElement;

    registerStreamingAudio("pad-1", "layer-1", audio);
    expect(getPadProgress("pad-1")).toBe(0);
  });
});

// ── getPadGain ───────────────────────────────────────────────────────────────

describe("getPadGain", () => {
  it("creates a GainNode on first call", () => {
    const gain = getPadGain("pad-1");
    expect(gain).toBeDefined();
    expect(gain.connect).toBeDefined();
    expect(mockCtx.createGain).toHaveBeenCalledTimes(1);
  });

  it("returns the same GainNode on subsequent calls", () => {
    const gain1 = getPadGain("pad-1");
    const gain2 = getPadGain("pad-1");
    expect(gain1).toBe(gain2);
    // Only one createGain call — second call reuses cached node
    expect(mockCtx.createGain).toHaveBeenCalledTimes(1);
  });

  it("creates separate GainNodes for different pads", () => {
    const gain1 = getPadGain("pad-1");
    const gain2 = getPadGain("pad-2");
    expect(gain1).not.toBe(gain2);
    expect(mockCtx.createGain).toHaveBeenCalledTimes(2);
  });
});

// ── clearAllPadGains ─────────────────────────────────────────────────────────

describe("clearAllPadGains", () => {
  it("disconnects all pad gain nodes before clearing", () => {
    const gain1 = getPadGain("pad-1");
    const gain2 = getPadGain("pad-2");

    clearAllPadGains();

    expect(gain1.disconnect).toHaveBeenCalledTimes(1);
    expect(gain2.disconnect).toHaveBeenCalledTimes(1);
  });

  it("empties the map so a subsequent getPadGain call creates a new node", () => {
    const first = getPadGain("pad-1");
    clearAllPadGains();
    const second = getPadGain("pad-1");
    expect(second).not.toBe(first);
  });

  it("is safe to call on an empty map", () => {
    expect(() => clearAllPadGains()).not.toThrow();
  });
});

// ── clearAllLayerGains ───────────────────────────────────────────────────────

describe("clearAllLayerGains", () => {
  it("disconnects all layer gain nodes before clearing", () => {
    const padGain = getPadGain("pad-1");
    const layerGain1 = getOrCreateLayerGain("layer-1", 80, padGain);
    const layerGain2 = getOrCreateLayerGain("layer-2", 50, padGain);

    clearAllLayerGains();

    expect(layerGain1.disconnect).toHaveBeenCalledTimes(1);
    expect(layerGain2.disconnect).toHaveBeenCalledTimes(1);
  });

  it("empties the map so a subsequent getOrCreateLayerGain call creates a new node", () => {
    const padGain = getPadGain("pad-1");
    const first = getOrCreateLayerGain("layer-1", 80, padGain);
    clearAllLayerGains();
    const second = getOrCreateLayerGain("layer-1", 80, padGain);
    expect(second).not.toBe(first);
  });

  it("is safe to call on an empty map", () => {
    expect(() => clearAllLayerGains()).not.toThrow();
  });
});

// ── cancelPadFade ────────────────────────────────────────────────────────────

describe("cancelPadFade", () => {
  it("is idempotent when no fade is registered", () => {
    // Should not throw
    expect(() => cancelPadFade("pad-1")).not.toThrow();
    expect(isPadFadingOut("pad-1")).toBe(false);
    expect(isPadFading("pad-1")).toBe(false);
  });

  it("clears fade state for a pad that has an active fade", () => {
    addFadingOutPad("pad-1");
    setFadePadTimeout("pad-1", setTimeout(() => {}, 9999));
    expect(isPadFadingOut("pad-1")).toBe(true);
    expect(isPadFading("pad-1")).toBe(true);

    cancelPadFade("pad-1");

    expect(isPadFadingOut("pad-1")).toBe(false);
    expect(isPadFading("pad-1")).toBe(false);
  });
});

// ── clearAllFadeTracking ─────────────────────────────────────────────────────

describe("clearAllFadeTracking", () => {
  it("clears all fade state across multiple pads and resets store", () => {
    addFadingOutPad("pad-1");
    addFadingOutPad("pad-2");
    setFadePadTimeout("pad-1", setTimeout(() => {}, 9999));
    setFadePadTimeout("pad-2", setTimeout(() => {}, 9999));
    expect(isPadFadingOut("pad-1")).toBe(true);
    expect(isPadFadingOut("pad-2")).toBe(true);
    expect(isPadFading("pad-1")).toBe(true);
    expect(isPadFading("pad-2")).toBe(true);

    clearAllFadeTracking();

    expect(isPadFadingOut("pad-1")).toBe(false);
    expect(isPadFadingOut("pad-2")).toBe(false);
    expect(isPadFading("pad-1")).toBe(false);
    expect(isPadFading("pad-2")).toBe(false);
    // Store bulk resets (clearAllVolumeTransitions, resetAllPadVolumes) are no longer called here —
    // the global audioTick owns padVolumes and stopAudioTick handles clearing.
  });
});

// ── Voice tracking ──────────────────────────────────────────────────────────

function makeVoice(opts: { onStop?: () => void } = {}): AudioVoice {
  return {
    start: async () => {},
    stop: () => { opts.onStop?.(); },
    stopWithRamp: () => {},
    setVolume: () => {},
    setLoop: () => {},
    setOnEnded: vi.fn(),
  };
}

describe("voice tracking", () => {
  it("recordVoice tracks a voice and marks pad as active", () => {
    const voice = makeVoice();
    recordVoice("pad-1", voice);
    expect(isPadActive("pad-1")).toBe(true);
    expect(mockPlaybackState.addPlayingPad).toHaveBeenCalledWith("pad-1");
  });

  it("clearVoice removes voice and deactivates pad when empty", () => {
    const voice = makeVoice();
    recordVoice("pad-1", voice);
    clearVoice("pad-1", voice);
    expect(isPadActive("pad-1")).toBe(false);
    expect(mockPlaybackState.removePlayingPad).toHaveBeenCalledWith("pad-1");
  });

  it("stopPadVoices stops all voices and clears layer entries for that pad", () => {
    const stopped: boolean[] = [];
    const v1 = makeVoice({ onStop: () => stopped.push(true) });
    const v2 = makeVoice({ onStop: () => stopped.push(true) });
    recordLayerVoice("pad-1", "layer-1", v1);
    recordLayerVoice("pad-1", "layer-2", v2);
    stopPadVoices("pad-1");
    expect(stopped).toHaveLength(2);
    expect(isPadActive("pad-1")).toBe(false);
    expect(isLayerActive("layer-1")).toBe(false);
    expect(isLayerActive("layer-2")).toBe(false);
  });

  it("stopAllVoices stops everything", () => {
    const stopped: boolean[] = [];
    recordLayerVoice("pad-1", "layer-1", makeVoice({ onStop: () => stopped.push(true) }));
    recordLayerVoice("pad-2", "layer-2", makeVoice({ onStop: () => stopped.push(true) }));
    stopAllVoices();
    expect(stopped).toHaveLength(2);
    expect(isPadActive("pad-1")).toBe(false);
    expect(isPadActive("pad-2")).toBe(false);
    expect(mockPlaybackState.clearAllPlayingPads).toHaveBeenCalled();
  });

  it("recordLayerVoice tracks in both voiceMap and layerVoiceMap", () => {
    const voice = makeVoice();
    recordLayerVoice("pad-1", "layer-1", voice);
    expect(isPadActive("pad-1")).toBe(true);
    expect(isLayerActive("layer-1")).toBe(true);
    expect(getLayerVoices("layer-1")).toHaveLength(1);
  });

  it("clearLayerVoice removes from both maps", () => {
    const voice = makeVoice();
    recordLayerVoice("pad-1", "layer-1", voice);
    clearLayerVoice("pad-1", "layer-1", voice);
    expect(isLayerActive("layer-1")).toBe(false);
    expect(isPadActive("pad-1")).toBe(false);
  });

  it("stopLayerVoices cleans up layer and pad maps correctly", () => {
    const stopped: boolean[] = [];
    const v1 = makeVoice({ onStop: () => stopped.push(true) });
    const v2 = makeVoice({ onStop: () => stopped.push(true) });
    recordLayerVoice("pad-1", "layer-1", v1);
    recordLayerVoice("pad-1", "layer-1", v2);
    stopLayerVoices("pad-1", "layer-1");
    expect(stopped).toHaveLength(2);
    expect(isLayerActive("layer-1")).toBe(false);
    expect(isPadActive("pad-1")).toBe(false);
  });

  it("clearVoice keeps pad active when other voices remain", () => {
    const v1 = makeVoice();
    const v2 = makeVoice();
    recordVoice("pad-1", v1);
    recordVoice("pad-1", v2);
    vi.clearAllMocks();
    clearVoice("pad-1", v1);
    expect(isPadActive("pad-1")).toBe(true);
    expect(mockPlaybackState.removePlayingPad).not.toHaveBeenCalled();
  });

  it("stopLayerVoices keeps pad active when other layers still have voices", () => {
    const v1 = makeVoice();
    const v2 = makeVoice();
    recordLayerVoice("pad-1", "layer-1", v1);
    recordLayerVoice("pad-1", "layer-2", v2);
    vi.clearAllMocks();
    stopLayerVoices("pad-1", "layer-1");
    expect(isLayerActive("layer-1")).toBe(false);
    expect(isLayerActive("layer-2")).toBe(true);
    expect(isPadActive("pad-1")).toBe(true);
    expect(mockPlaybackState.removePlayingPad).not.toHaveBeenCalled();
  });

  it("stopLayerVoices cleans maps before stop() so synchronous onended is a safe no-op", () => {
    const reentrantVoice = makeVoice();
    // Override stop() to simulate a streaming element that fires onended synchronously
    reentrantVoice.stop = vi.fn(() => {
      // At this point, maps should already be cleared — so this is a no-op
      clearLayerVoice("pad-1", "layer-1", reentrantVoice);
    });
    recordLayerVoice("pad-1", "layer-1", reentrantVoice);
    expect(() => stopLayerVoices("pad-1", "layer-1")).not.toThrow();
    expect(isLayerActive("layer-1")).toBe(false);
    expect(isPadActive("pad-1")).toBe(false);
  });

  it("getLayerVoices returns empty array when layer not active", () => {
    expect(getLayerVoices("no-such-layer")).toEqual([]);
  });

  it("nullAllOnEnded nulls all onended callbacks", () => {
    const v1 = makeVoice();
    const v2 = makeVoice();
    recordLayerVoice("pad-1", "layer-1", v1);
    recordLayerVoice("pad-2", "layer-2", v2);
    nullAllOnEnded();
    expect(v1.setOnEnded).toHaveBeenCalledWith(null);
    expect(v2.setOnEnded).toHaveBeenCalledWith(null);
  });
});

// ── Layer cycle index ────────────────────────────────────────────────────────

describe("layerCycleIndex", () => {
  it("returns undefined for a layer with no cycle index set", () => {
    expect(getLayerCycleIndex("layer-1")).toBeUndefined();
  });

  it("stores and retrieves a cycle index", () => {
    setLayerCycleIndex("layer-1", 2);
    expect(getLayerCycleIndex("layer-1")).toBe(2);
  });

  it("overwrites an existing cycle index", () => {
    setLayerCycleIndex("layer-1", 0);
    setLayerCycleIndex("layer-1", 3);
    expect(getLayerCycleIndex("layer-1")).toBe(3);
  });

  it("deleteLayerCycleIndex removes the entry", () => {
    setLayerCycleIndex("layer-1", 1);
    deleteLayerCycleIndex("layer-1");
    expect(getLayerCycleIndex("layer-1")).toBeUndefined();
  });

  it("clearAllLayerCycleIndexes removes all entries", () => {
    setLayerCycleIndex("layer-1", 0);
    setLayerCycleIndex("layer-2", 5);
    clearAllLayerCycleIndexes();
    expect(getLayerCycleIndex("layer-1")).toBeUndefined();
    expect(getLayerCycleIndex("layer-2")).toBeUndefined();
  });
});

// ── tick accessor functions ──────────────────────────────────────────────────

describe("tick accessor functions", () => {
  it("getActivePadCount returns 0 when no voices are active", () => {
    expect(getActivePadCount()).toBe(0);
  });

  it("getActivePadCount returns correct count with voices recorded", () => {
    recordLayerVoice("pad-1", "layer-1", makeVoice());
    recordLayerVoice("pad-2", "layer-2", makeVoice());
    expect(getActivePadCount()).toBe(2);
  });

  it("forEachActivePadGain only iterates pads with both a voice AND a gain node", () => {
    // pad-1: has both a gain node AND a voice
    getPadGain("pad-1");
    recordLayerVoice("pad-1", "layer-1", makeVoice());

    // pad-2: has a gain node but NO voice (should not be iterated)
    getPadGain("pad-2");

    const visited: string[] = [];
    forEachActivePadGain((padId) => visited.push(padId));
    expect(visited).toEqual(["pad-1"]);
  });

  it("forEachActivePadGain passes the correct GainNode to fn", () => {
    const gain = getPadGain("pad-1");
    recordLayerVoice("pad-1", "layer-1", makeVoice());

    let receivedGain: GainNode | undefined;
    forEachActivePadGain((_padId, g) => { receivedGain = g; });
    expect(receivedGain).toBe(gain);
  });

  it("forEachActiveLayerGain only iterates layers with both a voice AND a gain node", () => {
    const padGain = getPadGain("pad-1");

    // layer-1: has both a gain node AND a voice
    getOrCreateLayerGain("layer-1", 100, padGain);
    recordLayerVoice("pad-1", "layer-1", makeVoice());

    // layer-2: has a gain node but NO voice (should not be iterated)
    getOrCreateLayerGain("layer-2", 80, padGain);

    const visited: string[] = [];
    forEachActiveLayerGain((layerId) => visited.push(layerId));
    expect(visited).toEqual(["layer-1"]);
  });

  it("forEachActiveLayerGain passes the correct GainNode to fn", () => {
    const padGain = getPadGain("pad-1");
    const layerGain = getOrCreateLayerGain("layer-1", 100, padGain);
    recordLayerVoice("pad-1", "layer-1", makeVoice());

    let receivedGain: GainNode | undefined;
    forEachActiveLayerGain((_layerId, g) => { receivedGain = g; });
    expect(receivedGain).toBe(layerGain);
  });

  it("getActiveLayerIdSet returns correct set of active layer IDs", () => {
    recordLayerVoice("pad-1", "layer-1", makeVoice());
    recordLayerVoice("pad-1", "layer-2", makeVoice());
    recordLayerVoice("pad-2", "layer-3", makeVoice());

    const ids = getActiveLayerIdSet();
    expect(ids).toBeInstanceOf(Set);
    expect(ids.size).toBe(3);
    expect(ids.has("layer-1")).toBe(true);
    expect(ids.has("layer-2")).toBe(true);
    expect(ids.has("layer-3")).toBe(true);
  });

  it("getActiveLayerIdSet returns empty set when no voices active", () => {
    const ids = getActiveLayerIdSet();
    expect(ids.size).toBe(0);
  });

  it("computeAllPadProgress returns empty object when no voices active", () => {
    expect(computeAllPadProgress()).toEqual({});
  });

  it("computeAllPadProgress returns progress for pads that have progress info", () => {
    recordLayerVoice("pad-1", "layer-1", makeVoice());
    setPadProgressInfo("pad-1", { startedAt: 0, duration: 4, isLooping: false });
    mockCtx.currentTime = 2;

    const result = computeAllPadProgress();
    expect(result["pad-1"]).toBeCloseTo(0.5);
  });

  it("computeAllPadProgress omits pads with no progress info", () => {
    recordLayerVoice("pad-1", "layer-1", makeVoice());
    // no setPadProgressInfo or streaming audio for pad-1

    const result = computeAllPadProgress();
    expect(result["pad-1"]).toBeUndefined();
  });

  it("computeAllPadProgress handles multiple active pads", () => {
    recordLayerVoice("pad-1", "layer-1", makeVoice());
    recordLayerVoice("pad-2", "layer-2", makeVoice());
    setPadProgressInfo("pad-1", { startedAt: 0, duration: 10, isLooping: false });
    setPadProgressInfo("pad-2", { startedAt: 0, duration: 4, isLooping: false });
    mockCtx.currentTime = 2;

    const result = computeAllPadProgress();
    expect(result["pad-1"]).toBeCloseTo(0.2);
    expect(result["pad-2"]).toBeCloseTo(0.5);
  });
});
