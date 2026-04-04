import { renderHook, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { usePadGesture } from "@/hooks/usePadGesture";
import { usePlaybackStore } from "@/state/playbackStore";
import type { Pad } from "@/lib/schemas";

vi.mock("@/lib/audio/padPlayer", () => ({
  triggerPad: vi.fn().mockResolvedValue(undefined),
  setPadVolume: vi.fn(),
  resetPadGain: vi.fn(),
  releasePadHoldLayers: vi.fn(),
  stopPad: vi.fn(),
}));

import {
  triggerPad,
  setPadVolume,
  resetPadGain,
  releasePadHoldLayers,
  stopPad,
} from "@/lib/audio/padPlayer";

// ─── Shared test fixtures ────────────────────────────────────────────────────

const oneShotPad: Pad = {
  id: "pad-oneshot",
  name: "One Shot Pad",
  layers: [
    {
      id: "layer-1",
      selection: { type: "assigned", instances: [] },
      arrangement: "simultaneous",
      playbackMode: "one-shot",
      retriggerMode: "restart",
      volume: 1.0,
    },
  ],
  muteTargetPadIds: [],
};

const holdPad: Pad = {
  id: "pad-hold",
  name: "Hold Pad",
  layers: [
    {
      id: "layer-hold",
      selection: { type: "assigned", instances: [] },
      arrangement: "simultaneous",
      playbackMode: "hold",
      retriggerMode: "restart",
      volume: 1.0,
    },
  ],
  muteTargetPadIds: [],
};

function makePointerEvent(overrides: {
  clientY: number;
  button?: number;
}): React.PointerEvent<HTMLButtonElement> {
  return {
    button: overrides.button ?? 0,
    clientY: overrides.clientY,
    pointerId: 1,
    currentTarget: { setPointerCapture: vi.fn() },
    preventDefault: vi.fn(),
  } as unknown as React.PointerEvent<HTMLButtonElement>;
}

function makeMouseEvent(): React.MouseEvent<HTMLButtonElement> {
  return {
    preventDefault: vi.fn(),
  } as unknown as React.MouseEvent<HTMLButtonElement>;
}

// ─── Normal tap (quick press + release, no hold) ─────────────────────────────

describe("usePadGesture — normal tap", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    usePlaybackStore.setState({ playingPadIds: [], padVolumes: {} });
    vi.mocked(triggerPad).mockClear();
    vi.mocked(setPadVolume).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("triggers pad on pointer up when released before hold timer fires", () => {
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    // Release before 150ms
    act(() => {
      result.current.gestureHandlers.onPointerUp(makePointerEvent({ clientY: 300 }));
    });

    expect(triggerPad).toHaveBeenCalledTimes(1);
    expect(triggerPad).toHaveBeenCalledWith(oneShotPad, expect.any(Number));
  });

  it("does not show fill during a quick tap", () => {
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });

    expect(result.current.fillVolume).toBeNull();

    act(() => {
      result.current.gestureHandlers.onPointerUp(makePointerEvent({ clientY: 300 }));
    });

    expect(result.current.fillVolume).toBeNull();
  });

  it("ignores non-primary button presses (right-click, middle-click)", () => {
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300, button: 2 }));
    });
    act(() => {
      result.current.gestureHandlers.onPointerUp(makePointerEvent({ clientY: 300, button: 2 }));
    });

    expect(triggerPad).not.toHaveBeenCalled();
    expect(result.current.fillVolume).toBeNull();
  });

  it("cancels hold timer if pointer is released quickly", () => {
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => {
      result.current.gestureHandlers.onPointerUp(makePointerEvent({ clientY: 300 }));
    });

    // Advance past hold timer — fill should never appear
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current.fillVolume).toBeNull();
    // triggerPad called once on up, not again from the (cancelled) timer path
    expect(triggerPad).toHaveBeenCalledTimes(1);
  });

  it("prevents context menu", () => {
    const { result } = renderHook(() => usePadGesture(oneShotPad));
    const event = makeMouseEvent();

    act(() => {
      result.current.gestureHandlers.onContextMenu(event);
    });

    expect(event.preventDefault).toHaveBeenCalled();
  });
});

// ─── Hold phase ───────────────────────────────────────────────────────────────

