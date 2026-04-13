import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMultiFadeMode } from "./useMultiFadeMode";
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { useUiStore, initialUiState } from "@/state/uiStore";
import { createMockProject, createMockScene, createMockPad, createMockHistoryEntry } from "@/test/factories";
import { useHotkeys } from "react-hotkeys-hook";

// Mock audio functions
vi.mock("@/lib/audio/padPlayer", () => ({
  fadePadWithLevels: vi.fn().mockResolvedValue(undefined),
  resolveFadeDuration: vi.fn().mockReturnValue(1000),
}));

vi.mock("@/lib/audio/audioState", () => ({
  isPadActive: vi.fn().mockReturnValue(false),
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

const initialMultiFadeState = {
  active: false,
  originPadId: null,
  selectedPads: new Map(),
  reopenPadId: null,
};

beforeEach(() => {
  useProjectStore.setState({ ...initialProjectState });
  useMultiFadeStore.setState({ ...initialMultiFadeState });
  useUiStore.setState({ ...initialUiState });
  vi.clearAllMocks();
});

describe("useMultiFadeMode — active state", () => {
  it("is initially false", () => {
    const { result } = renderHook(() => useMultiFadeMode());
    expect(result.current.active).toBe(false);
  });

  it("becomes true after enter() is called", () => {
    const { result } = renderHook(() => useMultiFadeMode());
    act(() => {
      result.current.enter("pad-0");
    });
    expect(result.current.active).toBe(true);
  });
});

describe("useMultiFadeMode — selectedPads management", () => {
  it("is empty initially", () => {
    const { result } = renderHook(() => useMultiFadeMode());
    expect(result.current.selectedPads.size).toBe(0);
  });

  it("adds a pad after togglePad()", () => {
    const { result } = renderHook(() => useMultiFadeMode());
    act(() => {
      result.current.enter("pad-0");
    });
    act(() => {
      result.current.togglePad("pad-1", false, 1.0);
    });
    expect(result.current.selectedPads.has("pad-1")).toBe(true);
  });

  it("removes the pad when togglePad() is called again for the same pad", () => {
    const { result } = renderHook(() => useMultiFadeMode());
    act(() => {
      result.current.enter("pad-0");
    });
    act(() => {
      result.current.togglePad("pad-1", false, 1.0);
    });
    expect(result.current.selectedPads.has("pad-1")).toBe(true);
    act(() => {
      result.current.togglePad("pad-1", false, 1.0);
    });
    expect(result.current.selectedPads.has("pad-1")).toBe(false);
  });
});

describe("useMultiFadeMode — canExecute", () => {
  it("is false when not active", () => {
    const { result } = renderHook(() => useMultiFadeMode());
    expect(result.current.canExecute).toBe(false);
  });

  it("is false when active but no pads selected", () => {
    const { result } = renderHook(() => useMultiFadeMode());
    // enter() adds the origin pad to selectedPads, so we set store state directly
    act(() => {
      useMultiFadeStore.setState({ active: true, selectedPads: new Map(), originPadId: "pad-0" });
    });
    expect(result.current.canExecute).toBe(false);
  });

  it("is true when active and at least one pad is selected", () => {
    const { result } = renderHook(() => useMultiFadeMode());
    act(() => {
      result.current.enter("pad-0");
    });
    // enter() automatically adds the origin pad, so selectedPads.size >= 1
    expect(result.current.canExecute).toBe(true);
  });
});

describe("useMultiFadeMode — cancel()", () => {
  it("sets active to false after cancel()", () => {
    const { result } = renderHook(() => useMultiFadeMode());
    act(() => {
      result.current.enter("pad-0");
    });
    expect(result.current.active).toBe(true);
    act(() => {
      result.current.cancel();
    });
    expect(result.current.active).toBe(false);
  });

  it("sets reopenPadId to the originPadId after cancel()", () => {
    const { result } = renderHook(() => useMultiFadeMode());
    act(() => {
      result.current.enter("pad-0");
    });
    act(() => {
      result.current.cancel();
    });
    expect(result.current.reopenPadId).toBe("pad-0");
  });
});

describe("useMultiFadeMode — f/x hotkey registration", () => {
  it("registers f,x hotkeys with useHotkeys", () => {
    loadPadsInStore(1);
    renderHook(() => useMultiFadeMode());

    const calls = vi.mocked(useHotkeys).mock.calls;
    const fxCall = calls.find((c) => c[0] === "f,x");
    expect(fxCall).toBeDefined();
  });

  it("f,x handler executes multi-fade when canExecute is true", async () => {
    const { fadePadWithLevels } = await import("@/lib/audio/padPlayer");
    const pads = loadPadsInStore(1);

    // Set up active multi-fade state with a selected pad before rendering
    useMultiFadeStore.setState({
      active: true,
      originPadId: pads[0].id,
      selectedPads: new Map([[pads[0].id, { padId: pads[0].id, levels: [0, 80] as [number, number] }]]),
      reopenPadId: null,
    });

    renderHook(() => useMultiFadeMode());

    const calls = vi.mocked(useHotkeys).mock.calls;
    const fxCall = calls.find((c) => c[0] === "f,x");
    const handler = fxCall?.[1] as (() => void) | undefined;
    expect(handler).toBeDefined();

    act(() => { handler!(); });

    expect(fadePadWithLevels).toHaveBeenCalled();
  });

  it("f,x handler is a no-op when canExecute is false", async () => {
    const { fadePadWithLevels } = await import("@/lib/audio/padPlayer");
    loadPadsInStore(1);

    // Not active, no selected pads
    renderHook(() => useMultiFadeMode());

    const calls = vi.mocked(useHotkeys).mock.calls;
    const fxCall = calls.find((c) => c[0] === "f,x");
    const handler = fxCall?.[1] as (() => void) | undefined;
    expect(handler).toBeDefined();

    act(() => { handler!(); });

    expect(fadePadWithLevels).not.toHaveBeenCalled();
  });
});

describe("useMultiFadeMode — execute()", () => {
  it("calls fadePadWithLevels for each selected pad", async () => {
    const { fadePadWithLevels } = await import("@/lib/audio/padPlayer");
    const pads = loadPadsInStore(2);
    const { result } = renderHook(() => useMultiFadeMode());

    act(() => {
      result.current.enter(pads[0].id);
    });
    // Toggle to add a second pad
    act(() => {
      result.current.togglePad(pads[1].id, false, 1.0);
    });

    act(() => {
      result.current.execute();
    });

    // One call per selected pad (2 pads selected)
    expect(fadePadWithLevels).toHaveBeenCalledTimes(2);
  });

  it("resets active to false after execute()", () => {
    const pads = loadPadsInStore(1);
    const { result } = renderHook(() => useMultiFadeMode());

    act(() => {
      result.current.enter(pads[0].id);
    });
    act(() => {
      result.current.execute();
    });

    expect(result.current.active).toBe(false);
  });

  it("does nothing when canExecute is false", async () => {
    const { fadePadWithLevels } = await import("@/lib/audio/padPlayer");
    const { result } = renderHook(() => useMultiFadeMode());

    // Not active, no pads selected
    act(() => {
      result.current.execute();
    });

    expect(fadePadWithLevels).not.toHaveBeenCalled();
  });

  it("execute() passes correct fromLevel and toLevel to fadePadWithLevels", async () => {
    const { fadePadWithLevels } = await import("@/lib/audio/padPlayer");
    // Set up: one non-playing pad with custom levels
    const pads = loadPadsInStore(1);
    const pad = pads[0];

    // Enter multi-fade and set specific levels [20, 75]
    act(() => {
      useMultiFadeStore.getState().enterMultiFade("some-origin", false);
      useMultiFadeStore.getState().toggleMultiFadePad(pad.id, false, 0.75);
      useMultiFadeStore.getState().setMultiFadeLevels(pad.id, [20, 75]);
    });

    const { result } = renderHook(() => useMultiFadeMode());
    act(() => { result.current.execute(); });

    expect(fadePadWithLevels).toHaveBeenCalledWith(pad, 1000, 0.20, 0.75);
    // Note: 1000 comes from the mocked resolveFadeDuration
  });

  it("execute() calls fadePadWithLevels for both playing and non-playing pads", async () => {
    const { fadePadWithLevels } = await import("@/lib/audio/padPlayer");
    // Two pads: one playing, one not
    const pads = loadPadsInStore(2);
    const [pad0, pad1] = pads;

    act(() => {
      useMultiFadeStore.getState().enterMultiFade("some-origin", false);
      // pad0: playing=true, pad1: playing=false
      useMultiFadeStore.getState().toggleMultiFadePad(pad0.id, true, 0.8);
      useMultiFadeStore.getState().toggleMultiFadePad(pad1.id, false, 0.5);
    });

    const { result } = renderHook(() => useMultiFadeMode());
    act(() => { result.current.execute(); });

    // Both pads should be called
    expect(fadePadWithLevels).toHaveBeenCalledTimes(2);
    // Verify each pad was called with its correct pad object
    const calledPadIds = (fadePadWithLevels as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => (call[0] as { id: string }).id
    );
    expect(calledPadIds).toContain(pad0.id);
    expect(calledPadIds).toContain(pad1.id);
  });
});

describe("useMultiFadeMode — auto-cancel side effects", () => {
  it("cancels multi-fade when editMode becomes true", () => {
    const pads = loadPadsInStore(1);
    const { result } = renderHook(() => useMultiFadeMode());

    // Enter multi-fade so it is active
    act(() => {
      result.current.enter(pads[0].id);
    });
    expect(result.current.active).toBe(true);

    // Enable editMode
    act(() => {
      useUiStore.getState().toggleEditMode();
    });

    expect(result.current.active).toBe(false);
  });

  it("cancels multi-fade when an overlay is pushed to overlayStack", () => {
    const pads = loadPadsInStore(1);
    const { result } = renderHook(() => useMultiFadeMode());

    // Enter multi-fade so it is active
    act(() => {
      result.current.enter(pads[0].id);
    });
    expect(result.current.active).toBe(true);

    // Push an overlay onto the stack
    act(() => {
      useUiStore.getState().openOverlay("some-dialog", "dialog");
    });

    expect(result.current.active).toBe(false);
  });
});

describe("executeMultiFadeNow integration", () => {
  it("dispatches fadePadWithLevels for each selected pad and resets store", async () => {
    const { executeMultiFadeNow } = await import("./useMultiFadeMode");
    const { fadePadWithLevels } = await import("@/lib/audio/padPlayer");

    const pad1 = createMockPad({ id: "pad-exec-1" });
    const pad2 = createMockPad({ id: "pad-exec-2" });
    const scene = createMockScene({ pads: [pad1, pad2] });
    const entry = createMockHistoryEntry();
    useProjectStore.getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);

    useMultiFadeStore.setState({
      active: true,
      originPadId: "pad-exec-1",
      selectedPads: new Map([
        ["pad-exec-1", { padId: "pad-exec-1", levels: [0, 80] }],
        ["pad-exec-2", { padId: "pad-exec-2", levels: [20, 100] }],
      ]),
      reopenPadId: null,
    });

    executeMultiFadeNow();

    expect(fadePadWithLevels).toHaveBeenCalledTimes(2);
    expect(fadePadWithLevels).toHaveBeenCalledWith(
      expect.objectContaining({ id: "pad-exec-1" }),
      expect.any(Number),
      0,       // levels[0] / 100
      0.8,     // levels[1] / 100
    );
    expect(fadePadWithLevels).toHaveBeenCalledWith(
      expect.objectContaining({ id: "pad-exec-2" }),
      expect.any(Number),
      0.2,     // levels[0] / 100
      1.0,     // levels[1] / 100
    );

    // Store should be reset after execute
    expect(useMultiFadeStore.getState().active).toBe(false);
    expect(useMultiFadeStore.getState().selectedPads.size).toBe(0);
  });
});
