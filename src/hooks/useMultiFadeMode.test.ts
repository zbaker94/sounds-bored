import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMultiFadeMode } from "./useMultiFadeMode";
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { createMockProject, createMockScene, createMockPad, createMockHistoryEntry } from "@/test/factories";

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
});
