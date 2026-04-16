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
  setAudioTick: vi.fn(),
  padVolumes: {} as Record<string, number>,
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
  getLayerVoiceVersion,
  computeAllPadProgress,
  computeAllLayerProgress,
  unregisterStreamingAudio,
  clearLayerStreamingAudio,
  setLayerProgressInfo,
  clearAllLayerProgressInfo,
  _padToLayerIds,
  _padBestStreamingAudio,
  _layerBestStreamingAudio,
} from "./audioState";
import type { AudioVoice } from "./audioVoice";

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockCtx.currentTime = 0;
  mockCtx.createGain.mockImplementation(() => makeMockGain());
  mockPlaybackState.padVolumes = {};
  clearAllPadGains();
  clearAllLayerGains();
  clearAllLayerChains();
  clearAllLayerCycleIndexes();
  clearAllStreamingAudio();
  clearAllPadProgressInfo();
  clearAllLayerPending();
  clearAllFadeTracking();
  clearAllLayerProgressInfo();
  clearAllVoices(); // also clears _padToLayerIds (reverse index)
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
      addEventListener: vi.fn(),
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

// ── getOrCreateLayerGain ─────────────────────────────────────────────────────

describe("getOrCreateLayerGain", () => {
  beforeEach(() => {
    clearAllLayerGains();
    mockCtx.createGain.mockImplementation(makeMockGain);
  });

  it("sets gain.value to the normalized [0,1] volume on creation", () => {
    const padGain = getPadGain("pad-gain-test");
    const layerGain = getOrCreateLayerGain("layer-vol-test", 0.8, padGain);
    expect(layerGain.gain.value).toBe(0.8);
  });

  it("sets gain.value to 0 when volume is 0", () => {
    const padGain = getPadGain("pad-gain-test");
    const layerGain = getOrCreateLayerGain("layer-zero", 0, padGain);
    expect(layerGain.gain.value).toBe(0);
  });

  it("sets gain.value to 1 when volume is 1", () => {
    const padGain = getPadGain("pad-gain-test");
    const layerGain = getOrCreateLayerGain("layer-full", 1, padGain);
    expect(layerGain.gain.value).toBe(1);
  });

  it("connects the new gain node to padGain", () => {
    const padGain = getPadGain("pad-gain-test");
    const layerGain = getOrCreateLayerGain("layer-connect", 0.5, padGain);
    expect(layerGain.connect).toHaveBeenCalledWith(padGain);
  });

  it("returns the cached gain node on subsequent calls for the same layerId", () => {
    const padGain = getPadGain("pad-gain-test");
    const countBefore = mockCtx.createGain.mock.calls.length;
    const first = getOrCreateLayerGain("layer-cache", 0.8, padGain);
    const second = getOrCreateLayerGain("layer-cache", 0.8, padGain);
    expect(second).toBe(first);
    // createGain called exactly once — cache hit does not create a new node
    expect(mockCtx.createGain.mock.calls.length - countBefore).toBe(1);
  });

  it("calls cancelScheduledValues before setValueAtTime on cache hit", () => {
    const padGain = getPadGain("pad-gain-test");
    const layerGain = getOrCreateLayerGain("layer-cancel", 0.8, padGain) as unknown as ReturnType<typeof makeMockGain>;
    getOrCreateLayerGain("layer-cancel", 0.5, padGain);
    expect(layerGain.gain.cancelScheduledValues).toHaveBeenCalledWith(mockCtx.currentTime);
    const cancelOrder = layerGain.gain.cancelScheduledValues.mock.invocationCallOrder[0];
    const setOrder = layerGain.gain.setValueAtTime.mock.invocationCallOrder[0];
    expect(cancelOrder).toBeLessThan(setOrder);
  });

  it("calls setValueAtTime with the normalized [0,1] volume on cache hit", () => {
    const padGain = getPadGain("pad-gain-test");
    // First call creates the node
    const layerGain = getOrCreateLayerGain("layer-sync", 0.8, padGain);
    // Second call should sync the cached node's gain to the new volume
    getOrCreateLayerGain("layer-sync", 0.5, padGain);
    expect(layerGain.gain.setValueAtTime).toHaveBeenLastCalledWith(0.5, mockCtx.currentTime);
  });

  it("clamps volume > 1 to 1", () => {
    const padGain = getPadGain("pad-gain-test");
    const layerGain = getOrCreateLayerGain("layer-over", 1.5, padGain);
    expect(layerGain.gain.value).toBe(1);
  });

  it("clamps negative volume to 0", () => {
    const padGain = getPadGain("pad-gain-test");
    const layerGain = getOrCreateLayerGain("layer-neg", -0.5, padGain);
    expect(layerGain.gain.value).toBe(0);
  });

  it("defaults to 1 for NaN volume to avoid Web Audio RangeError", () => {
    const padGain = getPadGain("pad-gain-test");
    const layerGain = getOrCreateLayerGain("layer-nan", NaN, padGain);
    expect(layerGain.gain.value).toBe(1);
  });
});

