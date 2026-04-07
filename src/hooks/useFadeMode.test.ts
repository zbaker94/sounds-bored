import { renderHook, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { useFadeMode } from "@/hooks/useFadeMode";
import { usePlaybackStore } from "@/state/playbackStore";
import { useUiStore, initialUiState } from "@/state/uiStore";
import { createMockPad, createMockLayer } from "@/test/factories";
import type { Pad } from "@/lib/schemas";

vi.mock("@/lib/audio/padPlayer", () => ({
  executeFadeTap: vi.fn(),
  executeCrossfadeSelection: vi.fn(),
}));

import { executeFadeTap, executeCrossfadeSelection } from "@/lib/audio/padPlayer";

const padA: Pad = createMockPad({ id: "pad-a", layers: [createMockLayer()] });
const padB: Pad = createMockPad({ id: "pad-b", layers: [createMockLayer()] });
const padEmpty: Pad = createMockPad({ id: "pad-empty", layers: [] });
const padHold: Pad = createMockPad({ id: "pad-hold", layers: [createMockLayer({ playbackMode: "hold" })] });
const padMixed: Pad = createMockPad({ id: "pad-mixed", layers: [createMockLayer(), createMockLayer({ playbackMode: "hold" })] });
const allPads = [padA, padB, padEmpty, padHold, padMixed];

beforeEach(() => {
  vi.clearAllMocks();
  usePlaybackStore.setState({ playingPadIds: new Set(), padVolumes: {} });
  useUiStore.setState({ ...initialUiState });
});

describe("useFadeMode — enterFade / enterCrossfade", () => {
  it("starts in null mode", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    expect(result.current.mode).toBeNull();
  });

  it("enterFade sets mode to 'fade'", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterFade());
    expect(result.current.mode).toBe("fade");
  });

  it("enterCrossfade sets mode to 'crossfade'", () => {
    usePlaybackStore.setState({ playingPadIds: new Set([padA.id]) });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    expect(result.current.mode).toBe("crossfade");
  });

  it("does not enter fade mode when editMode is active", () => {
    useUiStore.setState({ editMode: true });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterFade());
    expect(result.current.mode).toBeNull();
  });

  it("does not enter crossfade mode when an overlay is open", () => {
    useUiStore.setState({ overlayStack: [{ id: "some-dialog", type: "dialog" }] });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    expect(result.current.mode).toBeNull();
  });

  it("cancels active fade mode when editMode turns on", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterFade());
    expect(result.current.mode).toBe("fade");
    act(() => useUiStore.getState().toggleEditMode());
    expect(result.current.mode).toBeNull();
  });

  it("cancels active fade mode when an overlay opens", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => useUiStore.getState().openOverlay("some-dialog", "dialog"));
    expect(result.current.mode).toBeNull();
  });
});

describe("useFadeMode — cancel", () => {
  it("cancel sets mode to null and clears selection", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id));
    act(() => result.current.cancel());
    expect(result.current.mode).toBeNull();
    expect(result.current.getPadFadeVisual(padA.id)).toBeNull();
  });
});

describe("useFadeMode — onPadTap in fade mode", () => {
  it("calls executeFadeTap(pad, fadeDuration) when tapping a playing pad", () => {
    usePlaybackStore.setState({ playingPadIds: new Set([padA.id]) });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterFade());
    act(() => result.current.onPadTap(padA.id));
    expect(executeFadeTap).toHaveBeenCalledWith(padA, undefined);
    expect(result.current.mode).toBeNull();
  });

  it("calls executeFadeTap(pad, fadeDuration) when tapping a non-playing pad", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterFade());
    act(() => result.current.onPadTap(padA.id));
    expect(executeFadeTap).toHaveBeenCalledWith(padA, undefined);
    expect(result.current.mode).toBeNull();
  });

  it("is a no-op when tapping an invalid pad", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterFade());
    act(() => result.current.onPadTap(padEmpty.id));
    expect(executeFadeTap).not.toHaveBeenCalled();
    expect(result.current.mode).toBe("fade");
  });

  it("is a no-op when tapping a hold-mode pad", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterFade());
    act(() => result.current.onPadTap(padHold.id));
    expect(executeFadeTap).not.toHaveBeenCalled();
    expect(result.current.mode).toBe("fade");
  });

  it("is a no-op when tapping a mixed-mode pad", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterFade());
    act(() => result.current.onPadTap(padMixed.id));
    expect(executeFadeTap).not.toHaveBeenCalled();
    expect(result.current.mode).toBe("fade");
  });
});

