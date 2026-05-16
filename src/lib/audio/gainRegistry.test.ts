import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { getMasterGain } from "./audioContext";
import {
  getPadGain,
  getLivePadVolume,
  forEachActivePadGain,
  forEachActiveLayerGain,
  getOrCreateLayerGain,
  getLayerGain,
  clearAllPadGains,
  clearAllLayerGains,
  clearPadGainsForIds,
  clearLayerGainsForIds,
  clearInactivePadGains,
  markGainRamp,
  isGainRampPending,
  resetGainRampDeadline,
  clearAll,
} from "./gainRegistry";
import { setLayerChain, getLayerChain } from "./chainCycleState";
import { getLayerContext } from "./layerPlaybackContext";

beforeEach(() => {
  vi.clearAllMocks();
  mockCtx.currentTime = 0;
  mockCtx.createGain.mockImplementation(() => makeMockGain());
  mockCtx.createDynamicsCompressor.mockImplementation(() => makeMockCompressor());
  clearAll();
});

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
    expect(mockCtx.createGain).toHaveBeenCalledTimes(1);
  });

  it("creates separate GainNodes for different pads", () => {
    const gain1 = getPadGain("pad-1");
    const gain2 = getPadGain("pad-2");
    expect(gain1).not.toBe(gain2);
    expect(mockCtx.createGain).toHaveBeenCalledTimes(2);
  });

  it("connects the created GainNode to a DynamicsCompressorNode (limiter)", () => {
    const gain = getPadGain("pad-limiter-basic") as unknown as ReturnType<typeof makeMockGain>;
    // Find the connect call whose argument has DynamicsCompressor-shaped fields.
    const connectCalls = gain.connect.mock.calls;
    const compressorConnect = connectCalls.find(([target]) => {
      return (
        target &&
        typeof target === "object" &&
        "threshold" in target &&
        "knee" in target &&
        "ratio" in target &&
        "attack" in target &&
        "release" in target
      );
    });
    expect(compressorConnect).toBeDefined();
  });
});

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

  it("forces a fresh GainNode to be created on a subsequent getPadGain call", () => {
    getPadGain("pad-fresh");
    const callCountBefore = mockCtx.createGain.mock.calls.length;
    clearAllPadGains();
    getPadGain("pad-fresh");
    const callCountAfter = mockCtx.createGain.mock.calls.length;
    expect(callCountAfter - callCountBefore).toBe(1);
  });
});

