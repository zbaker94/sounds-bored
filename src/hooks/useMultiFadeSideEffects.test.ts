// src/hooks/useMultiFadeSideEffects.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMultiFadeSideEffects } from "./useMultiFadeSideEffects";
import { useMultiFadeStore, initialMultiFadeState } from "@/state/multiFadeStore";
import { useUiStore, initialUiState } from "@/state/uiStore";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { createMockProject, createMockScene, createMockPad, createMockHistoryEntry } from "@/test/factories";
import { useHotkeys } from "react-hotkeys-hook";

vi.mock("@/lib/audio/padPlayer", () => ({
  executeFadeTap: vi.fn(),
}));


vi.mock("react-hotkeys-hook", () => ({
  useHotkeys: vi.fn(),
}));

function loadPadsInStore(numPads = 2) {
  const pads = Array.from({ length: numPads }, (_, i) =>
    createMockPad({ id: `pad-${i}` })
  );
  const scene = createMockScene({ pads });
  useProjectStore
    .getState()
    .loadProject(createMockHistoryEntry(), createMockProject({ scenes: [scene] }), false);
  return pads;
}

beforeEach(() => {
  useProjectStore.setState({ ...initialProjectState });
  useMultiFadeStore.setState({ ...initialMultiFadeState });
  useUiStore.setState({ ...initialUiState });
  vi.clearAllMocks();
});

describe("useMultiFadeSideEffects — hotkeys", () => {
  it("registers f,x hotkeys with useHotkeys", () => {
    loadPadsInStore(1);
    renderHook(() => useMultiFadeSideEffects());

    const calls = vi.mocked(useHotkeys).mock.calls;
    const fxCall = calls.find((c) => c[0] === "enter,f,x");
    expect(fxCall).toBeDefined();
  });

  it("f,x handler executes multi-fade when active and pads selected", async () => {
    const { executeFadeTap } = await import("@/lib/audio/padPlayer");
    const pads = loadPadsInStore(1);

    useMultiFadeStore.setState({
      active: true,
      originPadId: pads[0].id,
      selectedPads: new Map([[pads[0].id, { padId: pads[0].id, levels: [0, 80] as [number, number] }]]),
      reopenPadId: null,
    });

    renderHook(() => useMultiFadeSideEffects());

    const calls = vi.mocked(useHotkeys).mock.calls;
    const fxCall = calls.find((c) => c[0] === "enter,f,x");
    const handler = fxCall?.[1] as (() => void) | undefined;
    expect(handler).toBeDefined();

    act(() => { handler!(); });

    expect(executeFadeTap).toHaveBeenCalled();
  });

  it("f,x handler is a no-op when not active", async () => {
    const { executeFadeTap } = await import("@/lib/audio/padPlayer");
    loadPadsInStore(1);

    renderHook(() => useMultiFadeSideEffects());

    const calls = vi.mocked(useHotkeys).mock.calls;
    const fxCall = calls.find((c) => c[0] === "enter,f,x");
    const handler = fxCall?.[1] as (() => void) | undefined;
    expect(handler).toBeDefined();

    act(() => { handler!(); });

    expect(executeFadeTap).not.toHaveBeenCalled();
  });

  it("escape handler cancels multi-fade when active", () => {
    const pads = loadPadsInStore(1);
    useMultiFadeStore.setState({
      active: true,
      originPadId: pads[0].id,
      selectedPads: new Map([[pads[0].id, { padId: pads[0].id, levels: [100, 0] as [number, number] }]]),
      reopenPadId: null,
    });

    renderHook(() => useMultiFadeSideEffects());

    const calls = vi.mocked(useHotkeys).mock.calls;
    const escCall = calls.find((c) => c[0] === "escape");
    const handler = escCall?.[1] as (() => void) | undefined;
    expect(handler).toBeDefined();

    act(() => { handler!(); });

    expect(useMultiFadeStore.getState().active).toBe(false);
  });

  it("escape handler is a no-op when not active", () => {
    renderHook(() => useMultiFadeSideEffects());

    const calls = vi.mocked(useHotkeys).mock.calls;
    const escCall = calls.find((c) => c[0] === "escape");
    const handler = escCall?.[1] as (() => void) | undefined;
    expect(handler).toBeDefined();

    const before = useMultiFadeStore.getState().active;
    act(() => { handler!(); });
    expect(useMultiFadeStore.getState().active).toBe(before);
  });
});