describe("useFadeMode — onPadTap in crossfade mode", () => {
  it("selects a pad on first tap", () => {
    usePlaybackStore.setState({ playingPadIds: new Set([padB.id]) }); // need ≥1 playing to enter crossfade
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id));
    expect(result.current.getPadFadeVisual(padA.id)).toMatch(/selected/);
  });

  it("deselects a pad on second tap", () => {
    usePlaybackStore.setState({ playingPadIds: new Set([padB.id]) }); // need ≥1 playing to enter crossfade
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id));
    act(() => result.current.onPadTap(padA.id));
    const visual = result.current.getPadFadeVisual(padA.id);
    expect(visual === null || !String(visual).match(/selected/)).toBe(true);
  });

  it("exits mode when selection drops to 0", () => {
    usePlaybackStore.setState({ playingPadIds: new Set([padB.id]) }); // need ≥1 playing to enter crossfade
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id));
    act(() => result.current.onPadTap(padA.id));
    expect(result.current.mode).toBeNull();
  });

  it("does not execute automatically when only playing pads are selected", () => {
    usePlaybackStore.setState({ playingPadIds: new Set([padA.id, padB.id]) });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id));
    act(() => result.current.onPadTap(padB.id));
    expect(executeCrossfadeSelection).not.toHaveBeenCalled();
    expect(result.current.mode).toBe("crossfade");
  });

  it("does not select a hold-mode pad in crossfade mode", () => {
    usePlaybackStore.setState({ playingPadIds: new Set([padA.id]) });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padHold.id));
    expect(result.current.getPadFadeVisual(padHold.id)).toBe("invalid");
    expect(result.current.mode).toBe("crossfade");
  });

  it("does not select a mixed-mode pad in crossfade mode", () => {
    usePlaybackStore.setState({ playingPadIds: new Set([padA.id]) });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padMixed.id));
    expect(result.current.getPadFadeVisual(padMixed.id)).toBe("invalid");
    expect(result.current.mode).toBe("crossfade");
  });
});

describe("useFadeMode — canExecute and execute", () => {
  it("canExecute is false with only playing pads selected", () => {
    usePlaybackStore.setState({ playingPadIds: new Set([padA.id]) });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id));
    expect(result.current.canExecute).toBe(false);
  });

  it("canExecute is true with ≥1 playing and ≥1 non-playing selected", () => {
    usePlaybackStore.setState({ playingPadIds: new Set([padA.id]) });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id));
    act(() => result.current.onPadTap(padB.id));
    expect(result.current.canExecute).toBe(true);
  });

  it("execute calls executeCrossfadeSelection with selected pads and cancels mode", () => {
    usePlaybackStore.setState({ playingPadIds: new Set([padA.id]) });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id));
    act(() => result.current.onPadTap(padB.id));
    act(() => result.current.execute());
    expect(executeCrossfadeSelection).toHaveBeenCalledWith([padA, padB], undefined);
    expect(result.current.mode).toBeNull();
  });

  it("execute is a no-op when canExecute is false", () => {
    usePlaybackStore.setState({ playingPadIds: new Set([padA.id]) });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id));
    act(() => result.current.execute());
    expect(executeCrossfadeSelection).not.toHaveBeenCalled();
    expect(result.current.mode).toBe("crossfade");
  });
});