describe("getOrCreateLayerGain", () => {
  beforeEach(() => {
    clearAllLayerGains();
    mockCtx.createGain.mockImplementation(makeMockGain);
  });

  it("sets gain.value to the normalized [0,1] volume on creation", () => {
    const padGain = getPadGain("pad-gain-test");
    const layerGain = getOrCreateLayerGain("layer-vol-test", "pad-test", 0.8, padGain);
    expect(layerGain.gain.value).toBe(0.8);
  });

  it("sets gain.value to 0 when volume is 0", () => {
    const padGain = getPadGain("pad-gain-test");
    const layerGain = getOrCreateLayerGain("layer-zero", "pad-test", 0, padGain);
    expect(layerGain.gain.value).toBe(0);
  });

  it("sets gain.value to 1 when volume is 1", () => {
    const padGain = getPadGain("pad-gain-test");
    const layerGain = getOrCreateLayerGain("layer-full", "pad-test", 1, padGain);
    expect(layerGain.gain.value).toBe(1);
  });

  it("connects the new gain node to padGain", () => {
    const padGain = getPadGain("pad-gain-test");
    const layerGain = getOrCreateLayerGain("layer-connect", "pad-test", 0.5, padGain);
    expect(layerGain.connect).toHaveBeenCalledWith(padGain);
  });

  it("does not call cancelScheduledValues on first creation", () => {
    const padGain = getPadGain("pad-gain-test");
    const layerGain = getOrCreateLayerGain("layer-first-create", "pad-test", 0.8, padGain) as unknown as ReturnType<typeof makeMockGain>;
    expect(layerGain.gain.cancelScheduledValues).not.toHaveBeenCalled();
  });

  it("returns the cached gain node on subsequent calls for the same layerId", () => {
    const padGain = getPadGain("pad-gain-test");
    const countBefore = mockCtx.createGain.mock.calls.length;
    const first = getOrCreateLayerGain("layer-cache", "pad-test", 0.8, padGain);
    const second = getOrCreateLayerGain("layer-cache", "pad-test", 0.8, padGain);
    expect(second).toBe(first);
    expect(mockCtx.createGain.mock.calls.length - countBefore).toBe(1);
  });

  it("calls cancelScheduledValues before setValueAtTime on cache hit", () => {
    const padGain = getPadGain("pad-gain-test");
    const layerGain = getOrCreateLayerGain("layer-cancel", "pad-test", 0.8, padGain) as unknown as ReturnType<typeof makeMockGain>;
    getOrCreateLayerGain("layer-cancel", "pad-test", 0.5, padGain);
    expect(layerGain.gain.cancelScheduledValues).toHaveBeenCalledWith(mockCtx.currentTime);
    const cancelOrder = layerGain.gain.cancelScheduledValues.mock.invocationCallOrder[0];
    const setOrder = layerGain.gain.setValueAtTime.mock.invocationCallOrder[0];
    expect(cancelOrder).toBeLessThan(setOrder);
  });

  it("calls setValueAtTime with the normalized [0,1] volume on cache hit", () => {
    const padGain = getPadGain("pad-gain-test");
    const layerGain = getOrCreateLayerGain("layer-sync", "pad-test", 0.8, padGain);
    getOrCreateLayerGain("layer-sync", "pad-test", 0.5, padGain);
    expect(layerGain.gain.setValueAtTime).toHaveBeenLastCalledWith(0.5, mockCtx.currentTime);
  });

  it("clamps volume > 1 to 1", () => {
    const padGain = getPadGain("pad-gain-test");
    const layerGain = getOrCreateLayerGain("layer-over", "pad-test", 1.5, padGain);
    expect(layerGain.gain.value).toBe(1);
  });

  it("clamps negative volume to 0", () => {
    const padGain = getPadGain("pad-gain-test");
    const layerGain = getOrCreateLayerGain("layer-neg", "pad-test", -0.5, padGain);
    expect(layerGain.gain.value).toBe(0);
  });

  it("defaults to 1 for NaN volume to avoid Web Audio RangeError", () => {
    const padGain = getPadGain("pad-gain-test");
    const layerGain = getOrCreateLayerGain("layer-nan", "pad-test", NaN, padGain);
    expect(layerGain.gain.value).toBe(1);
  });
});

describe("clearAllLayerGains", () => {
  it("disconnects all layer gain nodes before clearing", () => {
    const padGain = getPadGain("pad-1");
    const layerGain1 = getOrCreateLayerGain("layer-1", "pad-test", 0.8, padGain);
    const layerGain2 = getOrCreateLayerGain("layer-2", "pad-test", 0.5, padGain);

    clearAllLayerGains();

    expect(layerGain1.disconnect).toHaveBeenCalledTimes(1);
    expect(layerGain2.disconnect).toHaveBeenCalledTimes(1);
  });

  it("empties the map so a subsequent getOrCreateLayerGain call creates a new node", () => {
    const padGain = getPadGain("pad-1");
    const first = getOrCreateLayerGain("layer-1", "pad-test", 0.8, padGain);
    clearAllLayerGains();
    const second = getOrCreateLayerGain("layer-1", "pad-test", 0.8, padGain);
    expect(second).not.toBe(first);
  });

  it("is safe to call on an empty map", () => {
    expect(() => clearAllLayerGains()).not.toThrow();
  });
});