describe("usePadGesture — hold phase", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    usePlaybackStore.setState({ playingPadIds: [], padVolumes: {}, isPadActive: () => false });
    vi.mocked(triggerPad).mockClear();
    vi.mocked(setPadVolume).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows fill indicator at 0 for non-playing pad after 150ms", () => {
    usePlaybackStore.setState({ playingPadIds: [], padVolumes: {} });
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(result.current.fillVolume).toBe(0);
  });

  it("shows fill indicator at stored volume for already-playing pad after 150ms", () => {
    usePlaybackStore.setState({
      playingPadIds: [oneShotPad.id],
      padVolumes: { [oneShotPad.id]: 0.7 },
      isPadActive: (padId: string) => padId === oneShotPad.id,
    });
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(result.current.fillVolume).toBe(0.7);
  });

  it("triggers pad on pointer up after hold (when no drag occurred)", () => {
    usePlaybackStore.setState({ playingPadIds: [], padVolumes: {} });
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    act(() => {
      result.current.gestureHandlers.onPointerUp(makePointerEvent({ clientY: 300 }));
    });

    expect(triggerPad).toHaveBeenCalledTimes(1);
    expect(triggerPad).toHaveBeenCalledWith(oneShotPad, expect.any(Number));
  });

  it("clears fill indicator on pointer up", () => {
    usePlaybackStore.setState({ playingPadIds: [], padVolumes: {} });
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current.fillVolume).not.toBeNull();

    act(() => {
      result.current.gestureHandlers.onPointerUp(makePointerEvent({ clientY: 300 }));
    });

    expect(result.current.fillVolume).toBeNull();
  });
});

// ─── Drag phase ───────────────────────────────────────────────────────────────

describe("usePadGesture — drag phase", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    usePlaybackStore.setState({ playingPadIds: [], padVolumes: {} });
    vi.mocked(setPadVolume).mockClear();
    vi.mocked(stopPad).mockClear();
    vi.mocked(resetPadGain).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not call setPadVolume when movement is within DRAG_PX (4px) of hold-start", () => {
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });

    // Move only 3px — below DRAG_PX threshold of 4px
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 297 }));
    });

    expect(setPadVolume).not.toHaveBeenCalled();
  });

  it("calls setPadVolume once movement exceeds DRAG_PX", () => {
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });

    // Move 10px up — exceeds DRAG_PX
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 290 }));
    });

    expect(setPadVolume).toHaveBeenCalledWith(oneShotPad.id, expect.any(Number));
  });

  it("clears fill indicator on pointer up after drag", () => {
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 290 }));
    });

    act(() => {
      result.current.gestureHandlers.onPointerUp(makePointerEvent({ clientY: 290 }));
    });

    expect(result.current.fillVolume).toBeNull();
  });

  it("calls stopPad and resetPadGain when dragged to near-zero volume", () => {
    usePlaybackStore.setState({
      playingPadIds: [oneShotPad.id],
      padVolumes: { [oneShotPad.id]: 1.0 },
    });
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => {
      vi.advanceTimersByTime(150); // startVolume = 1.0
    });

    // Drag far down — volume hits 0
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 600 }));
    });
    act(() => {
      result.current.gestureHandlers.onPointerUp(makePointerEvent({ clientY: 600 }));
    });

    expect(stopPad).toHaveBeenCalledWith(oneShotPad);
    expect(resetPadGain).toHaveBeenCalledWith(oneShotPad.id);
  });

  it("does not call stopPad when dragged to non-zero volume", () => {
    usePlaybackStore.setState({
      playingPadIds: [oneShotPad.id],
      padVolumes: { [oneShotPad.id]: 1.0 },
    });
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });

    // Drag up slightly — volume stays well above 0
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 250 }));
    });
    act(() => {
      result.current.gestureHandlers.onPointerUp(makePointerEvent({ clientY: 250 }));
    });

    expect(stopPad).not.toHaveBeenCalled();
  });
});

// ─── Hold-mode layer pads ─────────────────────────────────────────────────────

describe("usePadGesture — hold-mode layer pad", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    usePlaybackStore.setState({ playingPadIds: [], padVolumes: {} });
    vi.mocked(triggerPad).mockClear();
    vi.mocked(releasePadHoldLayers).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("triggers pad immediately on pointer down (not on pointer up)", () => {
    const { result } = renderHook(() => usePadGesture(holdPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });

    expect(triggerPad).toHaveBeenCalledTimes(1);
    expect(triggerPad).toHaveBeenCalledWith(holdPad, expect.any(Number));
  });

  it("releases hold layers on pointer up", () => {
    const { result } = renderHook(() => usePadGesture(holdPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => {
      result.current.gestureHandlers.onPointerUp(makePointerEvent({ clientY: 300 }));
    });

    expect(releasePadHoldLayers).toHaveBeenCalledTimes(1);
    expect(releasePadHoldLayers).toHaveBeenCalledWith(holdPad);
  });

  it("does not trigger again on pointer up", () => {
    const { result } = renderHook(() => usePadGesture(holdPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => {
      result.current.gestureHandlers.onPointerUp(makePointerEvent({ clientY: 300 }));
    });

    // Only called once — at pointer down
    expect(triggerPad).toHaveBeenCalledTimes(1);
  });
});

// ─── H1 fix: startY staleness ─────────────────────────────────────────────────

describe("usePadGesture — startY staleness fix", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    usePlaybackStore.setState({ playingPadIds: [], padVolumes: {} });
    vi.mocked(setPadVolume).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not immediately activate drag when mouse drifted during down phase", () => {
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    // Press at Y=300
    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });

    // Drift 15px down during the 150ms hold window — all moves dropped in "down" phase
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 308 }));
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 315 }));
    });

    // Hold timer fires
    act(() => {
      vi.advanceTimersByTime(150);
    });

    // First move in hold phase at the drifted position (still at 315)
    // Before fix: deltaY = 300 - 315 = -15 → exceeds DRAG_PX, drag activates, setPadVolume called
    // After fix: startY reset to 315, deltaY = 0 → drag does NOT activate
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 315 }));
    });

    expect(setPadVolume).not.toHaveBeenCalled();
  });

  it("measures drag distance from where the cursor was at hold-start, not pointer-down", () => {
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    // Press at Y=300
    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });

    // Drift 20px down during down phase
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 320 }));
    });

    // Hold fires — startY should now be 320
    act(() => {
      vi.advanceTimersByTime(150);
    });

    // Drag 40px up from hold-start (320 → 280)
    // startVolume = 0 (non-playing pad)
    // Expected newVolume is based on deltaY = 320 - 280 = 40 from hold-start position
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 280 }));
    });

    // Volume applied should reflect 40px drag from hold-start (Y=320), not from pointer-down (Y=300)
    // With exponent 1.5 easing: normalizedDelta = 40/200 = 0.2; easedDelta = 0.2^1.5 ≈ 0.0894
    expect(setPadVolume).toHaveBeenCalledWith(oneShotPad.id, expect.any(Number));
    const appliedVolume = vi.mocked(setPadVolume).mock.calls[0][1];
    expect(appliedVolume).toBeCloseTo(0.0894, 3);
  });
});

