import { renderHook, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { useFadeMode } from "@/hooks/useFadeMode";
import { usePlaybackStore } from "@/state/playbackStore";
import { useUiStore, initialUiState } from "@/state/uiStore";
import { createMockPad, createMockLayer } from "@/test/factories";
import type { Pad } from "@/lib/schemas";

vi.mock("@/lib/audio/padPlayer", () => ({
  fadePadOut: vi.fn(),
  fadePadIn: vi.fn().mockResolvedValue(undefined),
  crossfadePads: vi.fn(),
  resolveFadeDuration: vi.fn().mockReturnValue(2000),
}));

import { fadePadOut, fadePadIn, crossfadePads } from "@/lib/audio/padPlayer";

const padA: Pad = createMockPad({ id: "pad-a", layers: [createMockLayer()] });
const padB: Pad = createMockPad({ id: "pad-b", layers: [createMockLayer()] });
const padEmpty: Pad = createMockPad({ id: "pad-empty", layers: [] });
const allPads = [padA, padB, padEmpty];

beforeEach(() => {
  vi.clearAllMocks();
  usePlaybackStore.setState({ playingPadIds: [], padVolumes: {} });
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
    usePlaybackStore.setState({ playingPadIds: [padA.id] });
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
  it("calls fadePadOut when tapping a playing pad", () => {
    usePlaybackStore.setState({ playingPadIds: [padA.id] });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterFade());
    act(() => result.current.onPadTap(padA.id));
    expect(fadePadOut).toHaveBeenCalledWith(padA, 2000);
    expect(result.current.mode).toBeNull();
  });

  it("calls fadePadIn when tapping a non-playing pad", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterFade());
    act(() => result.current.onPadTap(padA.id));
    expect(fadePadIn).toHaveBeenCalledWith(padA, 2000);
    expect(result.current.mode).toBeNull();
  });

  it("is a no-op when tapping an invalid pad", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterFade());
    act(() => result.current.onPadTap(padEmpty.id));
    expect(fadePadOut).not.toHaveBeenCalled();
    expect(fadePadIn).not.toHaveBeenCalled();
    expect(result.current.mode).toBe("fade");
  });
});

describe("useFadeMode — onPadTap in crossfade mode", () => {
  it("selects a pad on first tap", () => {
    usePlaybackStore.setState({ playingPadIds: [padB.id] }); // need ≥1 playing to enter crossfade
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id));
    expect(result.current.getPadFadeVisual(padA.id)).toMatch(/selected/);
  });

  it("deselects a pad on second tap", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id));
    act(() => result.current.onPadTap(padA.id));
    const visual = result.current.getPadFadeVisual(padA.id);
    expect(visual === null || !String(visual).match(/selected/)).toBe(true);
  });

  it("exits mode when selection drops to 0", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id));
    act(() => result.current.onPadTap(padA.id));
    expect(result.current.mode).toBeNull();
  });

  it("does not execute automatically when only playing pads are selected", () => {
    usePlaybackStore.setState({ playingPadIds: [padA.id, padB.id] });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id));
    act(() => result.current.onPadTap(padB.id));
    expect(crossfadePads).not.toHaveBeenCalled();
    expect(result.current.mode).toBe("crossfade");
  });
});

describe("useFadeMode — canExecute and execute", () => {
  it("canExecute is false with only playing pads selected", () => {
    usePlaybackStore.setState({ playingPadIds: [padA.id] });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id));
    expect(result.current.canExecute).toBe(false);
  });

  it("canExecute is true with ≥1 playing and ≥1 non-playing selected", () => {
    usePlaybackStore.setState({ playingPadIds: [padA.id] });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id));
    act(() => result.current.onPadTap(padB.id));
    expect(result.current.canExecute).toBe(true);
  });

  it("execute calls crossfadePads with correct pad lists and cancels mode", () => {
    usePlaybackStore.setState({ playingPadIds: [padA.id] });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id));
    act(() => result.current.onPadTap(padB.id));
    act(() => result.current.execute());
    expect(crossfadePads).toHaveBeenCalledWith([padA], [padB]);
    expect(result.current.mode).toBeNull();
  });

  it("execute is a no-op when canExecute is false", () => {
    usePlaybackStore.setState({ playingPadIds: [padA.id] });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id));
    act(() => result.current.execute());
    expect(crossfadePads).not.toHaveBeenCalled();
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

  it("returns 'crossfade-out' for playing pads in fade mode", () => {
    usePlaybackStore.setState({ playingPadIds: [padA.id] });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterFade());
    expect(result.current.getPadFadeVisual(padA.id)).toBe("crossfade-out");
  });

  it("returns 'crossfade-in' for non-playing pads in fade mode", () => {
    usePlaybackStore.setState({ playingPadIds: [] });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterFade());
    expect(result.current.getPadFadeVisual(padA.id)).toBe("crossfade-in");
  });

  it("returns 'crossfade-out' for playing unselected pads in crossfade mode", () => {
    usePlaybackStore.setState({ playingPadIds: [padA.id] });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    expect(result.current.getPadFadeVisual(padA.id)).toBe("crossfade-out");
  });

  it("returns 'crossfade-in' for non-playing unselected pads in crossfade mode", () => {
    usePlaybackStore.setState({ playingPadIds: [padB.id] }); // need ≥1 playing to enter crossfade
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    expect(result.current.getPadFadeVisual(padA.id)).toBe("crossfade-in");
  });

  it("returns 'selected-out' for a selected playing pad", () => {
    usePlaybackStore.setState({ playingPadIds: [padA.id] });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id));
    expect(result.current.getPadFadeVisual(padA.id)).toBe("selected-out");
  });

  it("returns 'selected-in' for a selected non-playing pad", () => {
    usePlaybackStore.setState({ playingPadIds: [padB.id] }); // need ≥1 playing to enter crossfade
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id));
    expect(result.current.getPadFadeVisual(padA.id)).toBe("selected-in");
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
    usePlaybackStore.setState({ playingPadIds: [padA.id] }); // need ≥1 playing to enter crossfade
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    expect(result.current.statusLabel).toBe("Select pads to crossfade");
  });

  it("is 'Ready — press X or Enter to execute' when canExecute is true", () => {
    usePlaybackStore.setState({ playingPadIds: [padA.id] });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id));
    act(() => result.current.onPadTap(padB.id));
    expect(result.current.statusLabel).toBe("Ready — press X or Enter to execute");
  });
});
