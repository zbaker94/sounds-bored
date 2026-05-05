import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockCtx = {
  currentTime: 0,
  createGain: vi.fn(),
  createDynamicsCompressor: vi.fn(),
};

vi.mock("./audioContext", () => ({
  getAudioContext: vi.fn(() => mockCtx),
  getMasterGain: vi.fn(() => ({ connect: vi.fn() })),
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

function makeMockCompressor() {
  return {
    threshold: { value: 0 },
    knee: { value: 0 },
    ratio: { value: 1 },
    attack: { value: 0 },
    release: { value: 0 },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { getMasterGain } from "./audioContext";
import {
  getPadProgress,
  getPadGain,
  getOrCreateLayerGain,
  cancelPadFade,
  clearAllFadeTracking,
  clearAllPadGains,
  clearPadGainsForIds,
  clearInactivePadGains,
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
  stopSpecificVoices,
  getLayerVoices,
  nullAllOnEnded,
  isPadActive,
  isLayerActive,
  forEachActivePadGain,
  getActivePadCount,
  forEachActiveLayerGain,
  getActiveLayerIdSet,
  onLayerVoiceSetChanged,
  _notifyLayerVoiceSetChangedForTest,
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
  mockCtx.createDynamicsCompressor.mockImplementation(() => makeMockCompressor());
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

  it("uses the provided currentTime instead of calling getAudioContext()", () => {
    setPadProgressInfo("pad-1", { startedAt: 0, duration: 4, isLooping: false });
    // mockCtx.currentTime is 0 by default — passing explicit value overrides it
    expect(getPadProgress("pad-1", 2)).toBeCloseTo(0.5);
    expect(getPadProgress("pad-1", 1)).toBeCloseTo(0.25);
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

  it("clears fadingOutPadIds for a pad with an active fade-out", () => {
    addFadingOutPad("pad-sync");

    cancelPadFade("pad-sync");

    expect(isPadFadingOut("pad-sync")).toBe(false);
  });
});

// ── addFadingOutPad ──────────────────────────────────────────────────────────

describe("addFadingOutPad", () => {
  it("marks fading-out on audioState", () => {
    addFadingOutPad("pad-add");

    expect(isPadFadingOut("pad-add")).toBe(true);
  });
});

// ── clearAllFadeTracking ─────────────────────────────────────────────────────

describe("clearAllFadeTracking", () => {
  it("clears all fade state across multiple pads", () => {
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
    // clearAllFadeTracking does not write tick-managed fields (padVolumes etc.) —
    // audioTick owns those and stopAudioTick handles clearing.
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
  });

  it("clearVoice removes voice and deactivates pad when empty", () => {
    const voice = makeVoice();
    recordVoice("pad-1", voice);
    clearVoice("pad-1", voice);
    expect(isPadActive("pad-1")).toBe(false);
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

  it("stopLayerVoices keeps pad active when other layer voices remain", () => {
    recordLayerVoice("pad-1", "layer-1", makeVoice());
    recordLayerVoice("pad-1", "layer-2", makeVoice());
    stopLayerVoices("pad-1", "layer-1");
    expect(isPadActive("pad-1")).toBe(true);
  });

  it("stopAllVoices stops all voices and deactivates pads in local state", () => {
    const stopped: boolean[] = [];
    recordLayerVoice("pad-1", "layer-1", makeVoice({ onStop: () => stopped.push(true) }));
    recordLayerVoice("pad-2", "layer-2", makeVoice({ onStop: () => stopped.push(true) }));
    stopAllVoices();
    expect(stopped).toHaveLength(2);
    expect(isPadActive("pad-1")).toBe(false);
    expect(isPadActive("pad-2")).toBe(false);
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
    clearVoice("pad-1", v1);
    expect(isPadActive("pad-1")).toBe(true);
  });

  it("stopLayerVoices keeps pad active when other layers still have voices", () => {
    const v1 = makeVoice();
    const v2 = makeVoice();
    recordLayerVoice("pad-1", "layer-1", v1);
    recordLayerVoice("pad-1", "layer-2", v2);
    stopLayerVoices("pad-1", "layer-1");
    expect(isLayerActive("layer-1")).toBe(false);
    expect(isLayerActive("layer-2")).toBe(true);
    expect(isPadActive("pad-1")).toBe(true);
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

// ── onLayerVoiceSetChanged ───────────────────────────────────────────────────

describe("onLayerVoiceSetChanged", () => {
  it("fires the listener when a layer voice is recorded", () => {
    let calls = 0;
    const unsub = onLayerVoiceSetChanged(() => { calls++; });
    recordLayerVoice("pad-1", "layer-1", makeVoice());
    expect(calls).toBe(1);
    unsub();
  });

  it("fires the listener when a layer voice is cleared", () => {
    let calls = 0;
    const voice = makeVoice();
    recordLayerVoice("pad-1", "layer-1", voice);
    const unsub = onLayerVoiceSetChanged(() => { calls++; });
    clearLayerVoice("pad-1", "layer-1", voice);
    expect(calls).toBe(1);
    unsub();
  });

  it("fires the listener when clearAllVoices is called", () => {
    let calls = 0;
    recordLayerVoice("pad-1", "layer-1", makeVoice());
    const unsub = onLayerVoiceSetChanged(() => { calls++; });
    clearAllVoices();
    expect(calls).toBe(1);
    unsub();
  });

  it("fires the listener when stopPadVoices is called", () => {
    let calls = 0;
    recordLayerVoice("pad-1", "layer-1", makeVoice());
    const unsub = onLayerVoiceSetChanged(() => { calls++; });
    stopPadVoices("pad-1");
    expect(calls).toBe(1);
    unsub();
  });

  it("fires the listener when stopAllVoices is called", () => {
    let calls = 0;
    recordLayerVoice("pad-1", "layer-1", makeVoice());
    const unsub = onLayerVoiceSetChanged(() => { calls++; });
    stopAllVoices();
    expect(calls).toBe(1);
    unsub();
  });

  it("fires the listener when stopLayerVoices is called", () => {
    let calls = 0;
    recordLayerVoice("pad-1", "layer-1", makeVoice());
    const unsub = onLayerVoiceSetChanged(() => { calls++; });
    stopLayerVoices("pad-1", "layer-1");
    expect(calls).toBe(1);
    unsub();
  });

  it("fires the listener when stopSpecificVoices is called", () => {
    let calls = 0;
    const voice = makeVoice();
    recordLayerVoice("pad-1", "layer-1", voice);
    const unsub = onLayerVoiceSetChanged(() => { calls++; });
    stopSpecificVoices([voice], new Set(["pad-1"]));
    expect(calls).toBe(1);
    unsub();
  });

  it("fires once per recorded voice, not once per call", () => {
    let calls = 0;
    const unsub = onLayerVoiceSetChanged(() => { calls++; });
    recordLayerVoice("pad-1", "layer-1", makeVoice());
    recordLayerVoice("pad-1", "layer-2", makeVoice());
    recordLayerVoice("pad-2", "layer-3", makeVoice());
    expect(calls).toBe(3);
    unsub();
  });

  it("does not fire after the listener is unsubscribed", () => {
    let calls = 0;
    const unsub = onLayerVoiceSetChanged(() => { calls++; });
    recordLayerVoice("pad-1", "layer-1", makeVoice());
    unsub();
    clearAllVoices();
    expect(calls).toBe(1);
  });

  it("registering a second listener replaces the first", () => {
    let first = 0;
    let second = 0;
    onLayerVoiceSetChanged(() => { first++; });
    const unsub = onLayerVoiceSetChanged(() => { second++; });
    recordLayerVoice("pad-1", "layer-1", makeVoice());
    expect(first).toBe(0);
    expect(second).toBe(1);
    unsub();
  });

  it("_notifyLayerVoiceSetChangedForTest fires the listener without a map mutation", () => {
    let calls = 0;
    const unsub = onLayerVoiceSetChanged(() => { calls++; });
    _notifyLayerVoiceSetChangedForTest();
    expect(calls).toBe(1);
    unsub();
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
 *  real DOM API so the membership-guard and abort-cleanup paths can be exercised. */
function makeAudio(duration: number, currentTime = 0): HTMLAudioElement {
  const listeners = new Map<string, Array<(e: Event) => void>>();
  return {
    duration,
    currentTime,
    addEventListener: vi.fn((event: string, cb: (e: Event) => void, options?: AddEventListenerOptions | boolean) => {
      const arr = listeners.get(event) ?? [];
      arr.push(cb);
      listeners.set(event, arr);
      const signal = typeof options === 'object' ? options?.signal : undefined;
      if (signal) {
        signal.addEventListener('abort', () => {
          const current = listeners.get(event);
          if (current) {
            const idx = current.indexOf(cb);
            if (idx >= 0) current.splice(idx, 1);
          }
        }, { once: true });
      }
    }),
    dispatchEvent: vi.fn((e: Event) => {
      for (const cb of (listeners.get(e.type) ?? []).slice()) cb(e);
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

  it("pending listener is removed from element when unregisterStreamingAudio is called before loadedmetadata fires", () => {
    const el = makeAudio(NaN);
    registerStreamingAudio("pad-1", "layer-1", el);
    unregisterStreamingAudio("pad-1", "layer-1", el);

    Object.defineProperty(el, "duration", { value: 10, configurable: true });
    (el as unknown as { dispatchEvent: (e: Event) => boolean }).dispatchEvent(new Event("loadedmetadata"));

    // Listener was removed by abort — caches must stay empty
    expect(_padBestStreamingAudio.has("pad-1")).toBe(false);
    expect(_layerBestStreamingAudio.has("layer-1")).toBe(false);
  });

  it("pending listener is removed from element when clearLayerStreamingAudio is called before loadedmetadata fires", () => {
    const el = makeAudio(NaN);
    registerStreamingAudio("pad-1", "layer-1", el);
    clearLayerStreamingAudio("pad-1", "layer-1");

    Object.defineProperty(el, "duration", { value: 10, configurable: true });
    (el as unknown as { dispatchEvent: (e: Event) => boolean }).dispatchEvent(new Event("loadedmetadata"));

    expect(_padBestStreamingAudio.has("pad-1")).toBe(false);
    expect(_layerBestStreamingAudio.has("layer-1")).toBe(false);
  });

  it("aborting one layer's listener does not remove another active layer's listener on the same element", () => {
    const el = makeAudio(NaN);
    registerStreamingAudio("pad-1", "layer-1", el);
    registerStreamingAudio("pad-2", "layer-2", el);

    // Unregister only one — the other's listener must survive
    unregisterStreamingAudio("pad-1", "layer-1", el);

    Object.defineProperty(el, "duration", { value: 10, configurable: true });
    (el as unknown as { dispatchEvent: (e: Event) => boolean }).dispatchEvent(new Event("loadedmetadata"));

    // pad-2/layer-2 listener still fired and updated caches
    expect(_padBestStreamingAudio.has("pad-2")).toBe(true);
    expect(_layerBestStreamingAudio.has("layer-2")).toBe(true);
  });

  it("re-registering the same element before metadata fires aborts the previous listener", () => {
    const el = makeAudio(NaN);
    registerStreamingAudio("pad-1", "layer-1", el);
    registerStreamingAudio("pad-1", "layer-1", el); // re-register: aborts the first listener
    clearLayerStreamingAudio("pad-1", "layer-1");   // aborts the second listener

    Object.defineProperty(el, "duration", { value: 10, configurable: true });
    (el as unknown as { dispatchEvent: (e: Event) => boolean }).dispatchEvent(new Event("loadedmetadata"));

    // Both listeners aborted — caches must stay empty
    expect(_padBestStreamingAudio.has("pad-1")).toBe(false);
    expect(_layerBestStreamingAudio.has("layer-1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Stop cleanup timeout tracking
// ---------------------------------------------------------------------------

describe("stop cleanup timeout tracking", () => {
  it("clearAllAudioState cancels registered stop cleanup timeouts so they do not fire", async () => {
    vi.useFakeTimers();
    const { clearAllAudioState, addStopCleanupTimeout } = await import("./audioState");

    const spy = vi.fn();
    const id = setTimeout(spy, 9999);
    addStopCleanupTimeout(id);

    clearAllAudioState();

    vi.runAllTimers();
    expect(spy).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("stop cleanup timeout removes itself from tracking when it fires naturally", async () => {
    vi.useFakeTimers();
    const { clearAllAudioState, addStopCleanupTimeout, deleteStopCleanupTimeout } = await import("./audioState");

    const spy = vi.fn();
    const id = setTimeout(() => {
      deleteStopCleanupTimeout(id);
      spy();
    }, 100);
    addStopCleanupTimeout(id);

    // Let the timeout fire naturally — spy should be called
    vi.runAllTimers();
    expect(spy).toHaveBeenCalledOnce();

    // clearAllAudioState after natural completion should be a no-op (set is already empty)
    expect(() => clearAllAudioState()).not.toThrow();

    vi.useRealTimers();
  });
});

// ── Per-pad limiter ───────────────────────────────────────────────────────────

describe("getPadGain limiter wiring", () => {
  it("creates a DynamicsCompressorNode and connects padGain → limiter → masterGain", () => {
    const mockGain = makeMockGain();
    const mockLimiter = makeMockCompressor();
    const mockMaster = { connect: vi.fn() };
    mockCtx.createGain.mockReturnValueOnce(mockGain);
    mockCtx.createDynamicsCompressor.mockReturnValueOnce(mockLimiter);
    vi.mocked(getMasterGain).mockReturnValueOnce(mockMaster as any);

    getPadGain("pad-limiter-1");

    expect(mockCtx.createDynamicsCompressor).toHaveBeenCalledOnce();
    expect(mockGain.connect).toHaveBeenCalledWith(mockLimiter);
    expect(mockLimiter.connect).toHaveBeenCalledWith(mockMaster);
  });

  it("does not create a new limiter on subsequent calls for the same pad", () => {
    getPadGain("pad-limiter-2");
    vi.clearAllMocks();
    getPadGain("pad-limiter-2");
    expect(mockCtx.createDynamicsCompressor).not.toHaveBeenCalled();
  });
});

describe("clearAllPadGains limiter cleanup", () => {
  it("disconnects and clears limiters alongside pad gains", () => {
    const mockGain = makeMockGain();
    const mockLimiter = makeMockCompressor();
    mockCtx.createGain.mockReturnValueOnce(mockGain);
    mockCtx.createDynamicsCompressor.mockReturnValueOnce(mockLimiter);

    getPadGain("pad-cl-1");
    clearAllPadGains();

    expect(mockGain.disconnect).toHaveBeenCalledOnce();
    expect(mockLimiter.disconnect).toHaveBeenCalledOnce();
  });
});

describe("clearInactivePadGains limiter cleanup", () => {
  it("disconnects limiters for pads with no active voices", () => {
    const mockGain = makeMockGain();
    const mockLimiter = makeMockCompressor();
    mockCtx.createGain.mockReturnValueOnce(mockGain);
    mockCtx.createDynamicsCompressor.mockReturnValueOnce(mockLimiter);

    getPadGain("pad-inactive-1"); // no voices registered

    clearInactivePadGains();

    expect(mockGain.disconnect).toHaveBeenCalledOnce();
    expect(mockLimiter.disconnect).toHaveBeenCalledOnce();
  });

  it("does not disconnect limiters for pads that still have active voices", () => {
    const mockGain = makeMockGain();
    const mockLimiter = makeMockCompressor();
    mockCtx.createGain.mockReturnValueOnce(mockGain);
    mockCtx.createDynamicsCompressor.mockReturnValueOnce(mockLimiter);

    getPadGain("pad-active-1");
    const voice = { stop: vi.fn(), setOnEnded: vi.fn(), setLoop: vi.fn() } as unknown as AudioVoice;
    recordVoice("pad-active-1", voice);

    clearInactivePadGains();

    expect(mockLimiter.disconnect).not.toHaveBeenCalled();
  });
});

describe("clearPadGainsForIds limiter cleanup", () => {
  it("disconnects limiters for the specified pad IDs", () => {
    const mockGain = makeMockGain();
    const mockLimiter = makeMockCompressor();
    mockCtx.createGain.mockReturnValueOnce(mockGain);
    mockCtx.createDynamicsCompressor.mockReturnValueOnce(mockLimiter);

    getPadGain("pad-scope-1");
    clearPadGainsForIds(new Set(["pad-scope-1"]));

    expect(mockGain.disconnect).toHaveBeenCalledOnce();
    expect(mockLimiter.disconnect).toHaveBeenCalledOnce();
  });
});

describe("markGainRamp / isAnyGainChanging", () => {
  beforeEach(async () => {
    const { clearAllAudioState } = await import("./audioState");
    mockCtx.currentTime = 0;
    clearAllAudioState();
  });

  it("isAnyGainChanging returns false in steady state (no fade, no ramp)", async () => {
    const { isAnyGainChanging } = await import("./audioState");
    expect(isAnyGainChanging()).toBe(false);
  });

  it("markGainRamp makes isAnyGainChanging return true before the deadline", async () => {
    const { markGainRamp, isAnyGainChanging } = await import("./audioState");
    mockCtx.currentTime = 10;
    markGainRamp(0.016); // deadline = 10 + 0.016 + 0.005 = 10.021
    mockCtx.currentTime = 10.010; // before deadline
    expect(isAnyGainChanging()).toBe(true);
  });

  it("isAnyGainChanging returns false and resets deadline after it expires", async () => {
    const { markGainRamp, isAnyGainChanging } = await import("./audioState");
    mockCtx.currentTime = 10;
    markGainRamp(0.016); // deadline = 10.021
    mockCtx.currentTime = 10.022; // past deadline
    expect(isAnyGainChanging()).toBe(false);
    // Deadline reset to -Infinity: calling again should stay false without a new ramp
    mockCtx.currentTime = 10.030;
    expect(isAnyGainChanging()).toBe(false);
  });

  it("markGainRamp uses max semantics — a shorter ramp does not shorten an existing deadline", async () => {
    const { markGainRamp, isAnyGainChanging } = await import("./audioState");
    mockCtx.currentTime = 10;
    markGainRamp(1.0); // deadline = 11.005
    mockCtx.currentTime = 10.5;
    markGainRamp(0.016); // candidate = 10.521 — shorter, must not replace 11.005
    mockCtx.currentTime = 10.8; // before original deadline, after shorter candidate
    expect(isAnyGainChanging()).toBe(true);
  });

  it("clearAllAudioState resets gainRampDeadline so isAnyGainChanging returns false", async () => {
    const { markGainRamp, isAnyGainChanging, clearAllAudioState } = await import("./audioState");
    mockCtx.currentTime = 10;
    markGainRamp(1.0); // deadline = 11.005
    mockCtx.currentTime = 10.5; // before deadline — would return true
    clearAllAudioState();
    expect(isAnyGainChanging()).toBe(false);
  });
});