// ─── Easing curve ─────────────────────────────────────────────────────────────

describe("usePadGesture — drag easing curve", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    usePlaybackStore.setState({ playingPadIds: [], padVolumes: {}, isPadActive: () => false });
    vi.mocked(setPadVolume).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function dragFromHoldStart(clientYStart: number, clientYEnd: number) {
    const { result } = renderHook(() => usePadGesture(oneShotPad));
    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: clientYStart }));
    });
    act(() => { vi.advanceTimersByTime(150); });
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: clientYEnd }));
    });
    const calls = vi.mocked(setPadVolume).mock.calls;
    vi.mocked(setPadVolume).mockClear();
    return calls.length > 0 ? calls[calls.length - 1][1] : null;
  }

  it("small drag produces less volume change than linear mapping", () => {
    // startVolume = 0 (non-playing). Drag 20px up from hold-start.
    // Linear: 0 + 20/200 = 0.10
    // Eased (exponent 1.5): 0 + (0.1)^1.5 ≈ 0.0316
    const volume = dragFromHoldStart(300, 280);
    expect(volume).not.toBeNull();
    expect(volume!).toBeLessThan(0.10);
    expect(volume!).toBeCloseTo(0.0316, 3);
  });

  it("full DRAG_RANGE_PX (200px) still reaches the full range boundary", () => {
    // startVolume = 0. Drag 200px up → should reach 1.0 (clamped).
    const volume = dragFromHoldStart(500, 300);
    expect(volume).toBe(1.0);
  });

  it("full DRAG_RANGE_PX downward from startVolume=1.0 reaches 0", () => {
    usePlaybackStore.setState({
      playingPadIds: [oneShotPad.id],
      padVolumes: { [oneShotPad.id]: 1.0 },
    });
    vi.mocked(setPadVolume).mockClear();

    const { result } = renderHook(() => usePadGesture(oneShotPad));
    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => { vi.advanceTimersByTime(150); }); // startVolume = 1.0
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 500 }));
    });

    const calls = vi.mocked(setPadVolume).mock.calls;
    expect(calls[calls.length - 1][1]).toBe(0);
  });

  it("easing is symmetric: equal distance up and down produces equal magnitude delta", () => {
    usePlaybackStore.setState({
      playingPadIds: [oneShotPad.id],
      padVolumes: { [oneShotPad.id]: 0.5 },
      isPadActive: (padId: string) => padId === oneShotPad.id,
    });

    // Drag 50px up from startVolume=0.5
    vi.mocked(setPadVolume).mockClear();
    const { result: r1 } = renderHook(() => usePadGesture(oneShotPad));
    act(() => {
      r1.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => { vi.advanceTimersByTime(150); });
    act(() => {
      r1.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 250 }));
    });
    const volumeUp = vi.mocked(setPadVolume).mock.calls.at(-1)![1];

    // Drag 50px down from startVolume=0.5
    vi.mocked(setPadVolume).mockClear();
    const { result: r2 } = renderHook(() => usePadGesture(oneShotPad));
    act(() => {
      r2.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => { vi.advanceTimersByTime(150); });
    act(() => {
      r2.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 350 }));
    });
    const volumeDown = vi.mocked(setPadVolume).mock.calls.at(-1)![1];

    expect(Math.abs(volumeUp - 0.5)).toBeCloseTo(Math.abs(0.5 - volumeDown), 5);
  });
});
