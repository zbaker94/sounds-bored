import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Playback store mock ───────────────────────────────────────────────────────
// A minimal pub/sub implementation that lets us verify the subscription selector
// behaviour: listeners registered with (selector, callback) should only fire
// when the selected value changes, not on every state update.

type StateListener<T> = (state: T, prevState: T) => void;
type SelectorListener<T, U> = [selector: (s: T) => U, callback: (val: U, prev: U) => void];

interface MockStoreState {
  masterVolume: number;
  playingPadIds: Set<string>;
  padVolumes: Record<string, number>;
}

let mockStoreState: MockStoreState = { masterVolume: 100, playingPadIds: new Set(), padVolumes: {} };
const listeners: Array<StateListener<MockStoreState> | SelectorListener<MockStoreState, unknown>> = [];

const mockUsePlaybackStore = {
  getState: () => mockStoreState,
  /** Supports both the full-state listener AND the selector overload (subscribeWithSelector). */
  subscribe: vi.fn((selectorOrListener: any, callbackOrUndefined?: any) => {
    if (typeof callbackOrUndefined === "function") {
      // Selector overload: subscribe(selector, callback)
      listeners.push([selectorOrListener, callbackOrUndefined] as SelectorListener<MockStoreState, unknown>);
    } else {
      // Full-state overload: subscribe(listener)
      listeners.push(selectorOrListener as StateListener<MockStoreState>);
    }
    return () => {};
  }),
  setState: (partial: Partial<MockStoreState>) => {
    const prev = mockStoreState;
    mockStoreState = { ...prev, ...partial };
    for (const entry of listeners) {
      if (Array.isArray(entry)) {
        const [selector, callback] = entry as SelectorListener<MockStoreState, unknown>;
        const prevVal = selector(prev);
        const nextVal = selector(mockStoreState);
        if (prevVal !== nextVal) callback(nextVal, prevVal);
      } else {
        (entry as StateListener<MockStoreState>)(mockStoreState, prev);
      }
    }
  },
};

vi.mock("@/state/playbackStore", () => ({
  usePlaybackStore: mockUsePlaybackStore,
  initialPlaybackState: {},
}));

// ── AudioContext mock ─────────────────────────────────────────────────────────

let mockGainValue = 1;
const mockGainNode = {
  get gain() { return { get value() { return mockGainValue; }, set value(v: number) { mockGainValue = v; } }; },
  connect: vi.fn(),
};

function MockAudioContext(this: any) {
  this.createGain = vi.fn(() => mockGainNode);
  this.destination = {};
  this.state = "running";
  this.resume = vi.fn();
}
vi.stubGlobal("AudioContext", MockAudioContext);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("getMasterGain — masterVolume subscription", () => {
  beforeEach(async () => {
    vi.resetModules();
    // Reset store state and clear all listeners
    mockStoreState = { masterVolume: 100, playingPadIds: new Set(), padVolumes: {} };
    listeners.length = 0;
    mockGainValue = 1;
    mockUsePlaybackStore.subscribe.mockClear();
  });

  it("initializes gain.value from masterVolume at creation time", async () => {
    mockStoreState = { ...mockStoreState, masterVolume: 60 };
    const { getMasterGain } = await import("./audioContext");
    getMasterGain();
    expect(mockGainValue).toBe(0.6);
  });

  it("updates gain.value when masterVolume changes", async () => {
    const { getMasterGain } = await import("./audioContext");
    getMasterGain();

    mockUsePlaybackStore.setState({ masterVolume: 50 });

    expect(mockGainValue).toBe(0.5);
  });

  it("does NOT update gain.value when an unrelated store field changes", async () => {
    const { getMasterGain } = await import("./audioContext");
    getMasterGain();
    const valueBefore = mockGainValue;

    // Unrelated state changes — should not touch gain.value
    mockUsePlaybackStore.setState({ playingPadIds: new Set(["pad-1"]) });
    expect(mockGainValue).toBe(valueBefore);

    mockUsePlaybackStore.setState({ padVolumes: { "pad-1": 0.5 } });
    expect(mockGainValue).toBe(valueBefore);
  });
});