describe("useMultiFadeSideEffects — auto-cancel on editMode", () => {
  it("cancels multi-fade when editMode becomes true", () => {
    const pads = loadPadsInStore(1);
    renderHook(() => useMultiFadeSideEffects());

    act(() => { useMultiFadeStore.getState().enterMultiFade(pads[0].id, 100, 0); });
    expect(useMultiFadeStore.getState().active).toBe(true);

    act(() => { useUiStore.getState().toggleEditMode(); });

    expect(useMultiFadeStore.getState().active).toBe(false);
  });

  it("does not cancel when editMode is false and multi-fade is active", () => {
    const pads = loadPadsInStore(1);
    renderHook(() => useMultiFadeSideEffects());

    act(() => { useMultiFadeStore.getState().enterMultiFade(pads[0].id, 100, 0); });
    // Some other uiStore change that leaves editMode false
    act(() => { useUiStore.getState().setHoveredPadId("pad-0"); });

    expect(useMultiFadeStore.getState().active).toBe(true);
  });

  it("does not cancel when unrelated uiStore fields change", () => {
    const pads = loadPadsInStore(1);
    renderHook(() => useMultiFadeSideEffects());

    act(() => { useMultiFadeStore.getState().enterMultiFade(pads[0].id, 100, 0); });
    const cancelSpy = vi.spyOn(useMultiFadeStore.getState(), "cancelMultiFade");

    act(() => {
      useUiStore.getState().setHoveredPadId("pad-0");
      useUiStore.getState().setFadePopoverPadId("pad-0");
      useUiStore.getState().setFadePopoverTarget(0.5);
      useUiStore.getState().setScenePage("scene-1", 2);
      useUiStore.getState().setEditingPadId("pad-0");
    });

    expect(cancelSpy).not.toHaveBeenCalled();
    expect(useMultiFadeStore.getState().active).toBe(true);
  });

  it("re-cancels when editMode toggles true again after re-entering multi-fade", () => {
    const pads = loadPadsInStore(1);
    renderHook(() => useMultiFadeSideEffects());

    act(() => { useMultiFadeStore.getState().enterMultiFade(pads[0].id, 100, 0); });
    act(() => { useUiStore.getState().toggleEditMode(); });
    expect(useMultiFadeStore.getState().active).toBe(false);

    act(() => { useUiStore.getState().toggleEditMode(); });
    act(() => { useMultiFadeStore.getState().enterMultiFade(pads[0].id, 100, 0); });
    expect(useMultiFadeStore.getState().active).toBe(true);

    act(() => { useUiStore.getState().toggleEditMode(); });
    expect(useMultiFadeStore.getState().active).toBe(false);
  });
});

describe("useMultiFadeSideEffects — auto-cancel on overlay", () => {
  it("cancels multi-fade when an overlay is pushed to overlayStack", () => {
    const pads = loadPadsInStore(1);
    renderHook(() => useMultiFadeSideEffects());

    act(() => { useMultiFadeStore.getState().enterMultiFade(pads[0].id, 100, 0); });
    expect(useMultiFadeStore.getState().active).toBe(true);

    act(() => { useUiStore.getState().openOverlay("some-dialog", "dialog"); });

    expect(useMultiFadeStore.getState().active).toBe(false);
  });

  it("does not cancel when last overlay closes while multi-fade is active", () => {
    const pads = loadPadsInStore(1);
    renderHook(() => useMultiFadeSideEffects());

    // Open overlay first (selector=true), then enter multi-fade — no transition fires.
    // Closing the overlay (selector true→false) must not trigger cancelMultiFade.
    act(() => { useUiStore.getState().openOverlay("some-dialog", "dialog"); });
    act(() => { useMultiFadeStore.getState().enterMultiFade(pads[0].id, 100, 0); });

    act(() => { useUiStore.getState().closeOverlay("some-dialog"); });

    expect(useMultiFadeStore.getState().active).toBe(true);
  });
});

describe("useMultiFadeSideEffects — cleanup", () => {
  it("unsubscribes from uiStore on unmount", () => {
    const pads = loadPadsInStore(1);
    const { unmount } = renderHook(() => useMultiFadeSideEffects());

    act(() => { useMultiFadeStore.getState().enterMultiFade(pads[0].id, 100, 0); });
    unmount();

    const cancelSpy = vi.spyOn(useMultiFadeStore.getState(), "cancelMultiFade");
    act(() => { useUiStore.getState().toggleEditMode(); });

    expect(cancelSpy).not.toHaveBeenCalled();
    expect(useMultiFadeStore.getState().active).toBe(true);
  });
});
