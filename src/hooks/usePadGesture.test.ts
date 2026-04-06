import { renderHook, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { usePadGesture, DRAG_RAMP_MS } from "@/hooks/usePadGesture";
import { usePlaybackStore } from "@/state/playbackStore";
import type { Pad } from "@/lib/schemas";

vi.mock("@/lib/audio/padPlayer", () => ({
  triggerPad: vi.fn().mockResolvedValue(undefined),
  setPadVolume: vi.fn(),
  resetPadGain: vi.fn(),
  releasePadHoldLayers: vi.fn(),
  stopPad: vi.fn(),
  isPadFading: vi.fn().mockReturnValue(false),
  freezePadAtCurrentVolume: vi.fn(),
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
    usePlaybackStore.setState({ playingPadIds: [], padVolumes: {}, volumeTransitioningPadIds: [] });
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
    renderHook(() => usePadGesture(oneShotPad));

    // No transition should be started for a quick tap (hold timer never fires)
    expect(usePlaybackStore.getState().volumeTransitioningPadIds).not.toContain(oneShotPad.id);
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
    expect(usePlaybackStore.getState().volumeTransitioningPadIds).not.toContain(oneShotPad.id);
  });

  it("cancels hold timer if pointer is released quickly", () => {
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => {
      result.current.gestureHandlers.onPointerUp(makePointerEvent({ clientY: 300 }));
    });

    // Advance past hold timer — transition should never have started (timer was cancelled)
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(usePlaybackStore.getState().volumeTransitioningPadIds).not.toContain(oneShotPad.id);
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

  it("starts volume transition at 0 for non-playing pad after 150ms", () => {
    usePlaybackStore.setState({ playingPadIds: [], padVolumes: {}, volumeTransitioningPadIds: [] });
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(usePlaybackStore.getState().volumeTransitioningPadIds).toContain(oneShotPad.id);
    expect(usePlaybackStore.getState().padVolumes[oneShotPad.id]).toBe(0);
  });

  it("starts volume transition at stored volume for already-playing pad after 150ms", () => {
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

    expect(usePlaybackStore.getState().volumeTransitioningPadIds).toContain(oneShotPad.id);
    expect(usePlaybackStore.getState().padVolumes[oneShotPad.id]).toBe(0.7);
  });

  it("triggers pad on pointer up after hold (when no drag occurred)", () => {
    usePlaybackStore.setState({ playingPadIds: [], padVolumes: {}, volumeTransitioningPadIds: [] });
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

    // Must trigger at 1.0 — pad is not active so triggerVolume() returns 1.0,
    // even though padVolumes[id] was set to 0 by the hold timer for display.
    expect(triggerPad).toHaveBeenCalledTimes(1);
    expect(triggerPad).toHaveBeenCalledWith(oneShotPad, 1.0);
  });

  it("clears volume transition on pointer up", () => {
    usePlaybackStore.setState({ playingPadIds: [], padVolumes: {}, volumeTransitioningPadIds: [] });
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(usePlaybackStore.getState().volumeTransitioningPadIds).toContain(oneShotPad.id);

    act(() => {
      result.current.gestureHandlers.onPointerUp(makePointerEvent({ clientY: 300 }));
    });

    expect(usePlaybackStore.getState().volumeTransitioningPadIds).not.toContain(oneShotPad.id);
  });
});

// ─── Drag phase ───────────────────────────────────────────────────────────────

describe("usePadGesture — drag phase", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    usePlaybackStore.setState({ playingPadIds: [], padVolumes: {}, volumeTransitioningPadIds: [] });
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

  it("clears volume transition on pointer up after drag", () => {
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

    expect(usePlaybackStore.getState().volumeTransitioningPadIds).not.toContain(oneShotPad.id);
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
      isPadActive: (padId: string) => padId === oneShotPad.id,
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
    usePlaybackStore.setState({ playingPadIds: [], padVolumes: {}, volumeTransitioningPadIds: [] });
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

  it("resets pad gain to 1.0 on pointer up so next trigger always starts at full volume", () => {
    vi.mocked(resetPadGain).mockClear();
    const { result } = renderHook(() => usePadGesture(holdPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => {
      result.current.gestureHandlers.onPointerUp(makePointerEvent({ clientY: 300 }));
    });

    expect(resetPadGain).toHaveBeenCalledWith(holdPad.id);
  });
});

// ─── Mixed hold + one-shot pads ───────────────────────────────────────────────

describe("usePadGesture — mixed hold + one-shot pad", () => {
  const mixedPad: Pad = {
    id: "pad-mixed",
    name: "Mixed Pad",
    layers: [
      {
        id: "layer-hold",
        selection: { type: "assigned", instances: [] },
        arrangement: "simultaneous",
        playbackMode: "hold",
        retriggerMode: "restart",
        volume: 1.0,
      },
      {
        id: "layer-oneshot",
        selection: { type: "assigned", instances: [] },
        arrangement: "simultaneous",
        playbackMode: "one-shot",
        retriggerMode: "restart",
        volume: 1.0,
      },
    ],
    muteTargetPadIds: [],
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(triggerPad).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("triggers at 1.0 when only the one-shot layer is fading (hold layer inactive)", () => {
    // Simulate: one-shot is active (fading tail), hold layer is not active.
    // padVolumes may be near 0 from a previous drag. triggerVolume() must return
    // 1.0, not the stale near-zero padVolume.
    usePlaybackStore.setState({
      playingPadIds: [mixedPad.id],
      padVolumes: { [mixedPad.id]: 0.02 },
      isPadActive: (padId: string) => padId === mixedPad.id,
      isLayerActive: (layerId: string) => layerId === "layer-oneshot",
    });

    const { result } = renderHook(() => usePadGesture(mixedPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });

    // Hold layer must trigger at 1.0, not at the stale 0.02 padVolume
    expect(triggerPad).toHaveBeenCalledTimes(1);
    expect(triggerPad).toHaveBeenCalledWith(mixedPad, 1.0);
  });

  it("triggers at current padVolume when the hold layer itself is active (re-press while holding)", () => {
    // Simulate: hold layer is actively playing at volume 0.7.
    // triggerVolume() should honour the current padVolume.
    usePlaybackStore.setState({
      playingPadIds: [mixedPad.id],
      padVolumes: { [mixedPad.id]: 0.7 },
      isPadActive: (padId: string) => padId === mixedPad.id,
      isLayerActive: (layerId: string) => layerId === "layer-hold",
    });

    const { result } = renderHook(() => usePadGesture(mixedPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });

    expect(triggerPad).toHaveBeenCalledTimes(1);
    expect(triggerPad).toHaveBeenCalledWith(mixedPad, 0.7);
  });

  it("initialises display bar at 1.0 (not stale padVolume) when only one-shot layer is fading", () => {
    // wasPlayingAtStart is false for a fresh hold-layer press (only one-shot active).
    // The hold timer must use 1.0, not the stale 0.02 padVolume, so the display bar
    // starts at full height matching the actual trigger volume.
    usePlaybackStore.setState({
      playingPadIds: [mixedPad.id],
      padVolumes: { [mixedPad.id]: 0.02 },
      isPadActive: (padId: string) => padId === mixedPad.id,
      isLayerActive: (layerId: string) => layerId === "layer-oneshot",
    });

    const { result } = renderHook(() => usePadGesture(mixedPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    // Advance to hold phase
    act(() => { vi.advanceTimersByTime(150); });

    // Hold timer writes startVolume to padVolumes for the display bar.
    // wasPlayingAtStart=false → vol = 1.0 (hold-layer fresh trigger).
    expect(usePlaybackStore.getState().padVolumes[mixedPad.id]).toBe(1.0);
  });
});

// ─── H1 fix: startY staleness ─────────────────────────────────────────────────

describe("usePadGesture — startY staleness fix", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    usePlaybackStore.setState({ playingPadIds: [], padVolumes: {}, isPadActive: () => false });
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

    // Drag 40px up from hold-start (320 → 280) — this activates drag phase (dragStartTime = now)
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 280 }));
    });

    // Advance time to full ramp so rampFactor = 1.0
    act(() => {
      vi.advanceTimersByTime(DRAG_RAMP_MS);
    });

    // Fire move again at same position — now at full ramp, linear
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 280 }));
    });

    // Volume applied should reflect 40px drag from hold-start (Y=320), not from pointer-down (Y=300)
    // Linear at full ramp: 0 + 1.0 × (40/200) = 0.2
    // If startY were wrong (300 instead of 320), deltaY = 300-280 = 20 → 20/200 = 0.1
    expect(setPadVolume).toHaveBeenCalledWith(oneShotPad.id, expect.any(Number));
    const calls = vi.mocked(setPadVolume).mock.calls;
    const appliedVolume = calls[calls.length - 1][1];
    expect(appliedVolume).toBeCloseTo(0.2, 5);
  });
});