// ── clearAllLayerGains ───────────────────────────────────────────────────────

describe("clearAllLayerGains", () => {
  it("disconnects all layer gain nodes before clearing", () => {
    const padGain = getPadGain("pad-1");
    const layerGain1 = getOrCreateLayerGain("layer-1", 0.8, padGain);
    const layerGain2 = getOrCreateLayerGain("layer-2", 0.5, padGain);

    clearAllLayerGains();

    expect(layerGain1.disconnect).toHaveBeenCalledTimes(1);
    expect(layerGain2.disconnect).toHaveBeenCalledTimes(1);
  });

  it("empties the map so a subsequent getOrCreateLayerGain call creates a new node", () => {
    const padGain = getPadGain("pad-1");
    const first = getOrCreateLayerGain("layer-1", 0.8, padGain);
    clearAllLayerGains();
    const second = getOrCreateLayerGain("layer-1", 0.8, padGain);
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

  it("clearVoice clears padVolumes entry synchronously when last voice ends (#217)", () => {
    // Simulates the fix for the one-frame race: removePlayingPad and padVolumes
    // must be cleared in the same synchronous transaction so UI subscribers
    // never see a state where playingPadIds is cleared but padVolumes still has a value.
    mockPlaybackState.padVolumes = { "pad-1": 0.5, "pad-2": 0.8 };
    const voice = makeVoice();
    recordVoice("pad-1", voice);
    clearVoice("pad-1", voice);
    expect(mockPlaybackState.setAudioTick).toHaveBeenCalledWith({
      padVolumes: { "pad-2": 0.8 },
    });
  });

  it("clearVoice does not call setAudioTick when padVolumes has no entry for the pad", () => {
    mockPlaybackState.padVolumes = { "pad-2": 0.8 }; // pad-1 not in padVolumes
    const voice = makeVoice();
    recordVoice("pad-1", voice);
    clearVoice("pad-1", voice);
    expect(mockPlaybackState.setAudioTick).not.toHaveBeenCalled();
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

  it("stopPadVoices clears padVolumes entry synchronously (#217)", () => {
    mockPlaybackState.padVolumes = { "pad-1": 0.3, "pad-2": 0.9 };
    recordLayerVoice("pad-1", "layer-1", makeVoice());
    stopPadVoices("pad-1");
    expect(mockPlaybackState.setAudioTick).toHaveBeenCalledWith({
      padVolumes: { "pad-2": 0.9 },
    });
  });

  it("stopLayerVoices clears padVolumes entry synchronously when last layer ends (#217)", () => {
    mockPlaybackState.padVolumes = { "pad-1": 0.4 };
    recordLayerVoice("pad-1", "layer-1", makeVoice());
    stopLayerVoices("pad-1", "layer-1");
    expect(mockPlaybackState.setAudioTick).toHaveBeenCalledWith({
      padVolumes: {},
    });
  });

  it("stopLayerVoices does not clear padVolumes when pad still has other layer voices", () => {
    mockPlaybackState.padVolumes = { "pad-1": 0.4 };
    recordLayerVoice("pad-1", "layer-1", makeVoice());
    recordLayerVoice("pad-1", "layer-2", makeVoice());
    stopLayerVoices("pad-1", "layer-1");
    expect(isPadActive("pad-1")).toBe(true);
    expect(mockPlaybackState.setAudioTick).not.toHaveBeenCalled();
  });

  it("stopAllVoices stops everything and clears padVolumes (#217)", () => {
    mockPlaybackState.padVolumes = { "pad-1": 0.2, "pad-2": 0.3 };
    const stopped: boolean[] = [];
    recordLayerVoice("pad-1", "layer-1", makeVoice({ onStop: () => stopped.push(true) }));
    recordLayerVoice("pad-2", "layer-2", makeVoice({ onStop: () => stopped.push(true) }));
    stopAllVoices();
    expect(stopped).toHaveLength(2);
    expect(isPadActive("pad-1")).toBe(false);
    expect(isPadActive("pad-2")).toBe(false);
    expect(mockPlaybackState.clearAllPlayingPads).toHaveBeenCalled();
    // padVolumes must be cleared in the same transaction (#217 fix)
    expect(mockPlaybackState.setAudioTick).toHaveBeenCalledWith({ padVolumes: {} });
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
    mockPlaybackState.padVolumes = { "pad-1": 0.5 };
    const v1 = makeVoice();
    const v2 = makeVoice();
    recordVoice("pad-1", v1);
    recordVoice("pad-1", v2);
    vi.clearAllMocks();
    clearVoice("pad-1", v1);
    expect(isPadActive("pad-1")).toBe(true);
    expect(mockPlaybackState.removePlayingPad).not.toHaveBeenCalled();
    // padVolumes must NOT be touched when the pad still has active voices
    expect(mockPlaybackState.setAudioTick).not.toHaveBeenCalled();
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

// ── layerVoiceVersion ────────────────────────────────────────────────────────

describe("getLayerVoiceVersion", () => {
  it("increments when a layer voice is recorded", () => {
    const before = getLayerVoiceVersion();
    recordLayerVoice("pad-1", "layer-1", makeVoice());
    expect(getLayerVoiceVersion()).toBe(before + 1);
  });

  it("increments when a layer voice is cleared", () => {
    const voice = makeVoice();
    recordLayerVoice("pad-1", "layer-1", voice);
    const before = getLayerVoiceVersion();
    clearLayerVoice("pad-1", "layer-1", voice);
    expect(getLayerVoiceVersion()).toBe(before + 1);
  });

  it("increments when clearAllVoices is called", () => {
    recordLayerVoice("pad-1", "layer-1", makeVoice());
    const before = getLayerVoiceVersion();
    clearAllVoices();
    expect(getLayerVoiceVersion()).toBe(before + 1);
  });

  it("increments once per recorded voice, not once per call", () => {
    const before = getLayerVoiceVersion();
    recordLayerVoice("pad-1", "layer-1", makeVoice());
    recordLayerVoice("pad-1", "layer-2", makeVoice());
    recordLayerVoice("pad-2", "layer-3", makeVoice());
    expect(getLayerVoiceVersion()).toBe(before + 3);
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
    getOrCreateLayerGain("layer-1", 1, padGain);
    recordLayerVoice("pad-1", "layer-1", makeVoice());

    // layer-2: has a gain node but NO voice (should not be iterated)
    getOrCreateLayerGain("layer-2", 0.8, padGain);

    const visited: string[] = [];
    forEachActiveLayerGain((layerId) => visited.push(layerId));
    expect(visited).toEqual(["layer-1"]);
  });

  it("forEachActiveLayerGain passes the correct GainNode to fn", () => {
    const padGain = getPadGain("pad-1");
    const layerGain = getOrCreateLayerGain("layer-1", 1, padGain);
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

describe("clearAllAudioState", () => {
  it("clears all runtime audio state in a single call", async () => {
    vi.useFakeTimers();
    const {
      clearAllAudioState,
      getPadGain,
      getOrCreateLayerGain,
      setPadProgressInfo,
      getPadProgressInfo,
      setLayerChain,
      setLayerCycleIndex,
      setLayerPlayOrder,
      setLayerPending,
      addFadingOutPad,
      isPadFadingOut,
      getLayerChain,
      getLayerCycleIndex,
      getLayerPlayOrder,
      isLayerPending,
      isPadActive,
      getLayerGain,
      registerStreamingAudio,
      isPadStreaming,
      setGlobalStopTimeout,
    } = await import("./audioState");

    const padGain = getPadGain("pad-clearall");
    getOrCreateLayerGain("layer-clearall", 0.8, padGain);
    setPadProgressInfo("pad-clearall", { startedAt: 0, duration: 1, isLooping: false });
    setLayerChain("layer-clearall", []);
    setLayerCycleIndex("layer-clearall", 2);
    setLayerPlayOrder("layer-clearall", []);
    setLayerPending("layer-clearall");
    addFadingOutPad("pad-clearall");

    // Register a streaming audio element so isPadStreaming returns true before clear
    const mockAudio = { pause: vi.fn(), currentTime: 0, duration: 10, addEventListener: vi.fn() } as unknown as HTMLAudioElement;
    registerStreamingAudio("pad-clearall", "layer-clearall", mockAudio);
    expect(isPadStreaming("pad-clearall")).toBe(true);

    // Schedule a timeout (simulates stopAllPads post-ramp cleanup)
    const spy = vi.fn();
    const timeoutId = setTimeout(spy, 9999);
    setGlobalStopTimeout(timeoutId);

    clearAllAudioState();

    expect(isPadFadingOut("pad-clearall")).toBe(false);          // fade tracking cleared
    expect(getLayerChain("layer-clearall")).toBeUndefined();     // layer chains cleared
    expect(getLayerCycleIndex("layer-clearall")).toBeUndefined(); // cycle indexes cleared
    expect(getLayerPlayOrder("layer-clearall")).toBeUndefined(); // play orders cleared
    expect(isLayerPending("layer-clearall")).toBe(false);        // pending set cleared
    expect(getPadProgressInfo("pad-clearall")).toBeUndefined();  // progress info cleared
    expect(isPadActive("pad-clearall")).toBe(false);             // voices cleared
    expect(getLayerGain("layer-clearall")).toBeUndefined();      // layer gains disconnected & cleared
    expect(isPadStreaming("pad-clearall")).toBe(false);          // streaming audio cleared

    // Global stop timeout should be cancelled — spy must NOT fire
    vi.runAllTimers();
    expect(spy).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// padToLayerIds reverse index — guards O(layers_in_pad) behaviour of stopPadVoices
// ---------------------------------------------------------------------------

describe("padToLayerIds reverse index", () => {
  it("recordLayerVoice adds the layer to the pad's reverse-index entry", () => {
    recordLayerVoice("pad-1", "layer-1", makeVoice());
    expect(_padToLayerIds.get("pad-1")).toEqual(new Set(["layer-1"]));
  });

  it("recordLayerVoice accumulates multiple layers for the same pad", () => {
    recordLayerVoice("pad-1", "layer-1", makeVoice());
    recordLayerVoice("pad-1", "layer-2", makeVoice());
    expect(_padToLayerIds.get("pad-1")).toEqual(new Set(["layer-1", "layer-2"]));
  });

  it("recordLayerVoice tracks separate entries for different pads", () => {
    recordLayerVoice("pad-1", "layer-1", makeVoice());
    recordLayerVoice("pad-2", "layer-2", makeVoice());
    expect(_padToLayerIds.get("pad-1")).toEqual(new Set(["layer-1"]));
    expect(_padToLayerIds.get("pad-2")).toEqual(new Set(["layer-2"]));
  });

  it("clearLayerVoice removes the layer from the pad's reverse-index when the layer has no remaining voices", () => {
    const voice = makeVoice();
    recordLayerVoice("pad-1", "layer-1", voice);
    clearLayerVoice("pad-1", "layer-1", voice);
    // Entry for pad should be gone (no more layers)
    const padEntry = _padToLayerIds.get("pad-1");
    expect(padEntry === undefined || !padEntry.has("layer-1")).toBe(true);
  });

  it("clearLayerVoice keeps the layer in the reverse-index while other voices remain in that layer", () => {
    const v1 = makeVoice();
    const v2 = makeVoice();
    recordLayerVoice("pad-1", "layer-1", v1);
    recordLayerVoice("pad-1", "layer-1", v2);
    clearLayerVoice("pad-1", "layer-1", v1); // one voice remains
    expect(_padToLayerIds.get("pad-1")?.has("layer-1")).toBe(true);
  });

  it("stopPadVoices clears the pad's reverse-index entry", () => {
    recordLayerVoice("pad-1", "layer-1", makeVoice());
    recordLayerVoice("pad-1", "layer-2", makeVoice());
    stopPadVoices("pad-1");
    expect(_padToLayerIds.has("pad-1")).toBe(false);
  });

  it("stopPadVoices does NOT touch reverse-index entries for other pads", () => {
    recordLayerVoice("pad-1", "layer-1", makeVoice());
    recordLayerVoice("pad-2", "layer-2", makeVoice());
    stopPadVoices("pad-1");
    expect(_padToLayerIds.get("pad-2")).toEqual(new Set(["layer-2"]));
  });

  it("stopLayerVoices removes the stopped layer from the pad's reverse-index", () => {
    recordLayerVoice("pad-1", "layer-1", makeVoice());
    recordLayerVoice("pad-1", "layer-2", makeVoice());
    stopLayerVoices("pad-1", "layer-1");
    expect(_padToLayerIds.get("pad-1")?.has("layer-1")).toBe(false);
    expect(_padToLayerIds.get("pad-1")?.has("layer-2")).toBe(true);
  });

  it("stopLayerVoices removes the pad's reverse-index entry when the last layer is stopped", () => {
    recordLayerVoice("pad-1", "layer-1", makeVoice());
    stopLayerVoices("pad-1", "layer-1");
    expect(_padToLayerIds.has("pad-1")).toBe(false);
  });

  it("stopAllVoices clears the entire reverse index", () => {
    recordLayerVoice("pad-1", "layer-1", makeVoice());
    recordLayerVoice("pad-2", "layer-2", makeVoice());
    stopAllVoices();
    expect(_padToLayerIds.size).toBe(0);
  });

  it("clearAllVoices clears the entire reverse index", () => {
    recordLayerVoice("pad-1", "layer-1", makeVoice());
    clearAllVoices();
    expect(_padToLayerIds.size).toBe(0);
  });

  it("stopPadVoices is a no-op on an unknown pad (no throw, index stays empty)", () => {
    expect(() => stopPadVoices("never-recorded")).not.toThrow();
    expect(_padToLayerIds.size).toBe(0);
  });

  it("recording the same voice twice does not corrupt the index on clear", () => {
    const voice = makeVoice();
    recordLayerVoice("pad-1", "layer-1", voice);
    recordLayerVoice("pad-1", "layer-1", voice); // duplicate
    clearLayerVoice("pad-1", "layer-1", voice);  // removes both duplicates (filter by reference)
    // Layer should be gone since filter removes all occurrences
    expect(isLayerActive("layer-1")).toBe(false);
    expect(_padToLayerIds.has("pad-1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Streaming audio best-element cache — guards O(1) getPadProgress/
// computeAllLayerProgress lookups (#160)
// ---------------------------------------------------------------------------

/** Create a mock audio element. Listeners registered via addEventListener are stored and
 *  can be fired by calling el.dispatchEvent(new Event("loadedmetadata")) — matching the
 *  real DOM API so the membership-guard path in registerStreamingAudio can be exercised. */
function makeAudio(duration: number, currentTime = 0): HTMLAudioElement {
  const listeners = new Map<string, Array<(e: Event) => void>>();
  return {
    duration,
    currentTime,
    addEventListener: vi.fn((event: string, cb: (e: Event) => void) => {
      const arr = listeners.get(event) ?? [];
      arr.push(cb);
      listeners.set(event, arr);
    }),
    dispatchEvent: vi.fn((e: Event) => {
      for (const cb of listeners.get(e.type) ?? []) cb(e);
      return true;
    }),
  } as unknown as HTMLAudioElement;
}

describe("streaming audio best-element cache (_padBestStreamingAudio / _layerBestStreamingAudio)", () => {
  it("registerStreamingAudio populates pad cache with the registered element", () => {
    const el = makeAudio(10);
    registerStreamingAudio("pad-1", "layer-1", el);
    expect(_padBestStreamingAudio.get("pad-1")).toBe(el);
  });

  it("registerStreamingAudio populates layer cache with the registered element", () => {
    const el = makeAudio(10);
    registerStreamingAudio("pad-1", "layer-1", el);
    expect(_layerBestStreamingAudio.get("layer-1")).toBe(el);
  });

  it("pad cache picks the element with the longest finite duration", () => {
    const short = makeAudio(5);
    const long = makeAudio(20);
    registerStreamingAudio("pad-1", "layer-1", short);
    registerStreamingAudio("pad-1", "layer-2", long);
    expect(_padBestStreamingAudio.get("pad-1")).toBe(long);
  });

  it("layer cache picks the element with the longest finite duration within that layer", () => {
    const el1 = makeAudio(5);
    const el2 = makeAudio(15);
    registerStreamingAudio("pad-1", "layer-1", el1);
    registerStreamingAudio("pad-1", "layer-1", el2);
    expect(_layerBestStreamingAudio.get("layer-1")).toBe(el2);
  });

  it("element with NaN duration is set as best only when it is the sole element", () => {
    const nanEl = makeAudio(NaN);
    registerStreamingAudio("pad-1", "layer-1", nanEl);
    expect(_padBestStreamingAudio.get("pad-1")).toBe(nanEl);
  });

  it("element with finite duration wins over element with NaN duration", () => {
    const nanEl = makeAudio(NaN);
    const finiteEl = makeAudio(10);
    registerStreamingAudio("pad-1", "layer-1", nanEl);
    registerStreamingAudio("pad-1", "layer-2", finiteEl);
    expect(_padBestStreamingAudio.get("pad-1")).toBe(finiteEl);
  });

  it("unregisterStreamingAudio updates pad cache when the best element is removed", () => {
    const short = makeAudio(5);
    const long = makeAudio(20);
    registerStreamingAudio("pad-1", "layer-1", short);
    registerStreamingAudio("pad-1", "layer-2", long);
    unregisterStreamingAudio("pad-1", "layer-2", long);
    expect(_padBestStreamingAudio.get("pad-1")).toBe(short);
  });

  it("unregisterStreamingAudio clears pad cache when the last element is removed", () => {
    const el = makeAudio(10);
    registerStreamingAudio("pad-1", "layer-1", el);
    unregisterStreamingAudio("pad-1", "layer-1", el);
    expect(_padBestStreamingAudio.has("pad-1")).toBe(false);
  });

  it("unregisterStreamingAudio updates layer cache when the best element is removed", () => {
    const el1 = makeAudio(5);
    const el2 = makeAudio(20);
    registerStreamingAudio("pad-1", "layer-1", el1);
    registerStreamingAudio("pad-1", "layer-1", el2);
    unregisterStreamingAudio("pad-1", "layer-1", el2);
    expect(_layerBestStreamingAudio.get("layer-1")).toBe(el1);
  });

  it("clearLayerStreamingAudio removes the layer's entry from the layer cache", () => {
    registerStreamingAudio("pad-1", "layer-1", makeAudio(10));
    clearLayerStreamingAudio("pad-1", "layer-1");
    expect(_layerBestStreamingAudio.has("layer-1")).toBe(false);
  });

  it("clearLayerStreamingAudio updates the pad cache to exclude the cleared layer", () => {
    const el1 = makeAudio(10); // layer-1
    const el2 = makeAudio(20); // layer-2 — initially best
    registerStreamingAudio("pad-1", "layer-1", el1);
    registerStreamingAudio("pad-1", "layer-2", el2);
    clearLayerStreamingAudio("pad-1", "layer-2");
    expect(_padBestStreamingAudio.get("pad-1")).toBe(el1);
  });

  it("clearAllStreamingAudio clears both caches", () => {
    registerStreamingAudio("pad-1", "layer-1", makeAudio(10));
    clearAllStreamingAudio();
    expect(_padBestStreamingAudio.size).toBe(0);
    expect(_layerBestStreamingAudio.size).toBe(0);
  });
});

describe("getPadProgress — streaming path uses cached best element", () => {
  it("returns correct progress from the cached best streaming element", () => {
    const el = makeAudio(10, 3);
    registerStreamingAudio("pad-1", "layer-1", el);
    expect(getPadProgress("pad-1")).toBeCloseTo(0.3);
  });

  it("returns 0 when cached element has NaN duration", () => {
    registerStreamingAudio("pad-1", "layer-1", makeAudio(NaN, 0));
    expect(getPadProgress("pad-1")).toBe(0);
  });

  it("returns correct progress after cache is updated by unregistering the best element", () => {
    const long = makeAudio(20, 10); // progress 0.5
    const short = makeAudio(5, 2);  // progress 0.4
    registerStreamingAudio("pad-1", "layer-1", short);
    registerStreamingAudio("pad-1", "layer-2", long);
    expect(getPadProgress("pad-1")).toBeCloseTo(0.5); // uses long (best)

    unregisterStreamingAudio("pad-1", "layer-2", long);
    expect(getPadProgress("pad-1")).toBeCloseTo(0.4); // now uses short
  });
});

describe("computeAllLayerProgress — streaming path uses cached best element", () => {
  it("returns progress for a streaming layer using the cached best element", () => {
    const el = makeAudio(10, 4);
    registerStreamingAudio("pad-1", "layer-1", el);
    const progress = computeAllLayerProgress();
    expect(progress["layer-1"]).toBeCloseTo(0.4);
  });

  it("buffer layer progress takes priority over streaming for the same layer ID", () => {
    registerStreamingAudio("pad-1", "layer-1", makeAudio(10, 5));
    setLayerProgressInfo("layer-1", { startedAt: 0, duration: 10, isLooping: false });
    mockCtx.currentTime = 2;
    const progress = computeAllLayerProgress();
    // Buffer result = 0.2 (not streaming 0.5)
    expect(progress["layer-1"]).toBeCloseTo(0.2);
  });

  it("returns 0 for a streaming layer whose element has NaN duration", () => {
    registerStreamingAudio("pad-1", "layer-1", makeAudio(NaN, 0));
    const progress = computeAllLayerProgress();
    expect(progress["layer-1"]).toBe(0);
  });

  it("returns empty object when no layers are active", () => {
    expect(computeAllLayerProgress()).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// loadedmetadata listener lifecycle — stale-closure and duplicate-listener guards
// ---------------------------------------------------------------------------

describe("registerStreamingAudio — loadedmetadata listener lifecycle", () => {
  it("loadedmetadata listener is a no-op after the element is unregistered", () => {
    const el = makeAudio(NaN);
    registerStreamingAudio("pad-1", "layer-1", el);
    unregisterStreamingAudio("pad-1", "layer-1", el);

    // Simulate late loadedmetadata fire after unregister
    Object.defineProperty(el, "duration", { value: 10, configurable: true });
    (el as unknown as { dispatchEvent: (e: Event) => boolean }).dispatchEvent(new Event("loadedmetadata"));

    // Cache must remain empty — listener should be a no-op
    expect(_padBestStreamingAudio.has("pad-1")).toBe(false);
    expect(_layerBestStreamingAudio.has("layer-1")).toBe(false);
  });

  it("late loadedmetadata does not displace a new element registered after unregister", () => {
    const staleEl = makeAudio(NaN);
    const freshEl = makeAudio(5);
    registerStreamingAudio("pad-1", "layer-1", staleEl);
    unregisterStreamingAudio("pad-1", "layer-1", staleEl);
    registerStreamingAudio("pad-1", "layer-1", freshEl); // new active element

    // Fire stale loadedmetadata on the old element (now with a longer duration)
    Object.defineProperty(staleEl, "duration", { value: 20, configurable: true });
    (staleEl as unknown as { dispatchEvent: (e: Event) => boolean }).dispatchEvent(new Event("loadedmetadata"));

    // Cache must still point to freshEl — stale listener is a membership-guard no-op
    expect(_padBestStreamingAudio.get("pad-1")).toBe(freshEl);
    expect(_layerBestStreamingAudio.get("layer-1")).toBe(freshEl);
  });

  it("loadedmetadata listener updates cache when element is still registered", () => {
    const el1 = makeAudio(NaN);
    const el2 = makeAudio(NaN);
    registerStreamingAudio("pad-1", "layer-1", el1);
    registerStreamingAudio("pad-1", "layer-2", el2);

    // el2 fires loadedmetadata with a longer duration — cache should update
    Object.defineProperty(el2, "duration", { value: 20, configurable: true });
    (el2 as unknown as { dispatchEvent: (e: Event) => boolean }).dispatchEvent(new Event("loadedmetadata"));

    expect(_padBestStreamingAudio.get("pad-1")).toBe(el2);
  });
});
