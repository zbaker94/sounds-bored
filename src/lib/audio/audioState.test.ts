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

import {
  getPadProgress,
  clearAllPadProgressInfo,
  clearAllLayerProgressInfo,
  setPadProgressInfo,
  computeAllPadProgress,
  computeAllLayerProgress,
  setLayerProgressInfo,
  isAnyGainChanging,
  clearAllAudioState,
} from "./audioState";
import {
  startFade,
  clearAllFades,
  addFadingIn,
} from "./fadeCoordinator";
import { register as registerStreaming, clearAll as clearAllStreaming, dispose as disposeStreaming, isPadStreaming } from "./streamingAudioLifecycle";
import { recordLayerVoice, clearAll as clearAllVoiceRegistry } from "./voiceRegistry";
import { clearAll as clearAllGainRegistry, markGainRamp } from "./gainRegistry";
import { clearAll as clearAllChainCycleState } from "./chainCycleState";
import type { AudioVoice } from "./audioVoice";

/**
 * Fade duration used in tests that need a fade to remain active for the entire
 * synchronous portion of the test. Set well above any realistic test runtime so
 * the fade completion timeout never fires before assertions.
 */
const NEVER_COMPLETES_MS = 10_000;

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockCtx.currentTime = 0;
  mockCtx.createGain.mockImplementation(() => makeMockGain());
  mockCtx.createDynamicsCompressor.mockImplementation(() => makeMockCompressor());
  // Reset every audioState collection in one call so private state like
  // pendingStopCleanupTimeouts and globalStopTimeoutId — which the per-suite
  // helpers do not touch — also starts each test clean.
  clearAllAudioState();
  clearAllGainRegistry();
  clearAllChainCycleState();
  clearAllStreaming();
  clearAllPadProgressInfo();
  clearAllFades();
  clearAllLayerProgressInfo();
  clearAllVoiceRegistry();
});

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

    registerStreaming("pad-1", "layer-1", audio1);
    registerStreaming("pad-1", "layer-2", audio2);

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

    registerStreaming("pad-1", "layer-1", audio);
    expect(getPadProgress("pad-1")).toBe(0);
  });

  it("updates progress when the best streaming element is unregistered", () => {
    const long = makeAudio(20, 10); // progress 0.5
    const short = makeAudio(5, 2);  // progress 0.4
    registerStreaming("pad-1", "layer-1", short);
    registerStreaming("pad-1", "layer-2", long);
    expect(getPadProgress("pad-1")).toBeCloseTo(0.5); // uses long (best)

    disposeStreaming("pad-1", "layer-2", long);
    expect(getPadProgress("pad-1")).toBeCloseTo(0.4); // now uses short
  });

  it("uses the provided currentTime instead of calling getAudioContext()", () => {
    setPadProgressInfo("pad-1", { startedAt: 0, duration: 4, isLooping: false });
    // mockCtx.currentTime is 0 by default — passing explicit value overrides it
    expect(getPadProgress("pad-1", 2)).toBeCloseTo(0.5);
    expect(getPadProgress("pad-1", 1)).toBeCloseTo(0.25);
  });
});

// ── computeAllPadProgress / computeAllLayerProgress ──────────────────────────