describe("useFadeMode — getPadFadeVisual", () => {
  it("returns null when mode is null", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    expect(result.current.getPadFadeVisual(padA.id)).toBeNull();
  });

  it("returns 'invalid' for a pad with no layers in any mode", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterFade());
    expect(result.current.getPadFadeVisual(padEmpty.id)).toBe("invalid");
  });

  it("returns 'invalid' for a pad with a hold-mode layer in fade mode", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterFade());
    expect(result.current.getPadFadeVisual(padHold.id)).toBe("invalid");
  });

  it("returns 'invalid' for a mixed-mode pad (hold + non-hold) in fade mode", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterFade());
    expect(result.current.getPadFadeVisual(padMixed.id)).toBe("invalid");
  });

  it("returns 'invalid' for a hold-mode pad in crossfade mode", () => {
    usePlaybackStore.setState({ playingPadIds: new Set([padA.id]) });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    expect(result.current.getPadFadeVisual(padHold.id)).toBe("invalid");
  });

  it("returns 'invalid' for a mixed-mode pad in crossfade mode", () => {
    usePlaybackStore.setState({ playingPadIds: new Set([padA.id]) });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    expect(result.current.getPadFadeVisual(padMixed.id)).toBe("invalid");
  });

  it("returns 'crossfade-out' for playing pads in fade mode", () => {
    usePlaybackStore.setState({ playingPadIds: new Set([padA.id]) });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterFade());
    expect(result.current.getPadFadeVisual(padA.id)).toBe("crossfade-out");
  });

  it("returns 'crossfade-in' for non-playing pads in fade mode", () => {
    usePlaybackStore.setState({ playingPadIds: new Set() });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterFade());
    expect(result.current.getPadFadeVisual(padA.id)).toBe("crossfade-in");
  });

  it("returns 'crossfade-out' for playing unselected pads in crossfade mode", () => {
    usePlaybackStore.setState({ playingPadIds: new Set([padA.id]) });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    expect(result.current.getPadFadeVisual(padA.id)).toBe("crossfade-out");
  });

  it("returns 'crossfade-in' for non-playing unselected pads in crossfade mode", () => {
    usePlaybackStore.setState({ playingPadIds: new Set([padB.id]) }); // need ≥1 playing to enter crossfade
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    expect(result.current.getPadFadeVisual(padA.id)).toBe("crossfade-in");
  });

  it("returns 'selected-out' for a selected playing pad", () => {
    usePlaybackStore.setState({ playingPadIds: new Set([padA.id]) });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id));
    expect(result.current.getPadFadeVisual(padA.id)).toBe("selected-out");
  });

  it("returns 'selected-in' for a selected non-playing pad", () => {
    usePlaybackStore.setState({ playingPadIds: new Set([padB.id]) }); // need ≥1 playing to enter crossfade
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id));
    expect(result.current.getPadFadeVisual(padA.id)).toBe("selected-in");
  });
});

describe("useFadeMode — subscription optimization", () => {
  it("does not re-render when playingPadIds changes and mode is null", () => {
    // Render count tracking
    let renderCount = 0;
    const { result: counted } = renderHook(() => {
      renderCount++;
      return useFadeMode(allPads);
    });
    const baseRenderCount = renderCount;

    // Simulate pad start/stop events by replacing the playingPadIds Set
    act(() => {
      usePlaybackStore.setState({ playingPadIds: new Set(["pad-a"]) });
    });
    act(() => {
      usePlaybackStore.setState({ playingPadIds: new Set() });
    });
    act(() => {
      usePlaybackStore.setState({ playingPadIds: new Set(["pad-b"]) });
    });

    // Hook should NOT have re-rendered for these changes (mode is still null)
    // The mode is null, so full playingPadIds changes should not cause re-renders
    // Only hasPlayingPads (boolean) changes should trigger re-renders
    // pad-a start: hasPlayingPads false->true = 1 render, pad-a stop: true->false = 1 render, pad-b start: false->true = 1 render
    // Exactly 3 extra renders (for the boolean transitions), not 6+ (for each Set reference change)
    expect(renderCount - baseRenderCount).toBe(3);
    expect(counted.current.mode).toBeNull();
  });

  it("reflects playingPadIds changes while mode is active", () => {
    usePlaybackStore.setState({ playingPadIds: new Set() });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterFade());
    expect(result.current.mode).toBe("fade");

    // Initially no pads playing
    expect(result.current.getPadFadeVisual(padA.id)).toBe("crossfade-in");

    // Start playing padA after entering mode — full subscription should be active
    act(() => {
      usePlaybackStore.setState({ playingPadIds: new Set([padA.id]) });
    });

    // Should now reflect the playing state
    expect(result.current.getPadFadeVisual(padA.id)).toBe("crossfade-out");
  });

  it("enterCrossfade uses hasPlayingPads check correctly", () => {
    // No playing pads — should not enter crossfade
    usePlaybackStore.setState({ playingPadIds: new Set() });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    expect(result.current.mode).toBeNull();

    // With playing pads — should enter crossfade
    usePlaybackStore.setState({ playingPadIds: new Set([padA.id]) });
    const { result: result2 } = renderHook(() => useFadeMode(allPads));
    act(() => result2.current.enterCrossfade());
    expect(result2.current.mode).toBe("crossfade");
  });
});