// ─── Time-based sensitivity ramp ─────────────────────────────────────────────

describe("usePadGesture — time-based sensitivity ramp", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    usePlaybackStore.setState({ playingPadIds: [], padVolumes: {}, isPadActive: () => false });
    vi.mocked(setPadVolume).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("has zero sensitivity at drag start (rampFactor = 0)", () => {
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => { vi.advanceTimersByTime(150); }); // hold activates, startVolume = 0

    // First move crosses DRAG_PX threshold — drag activates at t=0
    // rampFactor = 0, so newVolume should equal startVolume (0)
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 290 }));
    });

    const calls = vi.mocked(setPadVolume).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const volumeAtDragStart = calls[calls.length - 1][1];
    expect(volumeAtDragStart).toBe(0); // startVolume, no ramp applied yet
  });

  it("has half sensitivity at half ramp duration", () => {
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => { vi.advanceTimersByTime(150); }); // hold, startVolume = 0
    vi.mocked(setPadVolume).mockClear();

    // Activate drag
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 290 }));
    });
    vi.mocked(setPadVolume).mockClear();

    // Advance to half ramp
    act(() => { vi.advanceTimersByTime(DRAG_RAMP_MS / 2); });

    // Move to 50px up from hold-start (300 → 250)
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 250 }));
    });

    // deltaY = 300 - 250 = 50px from hold-start
    // linear = 50/200 = 0.25; rampFactor = 0.5; newVolume = 0 + 0.5 × 0.25 = 0.125
    const calls = vi.mocked(setPadVolume).mock.calls;
    const vol = calls[calls.length - 1][1];
    expect(vol).toBeCloseTo(0.125, 3);
  });

  it("has full sensitivity at full ramp duration", () => {
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => { vi.advanceTimersByTime(150); }); // hold, startVolume = 0

    // Activate drag
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 290 }));
    });
    vi.mocked(setPadVolume).mockClear();

    // Advance to full ramp
    act(() => { vi.advanceTimersByTime(DRAG_RAMP_MS); });

    // Move 40px up from hold-start
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 260 }));
    });

    // deltaY = 300 - 260 = 40; rampFactor = 1.0; newVolume = 0 + 1.0 × (40/200) = 0.2
    const calls = vi.mocked(setPadVolume).mock.calls;
    const vol = calls[calls.length - 1][1];
    expect(vol).toBeCloseTo(0.2, 5);
  });

  it("full range still clamps at 1.0 after ramp completes", () => {
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 500 }));
    });
    act(() => { vi.advanceTimersByTime(150); }); // hold, startVolume = 0

    // Activate drag — 5px exceeds DRAG_PX (4) threshold
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 495 }));
    });

    act(() => { vi.advanceTimersByTime(DRAG_RAMP_MS); });

    // Move 200px up (full DRAG_RANGE_PX) → should clamp to 1.0
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 300 }));
    });

    const calls = vi.mocked(setPadVolume).mock.calls;
    const vol = calls[calls.length - 1][1];
    expect(vol).toBe(1.0);
  });
});