describe("computeAllPadProgress", () => {
  it("returns empty object when no voices active", () => {
    expect(computeAllPadProgress()).toEqual({});
  });

  it("does not short-circuit when streaming is active even if padProgressInfo is empty", () => {
    registerStreaming("pad-1", "layer-1", makeAudio(10, 5));
    recordLayerVoice("pad-1", "layer-1", makeVoice());
    const result = computeAllPadProgress();
    expect(result["pad-1"]).toBeCloseTo(0.5);
  });

  it("returns empty object after last streaming pad is disposed (short-circuit re-engages)", () => {
    const el = makeAudio(10, 5);
    registerStreaming("pad-1", "layer-1", el);
    recordLayerVoice("pad-1", "layer-1", makeVoice());
    expect(computeAllPadProgress()["pad-1"]).toBeCloseTo(0.5); // cache active

    disposeStreaming("pad-1", "layer-1", el);
    expect(computeAllPadProgress()).toEqual({}); // cache cleared → short-circuit
  });

  it("returns progress for pads that have progress info", () => {
    recordLayerVoice("pad-1", "layer-1", makeVoice());
    setPadProgressInfo("pad-1", { startedAt: 0, duration: 4, isLooping: false });
    mockCtx.currentTime = 2;

    const result = computeAllPadProgress();
    expect(result["pad-1"]).toBeCloseTo(0.5);
  });

  it("omits pads with no progress info", () => {
    recordLayerVoice("pad-1", "layer-1", makeVoice());
    // no setPadProgressInfo or streaming audio for pad-1

    const result = computeAllPadProgress();
    expect(result["pad-1"]).toBeUndefined();
  });

  it("handles multiple active pads", () => {
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

describe("computeAllLayerProgress — contexts with only chain fields (no progressInfo)", () => {
  it("returns empty object when all contexts have undefined progressInfo and no streaming layers", async () => {
    // Set up a context with chain fields but no progressInfo — should not appear in output
    const { setLayerChain } = await import("./chainCycleState");
    setLayerChain("layer-chain-only", []);
    expect(computeAllLayerProgress()).toEqual({});
  });

  it("excludes stopped layers (contexts with undefined progressInfo) from progress output", async () => {
    const { ensureLayerContext } = await import("./layerPlaybackContext");
    ensureLayerContext("layer-stopped"); // context exists but no progressInfo

    setLayerProgressInfo("layer-active", { startedAt: 0, duration: 4, isLooping: false });
    mockCtx.currentTime = 2;

    const result = computeAllLayerProgress();
    expect(result["layer-stopped"]).toBeUndefined();
    expect(result["layer-active"]).toBeCloseTo(0.5);
  });
});

describe("computeAllLayerProgress — streaming path uses cached best element", () => {
  it("returns progress for a streaming layer using the cached best element", () => {
    const el = makeAudio(10, 4);
    registerStreaming("pad-1", "layer-1", el);
    const progress = computeAllLayerProgress();
    expect(progress["layer-1"]).toBeCloseTo(0.4);
  });

  it("does not short-circuit when streaming layer cache is non-empty but layerProgressInfo is empty", () => {
    registerStreaming("pad-1", "layer-1", makeAudio(10, 2));
    const progress = computeAllLayerProgress();
    expect(progress["layer-1"]).toBeCloseTo(0.2);
  });

  it("returns empty object after last streaming layer is disposed (short-circuit re-engages)", () => {
    const el = makeAudio(10, 4);
    registerStreaming("pad-1", "layer-1", el);
    expect(computeAllLayerProgress()["layer-1"]).toBeCloseTo(0.4); // cache active

    disposeStreaming("pad-1", "layer-1", el);
    expect(computeAllLayerProgress()).toEqual({}); // cache cleared → short-circuit
  });

  it("buffer layer progress takes priority over streaming for the same layer ID", () => {
    registerStreaming("pad-1", "layer-1", makeAudio(10, 5));
    setLayerProgressInfo("layer-1", { startedAt: 0, duration: 10, isLooping: false });
    mockCtx.currentTime = 2;
    const progress = computeAllLayerProgress();
    // Buffer result = 0.2 (not streaming 0.5)
    expect(progress["layer-1"]).toBeCloseTo(0.2);
  });

  it("returns 0 for a streaming layer whose element has NaN duration", () => {
    registerStreaming("pad-1", "layer-1", makeAudio(NaN, 0));
    const progress = computeAllLayerProgress();
    expect(progress["layer-1"]).toBe(0);
  });

  it("returns empty object when no layers are active", () => {
    expect(computeAllLayerProgress()).toEqual({});
  });
});

// ── clearAllAudioState ───────────────────────────────────────────────────────

describe("clearAllAudioState", () => {
  it("clears all runtime audio state in a single call", async () => {
    vi.useFakeTimers();
    const {
      clearAllAudioState,
      setPadProgressInfo,
      getPadProgressInfo,
      setGlobalStopTimeout,
    } = await import("./audioState");
    const { startFade, isFadingOut } = await import("./fadeCoordinator");
    const { setLayerChain, setLayerCycleIndex, setLayerPlayOrder, setLayerPending, getLayerChain, getLayerCycleIndex, getLayerPlayOrder, isLayerPending } = await import("./chainCycleState");
    const { getPadGain, getOrCreateLayerGain, getLayerGain } = await import("./gainRegistry");
    const { isPadActive } = await import("./voiceRegistry");

    const padGain = getPadGain("pad-clearall");
    getOrCreateLayerGain("layer-clearall", 0.8, padGain);
    setPadProgressInfo("pad-clearall", { startedAt: 0, duration: 1, isLooping: false });
    setLayerChain("layer-clearall", []);
    setLayerCycleIndex("layer-clearall", 2);
    setLayerPlayOrder("layer-clearall", []);
    setLayerPending("layer-clearall");
    startFade("pad-clearall", 1.0, true, NEVER_COMPLETES_MS);

    // Register a streaming audio element so isPadStreaming returns true before clear
    const mockAudio = { pause: vi.fn(), currentTime: 0, duration: 10, addEventListener: vi.fn() } as unknown as HTMLAudioElement;
    registerStreaming("pad-clearall", "layer-clearall", mockAudio);
    expect(isPadStreaming("pad-clearall")).toBe(true);

    // Schedule a timeout (simulates stopAllPads post-ramp cleanup)
    const spy = vi.fn();
    const timeoutId = setTimeout(spy, 9999);
    setGlobalStopTimeout(timeoutId);

    clearAllAudioState();

    expect(isFadingOut("pad-clearall")).toBe(false);             // fade tracking cleared
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

  it("resets gain ramp deadline early so isAnyGainChanging() is false during teardown", () => {
    markGainRamp(5); // schedule a 5-second ramp
    expect(isAnyGainChanging()).toBe(true);
    clearAllAudioState();
    expect(isAnyGainChanging()).toBe(false);
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

// ---------------------------------------------------------------------------
// isAnyGainChanging — fade-state portion (gainRampDeadline tests live in gainRegistry.test.ts)
// ---------------------------------------------------------------------------

describe("isAnyGainChanging — fade tracking portion", () => {
  it("returns false in steady state (no fade, no ramp)", () => {
    expect(isAnyGainChanging()).toBe(false);
  });

  it("returns true when a pad is fading out", () => {
    startFade("pad-fade", 1.0, true, NEVER_COMPLETES_MS);
    expect(isAnyGainChanging()).toBe(true);
  });

  it("returns true when a fade timeout is pending", () => {
    startFade("pad-fade", 1.0, false, NEVER_COMPLETES_MS);
    expect(isAnyGainChanging()).toBe(true);
  });

  it("returns true when a pad is fading in", () => {
    addFadingIn("pad-1");
    expect(isAnyGainChanging()).toBe(true);
  });
});