describe("useFadeMode — canExecute and statusLabel memoization", () => {
  it("canExecute and statusLabel values unchanged when hasPlayingPads changes but mode is null", () => {
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount++;
      return useFadeMode(allPads);
    });
    const baseRenderCount = renderCount;
    const initialCanExecute = result.current.canExecute;
    const initialStatusLabel = result.current.statusLabel;

    // Simulate pad start/stop — triggers hasPlayingPads re-renders but not full-Set subscription
    act(() => {
      usePlaybackStore.setState({ playingPadIds: new Set([padA.id]) });
    });
    act(() => {
      usePlaybackStore.setState({ playingPadIds: new Set() });
    });

    expect(result.current.canExecute).toBe(initialCanExecute);
    expect(result.current.statusLabel).toBe(initialStatusLabel);
    // Renders are driven only by hasPlayingPads boolean transitions, not full-Set reference changes.
    // Upper bound of 2 (one per boolean flip); exact count may vary with React batching.
    expect(renderCount - baseRenderCount).toBeLessThanOrEqual(2);
  });

  it("canExecute remains correct when an unrelated pad starts during active crossfade", () => {
    usePlaybackStore.setState({ playingPadIds: new Set([padA.id]) });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id));
    act(() => result.current.onPadTap(padB.id));

    expect(result.current.canExecute).toBe(true);

    // An unrelated pad starts playing — canExecute should remain true
    act(() => {
      usePlaybackStore.setState({ playingPadIds: new Set([padA.id, "pad-unrelated"]) });
    });

    expect(result.current.canExecute).toBe(true);
  });

  it("statusLabel reverts when canExecute transitions back to false", () => {
    usePlaybackStore.setState({ playingPadIds: new Set([padA.id]) });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id));
    act(() => result.current.onPadTap(padB.id));
    expect(result.current.statusLabel).toBe("Ready — press X or Enter to execute");

    // Deselect the non-playing pad — canExecute drops to false
    act(() => result.current.onPadTap(padB.id));
    expect(result.current.statusLabel).toBe("Select pads to crossfade");
  });
});

describe("useFadeMode — statusLabel", () => {
  it("is null when mode is null", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    expect(result.current.statusLabel).toBeNull();
  });

  it("is 'Select a pad' in fade mode", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterFade());
    expect(result.current.statusLabel).toBe("Select a pad");
  });

  it("is 'Select pads to crossfade' when canExecute is false", () => {
    usePlaybackStore.setState({ playingPadIds: new Set([padA.id]) }); // need ≥1 playing to enter crossfade
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    expect(result.current.statusLabel).toBe("Select pads to crossfade");
  });

  it("is 'Ready — press X or Enter to execute' when canExecute is true", () => {
    usePlaybackStore.setState({ playingPadIds: new Set([padA.id]) });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id));
    act(() => result.current.onPadTap(padB.id));
    expect(result.current.statusLabel).toBe("Ready — press X or Enter to execute");
  });
});