// ─── onPointerCancel ──────────────────────────────────────────────────────────

describe("usePadGesture — onPointerCancel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    usePlaybackStore.setState({ playingPadIds: [], padVolumes: {}, isPadActive: () => false });
    vi.mocked(setPadVolume).mockClear();
    vi.mocked(stopPad).mockClear();
    vi.mocked(resetPadGain).mockClear();
    vi.mocked(releasePadHoldLayers).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears volume transition when cancelled during drag", () => {
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => { vi.advanceTimersByTime(150); }); // hold activates

    // Enter drag
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 290 }));
    });
    expect(usePlaybackStore.getState().volumeTransitioningPadIds).toContain(oneShotPad.id);

    act(() => {
      result.current.gestureHandlers.onPointerCancel(makePointerEvent({ clientY: 290 }));
    });

    expect(usePlaybackStore.getState().volumeTransitioningPadIds).not.toContain(oneShotPad.id);
  });

  it("stops pad and resets gain when cancelled during drag at near-zero volume", () => {
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => { vi.advanceTimersByTime(150); }); // hold activates, startVolume = 0

    // Enter drag — volume stays near zero (rampFactor=0 at drag start)
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 290 }));
    });

    act(() => {
      result.current.gestureHandlers.onPointerCancel(makePointerEvent({ clientY: 290 }));
    });

    expect(stopPad).toHaveBeenCalledWith(oneShotPad);
    expect(resetPadGain).toHaveBeenCalledWith(oneShotPad.id);
  });

  it("releases hold layers when cancelled on a hold-mode pad", () => {
    const holdPad: Pad = {
      ...oneShotPad,
      id: "hold-pad",
      layers: [{ ...oneShotPad.layers[0], playbackMode: "hold" }],
    };
    const { result } = renderHook(() => usePadGesture(holdPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => { vi.advanceTimersByTime(150); });

    act(() => {
      result.current.gestureHandlers.onPointerCancel(makePointerEvent({ clientY: 300 }));
    });

    expect(releasePadHoldLayers).toHaveBeenCalledWith(holdPad);
  });

  it("resets pad gain to 1.0 on pointer cancel so next trigger always starts at full volume", () => {
    const holdPad: Pad = {
      ...oneShotPad,
      id: "hold-pad",
      layers: [{ ...oneShotPad.layers[0], playbackMode: "hold" }],
    };
    vi.mocked(resetPadGain).mockClear();
    const { result } = renderHook(() => usePadGesture(holdPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => { vi.advanceTimersByTime(150); });

    act(() => {
      result.current.gestureHandlers.onPointerCancel(makePointerEvent({ clientY: 300 }));
    });

    expect(resetPadGain).toHaveBeenCalledWith(holdPad.id);
  });
});