describe("getPadGain limiter wiring", () => {
  it("creates a DynamicsCompressorNode and connects padGain → limiter → masterGain", () => {
    const mockGain = makeMockGain();
    const mockLimiter = makeMockCompressor();
    const mockMaster = { connect: vi.fn() };
    mockCtx.createGain.mockReturnValueOnce(mockGain);
    mockCtx.createDynamicsCompressor.mockReturnValueOnce(mockLimiter);
    vi.mocked(getMasterGain).mockReturnValueOnce(mockMaster as unknown as GainNode);

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

    getPadGain("pad-inactive-1");

    // Empty active set — pad-inactive-1 is not active
    clearInactivePadGains(new Set());

    expect(mockGain.disconnect).toHaveBeenCalledOnce();
    expect(mockLimiter.disconnect).toHaveBeenCalledOnce();
  });

  it("does not disconnect limiters for pads that still have active voices", () => {
    const mockGain = makeMockGain();
    const mockLimiter = makeMockCompressor();
    mockCtx.createGain.mockReturnValueOnce(mockGain);
    mockCtx.createDynamicsCompressor.mockReturnValueOnce(mockLimiter);

    getPadGain("pad-active-1");

    // Caller passes the active pad ID — limiter should be preserved
    clearInactivePadGains(new Set(["pad-active-1"]));

    expect(mockLimiter.disconnect).not.toHaveBeenCalled();
  });

  it("disconnects only inactive pads when the active set is a partial subset", () => {
    const gainA = makeMockGain();
    const limiterA = makeMockCompressor();
    const gainB = makeMockGain();
    const limiterB = makeMockCompressor();
    mockCtx.createGain.mockReturnValueOnce(gainA).mockReturnValueOnce(gainB);
    mockCtx.createDynamicsCompressor.mockReturnValueOnce(limiterA).mockReturnValueOnce(limiterB);

    getPadGain("pad-A");
    getPadGain("pad-B");

    clearInactivePadGains(new Set(["pad-A"]));

    // pad-A is active — its gain and limiter must be preserved
    expect(gainA.disconnect).not.toHaveBeenCalled();
    expect(limiterA.disconnect).not.toHaveBeenCalled();
    // pad-B is inactive — both gain and limiter must be torn down
    expect(gainB.disconnect).toHaveBeenCalledOnce();
    expect(limiterB.disconnect).toHaveBeenCalledOnce();
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

describe("forEachActivePadGain", () => {
  it("iterates only pad IDs from the passed-in active set", () => {
    getPadGain("pad-A");
    getPadGain("pad-B");
    getPadGain("pad-C");

    const visited: string[] = [];
    forEachActivePadGain(new Set(["pad-A", "pad-C"]), (padId) => {
      visited.push(padId);
    });

    expect(visited.sort()).toEqual(["pad-A", "pad-C"]);
    expect(visited).not.toContain("pad-B");
  });

  it("passes the correct GainNode for each active pad ID to the callback", () => {
    const gainA = getPadGain("pad-A");
    const gainB = getPadGain("pad-B");

    const seen = new Map<string, GainNode>();
    forEachActivePadGain(new Set(["pad-A", "pad-B"]), (padId, gain) => {
      seen.set(padId, gain);
    });

    expect(seen.get("pad-A")).toBe(gainA);
    expect(seen.get("pad-B")).toBe(gainB);
  });

  it("silently skips active pad IDs with no registered GainNode", () => {
    getPadGain("pad-real");

    const visited: string[] = [];
    expect(() =>
      forEachActivePadGain(new Set(["pad-real", "pad-ghost"]), (padId) => {
        visited.push(padId);
      }),
    ).not.toThrow();

    expect(visited).toEqual(["pad-real"]);
  });

  it("never calls the callback when activePadIds is empty", () => {
    getPadGain("pad-A");
    const cb = vi.fn();
    forEachActivePadGain(new Set(), cb);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("forEachActiveLayerGain", () => {
  it("iterates only layer IDs from the passed-in active set", () => {
    const padGain = getPadGain("pad-1");
    getOrCreateLayerGain("layer-A", "pad-test", 0.5, padGain);
    getOrCreateLayerGain("layer-B", "pad-test", 0.5, padGain);
    getOrCreateLayerGain("layer-C", "pad-test", 0.5, padGain);

    const visited: string[] = [];
    forEachActiveLayerGain(new Set(["layer-A", "layer-C"]), (layerId) => {
      visited.push(layerId);
    });

    expect(visited.sort()).toEqual(["layer-A", "layer-C"]);
    expect(visited).not.toContain("layer-B");
  });

  it("passes the correct GainNode for each active layer ID to the callback", () => {
    const padGain = getPadGain("pad-1");
    const layerA = getOrCreateLayerGain("layer-A", "pad-test", 0.5, padGain);
    const layerB = getOrCreateLayerGain("layer-B", "pad-test", 0.5, padGain);

    const seen = new Map<string, GainNode>();
    forEachActiveLayerGain(new Set(["layer-A", "layer-B"]), (layerId, gain) => {
      seen.set(layerId, gain);
    });

    expect(seen.get("layer-A")).toBe(layerA);
    expect(seen.get("layer-B")).toBe(layerB);
  });

  it("silently skips active layer IDs with no registered GainNode", () => {
    const padGain = getPadGain("pad-1");
    getOrCreateLayerGain("layer-real", "pad-test", 0.5, padGain);

    const visited: string[] = [];
    expect(() =>
      forEachActiveLayerGain(new Set(["layer-real", "layer-ghost"]), (layerId) => {
        visited.push(layerId);
      }),
    ).not.toThrow();

    expect(visited).toEqual(["layer-real"]);
  });

  it("never calls the callback when activeLayerIds is empty", () => {
    const padGain = getPadGain("pad-1");
    getOrCreateLayerGain("layer-A", "pad-test", 0.5, padGain);
    const cb = vi.fn();
    forEachActiveLayerGain(new Set(), cb);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("getLivePadVolume", () => {
  it("returns undefined when no GainNode exists for the padId", () => {
    expect(getLivePadVolume("pad-missing")).toBeUndefined();
  });

  it("returns the current gain.value (default 1.0) after getPadGain creates a node", () => {
    getPadGain("pad-vol");
    expect(getLivePadVolume("pad-vol")).toBe(1);
  });
});

describe("clearLayerGainsForIds", () => {
  it("disconnects and removes only the specified layer IDs", () => {
    const padGain = getPadGain("pad-1");
    const layerA = getOrCreateLayerGain("layer-A", "pad-test", 0.5, padGain) as unknown as ReturnType<typeof makeMockGain>;

    clearLayerGainsForIds(new Set(["layer-A"]));

    expect(layerA.disconnect).toHaveBeenCalledOnce();
    expect(getLayerGain("layer-A")).toBeUndefined();
  });

  it("leaves other layer IDs intact", () => {
    const padGain = getPadGain("pad-1");
    const layerA = getOrCreateLayerGain("layer-A", "pad-test", 0.5, padGain) as unknown as ReturnType<typeof makeMockGain>;
    const layerB = getOrCreateLayerGain("layer-B", "pad-test", 0.5, padGain) as unknown as ReturnType<typeof makeMockGain>;

    clearLayerGainsForIds(new Set(["layer-A"]));

    expect(layerA.disconnect).toHaveBeenCalledOnce();
    expect(layerB.disconnect).not.toHaveBeenCalled();
    expect(getLayerGain("layer-B")).toBe(layerB as unknown as GainNode);
  });

  it("is a no-op for unknown layer IDs", () => {
    const padGain = getPadGain("pad-1");
    getOrCreateLayerGain("layer-A", "pad-test", 0.5, padGain);

    expect(() => clearLayerGainsForIds(new Set(["layer-ghost"]))).not.toThrow();
    expect(getLayerGain("layer-A")).toBeDefined();
  });
});

describe("getLayerGain", () => {
  it("returns undefined for an unknown layer ID", () => {
    expect(getLayerGain("layer-missing")).toBeUndefined();
  });

  it("returns the same GainNode created by getOrCreateLayerGain", () => {
    const padGain = getPadGain("pad-1");
    const created = getOrCreateLayerGain("layer-1", "pad-test", 0.5, padGain);
    expect(getLayerGain("layer-1")).toBe(created);
  });
});

describe("markGainRamp / isGainRampPending", () => {
  it("isGainRampPending returns false in steady state (no ramp scheduled)", () => {
    expect(isGainRampPending()).toBe(false);
  });

  it("markGainRamp makes isGainRampPending return true before the deadline", () => {
    mockCtx.currentTime = 10;
    markGainRamp(0.016); // deadline = 10 + 0.016 + 0.005 = 10.021
    mockCtx.currentTime = 10.010; // before deadline
    expect(isGainRampPending()).toBe(true);
  });

  it("isGainRampPending returns false and resets deadline after it expires", () => {
    mockCtx.currentTime = 10;
    markGainRamp(0.016); // deadline = 10.021
    mockCtx.currentTime = 10.022; // past deadline
    expect(isGainRampPending()).toBe(false);
    // Deadline reset to -Infinity: calling again should stay false without a new ramp
    mockCtx.currentTime = 10.030;
    expect(isGainRampPending()).toBe(false);
  });

  it("markGainRamp uses max semantics — a shorter ramp does not shorten an existing deadline", () => {
    mockCtx.currentTime = 10;
    markGainRamp(1.0); // deadline = 11.005
    mockCtx.currentTime = 10.5;
    markGainRamp(0.016); // candidate = 10.521 — shorter, must not replace 11.005
    mockCtx.currentTime = 10.8; // before original deadline, after shorter candidate
    expect(isGainRampPending()).toBe(true);
  });

  it("clearAll resets gainRampDeadline so isGainRampPending returns false", () => {
    mockCtx.currentTime = 10;
    markGainRamp(1.0); // deadline = 11.005
    mockCtx.currentTime = 10.5; // before deadline — would return true
    clearAll();
    expect(isGainRampPending()).toBe(false);
  });

  it("resetGainRampDeadline clears a pending deadline without disconnecting any nodes", () => {
    mockCtx.currentTime = 10;
    markGainRamp(1.0); // deadline = 11.005
    mockCtx.currentTime = 10.5; // before deadline
    expect(isGainRampPending()).toBe(true);

    resetGainRampDeadline();

    expect(isGainRampPending()).toBe(false);
  });
});

// ── Context map integration (M6) ─────────────────────────────────────────────

describe("LayerPlaybackContext integration — chain fields and gain coexist on same context", () => {
  it("setLayerChain followed by getOrCreateLayerGain for the same layerId stores both on one context", () => {
    // Simulate: chain setter runs first (before gainRegistry), then gain is wired.
    setLayerChain("layer-shared", []);

    const padGain = getPadGain("pad-1");
    getOrCreateLayerGain("layer-shared", "pad-test", 0.8, padGain);

    const ctx = getLayerContext("layer-shared");
    expect(ctx).toBeDefined();
    expect(ctx?.chainQueue).toEqual([]); // chain preserved
    expect(ctx?.gain).toBeDefined();     // gain set
    expect(ctx?.gain).not.toBeNull();
    expect(getLayerChain("layer-shared")).toEqual([]); // still readable via chainCycleState
    expect(getLayerGain("layer-shared")).toBeDefined(); // still readable via gainRegistry
  });

  it("clearAll deletes layer contexts so context map is empty after clearAll", () => {
    const padGain = getPadGain("pad-1");
    getOrCreateLayerGain("layer-1", "pad-test", 0.8, padGain);
    clearAll();
    expect(getLayerContext("layer-1")).toBeUndefined();
  });
});
