import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMultiFadeMode } from "./useMultiFadeMode";
import { useMultiFadeStore, initialMultiFadeState } from "@/state/multiFadeStore";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { useUiStore, initialUiState } from "@/state/uiStore";
import { usePadMetricsStore, initialPadMetricsState } from "@/state/padMetricsStore";
import { createMockProject, createMockScene, createMockPad, createMockHistoryEntry } from "@/test/factories";
import * as audioLib from "@/lib/audio";

// Mock audio functions
vi.mock("@/lib/audio/padPlayer", () => ({
  executeFadeTap: vi.fn(),
  triggerPad: vi.fn().mockResolvedValue(undefined),
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
  usePadMetricsStore.setState({ ...initialPadMetricsState });
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
    const pads = loadPadsInStore(2);
    const { result } = renderHook(() => useMultiFadeMode());
    act(() => {
      result.current.enter(pads[0].id);
    });
    act(() => {
      result.current.togglePad(pads[1].id);
    });
    expect(result.current.selectedPads.has(pads[1].id)).toBe(true);
  });

  it("removes the pad when togglePad() is called again for the same pad", () => {
    const pads = loadPadsInStore(2);
    const { result } = renderHook(() => useMultiFadeMode());
    act(() => {
      result.current.enter(pads[0].id);
    });
    act(() => {
      result.current.togglePad(pads[1].id);
    });
    expect(result.current.selectedPads.has(pads[1].id)).toBe(true);
    act(() => {
      result.current.togglePad(pads[1].id);
    });
    expect(result.current.selectedPads.has(pads[1].id)).toBe(false);
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
  it("calls triggerPad for each non-playing pad with target=0", async () => {
    const { triggerPad } = await import("@/lib/audio/padPlayer");
    const pads = loadPadsInStore(2);
    const { result } = renderHook(() => useMultiFadeMode());

    act(() => { result.current.enter(pads[0].id); });
    act(() => { result.current.togglePad(pads[1].id); });
    act(() => { result.current.execute(); });

    // Both pads: not playing + target=0 → triggerPad, not executeFadeTap
    expect(triggerPad).toHaveBeenCalledTimes(2);
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
    const { executeFadeTap } = await import("@/lib/audio/padPlayer");
    const { result } = renderHook(() => useMultiFadeMode());

    // Not active, no pads selected
    act(() => {
      result.current.execute();
    });

    expect(executeFadeTap).not.toHaveBeenCalled();
  });

  it("execute() passes entry.levels[1] as fadeTargetVol override to executeFadeTap", async () => {
    const { executeFadeTap } = await import("@/lib/audio/padPlayer");
    const pads = loadPadsInStore(1);
    const pad = pads[0];

    act(() => {
      useMultiFadeStore.getState().enterMultiFade("some-origin", 100, 0);
      // levels[1]=75 > 0 → executeFadeTap path (not triggerPad)
      useMultiFadeStore.getState().toggleMultiFadePad(pad.id, 100, 75);
    });

    const { result } = renderHook(() => useMultiFadeMode());
    act(() => { result.current.execute(); });

    expect(executeFadeTap).toHaveBeenCalledWith(
      expect.objectContaining({ id: pad.id, fadeTargetVol: 75 }),
      undefined,
    );
  });

  it("execute() calls executeFadeTap for both playing and non-playing pads", async () => {
    const { executeFadeTap } = await import("@/lib/audio/padPlayer");
    const pads = loadPadsInStore(2);
    const [pad0, pad1] = pads;

    act(() => {
      useMultiFadeStore.getState().enterMultiFade("some-origin", 100, 0);
      useMultiFadeStore.getState().toggleMultiFadePad(pad0.id, 100, 80);
      useMultiFadeStore.getState().toggleMultiFadePad(pad1.id, 100, 50);
    });

    const { result } = renderHook(() => useMultiFadeMode());
    act(() => { result.current.execute(); });

    expect(executeFadeTap).toHaveBeenCalledTimes(2);
    const calledPadIds = (executeFadeTap as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => (call[0] as { id: string }).id
    );
    expect(calledPadIds).toContain(pad0.id);
    expect(calledPadIds).toContain(pad1.id);
  });
});


describe("useMultiFadeMode — volume initialization from live gain", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("enter() reads live padVolumes (not configured pad.volume) when pad is active mid-fade", () => {
    // pad.volume=80 so assertion (30) differs from both configured (80) and full-volume fallback (100)
    const pad = createMockPad({ id: "pad-live", volume: 80 });
    const scene = createMockScene({ pads: [pad] });
    useProjectStore.getState().loadProject(createMockHistoryEntry(), createMockProject({ scenes: [scene] }), false);
    usePadMetricsStore.setState({ padVolumes: { [pad.id]: 0.3 } });
    vi.spyOn(audioLib, "isPadActive").mockReturnValue(true);

    const { result } = renderHook(() => useMultiFadeMode());
    act(() => { result.current.enter(pad.id); });

    const entry = useMultiFadeStore.getState().selectedPads.get(pad.id);
    expect(entry?.levels[0]).toBeCloseTo(30);
  });

  it("enter() falls back to 100% when padVolumes has no entry (absent = full volume)", () => {
    const pads = loadPadsInStore(1);
    const pad = pads[0];
    usePadMetricsStore.setState({ padVolumes: {} });
    vi.spyOn(audioLib, "isPadActive").mockReturnValue(true);

    const { result } = renderHook(() => useMultiFadeMode());
    act(() => { result.current.enter(pad.id); });

    const entry = useMultiFadeStore.getState().selectedPads.get(pad.id);
    expect(entry?.levels[0]).toBeCloseTo(100);
  });

  it("enter() correctly handles zero gain (near-silent mid-fade)", () => {
    const pads = loadPadsInStore(1);
    const pad = pads[0];
    usePadMetricsStore.setState({ padVolumes: { [pad.id]: 0 } });
    vi.spyOn(audioLib, "isPadActive").mockReturnValue(true);

    const { result } = renderHook(() => useMultiFadeMode());
    act(() => { result.current.enter(pad.id); });

    const entry = useMultiFadeStore.getState().selectedPads.get(pad.id);
    expect(entry?.levels[0]).toBeCloseTo(0);
  });

  it("enter() yields 0 currentVol when pad is not active regardless of padVolumes", () => {
    const pads = loadPadsInStore(1);
    const pad = pads[0];
    usePadMetricsStore.setState({ padVolumes: { [pad.id]: 0.7 } });
    vi.spyOn(audioLib, "isPadActive").mockReturnValue(false);

    const { result } = renderHook(() => useMultiFadeMode());
    act(() => { result.current.enter(pad.id); });

    const entry = useMultiFadeStore.getState().selectedPads.get(pad.id);
    expect(entry?.levels[0]).toBeCloseTo(0);
  });

  it("togglePad() reads live padVolumes for a mid-fade active pad", () => {
    const pads = loadPadsInStore(2);
    const [originPad, targetPad] = pads;
    usePadMetricsStore.setState({ padVolumes: { [targetPad.id]: 0.5 } });
    vi.spyOn(audioLib, "isPadActive")
      .mockImplementation((padId) => padId === targetPad.id);

    const { result } = renderHook(() => useMultiFadeMode());
    act(() => { result.current.enter(originPad.id); });
    act(() => { result.current.togglePad(targetPad.id); });

    const entry = useMultiFadeStore.getState().selectedPads.get(targetPad.id);
    expect(entry?.levels[0]).toBeCloseTo(50);
  });

  it("togglePad() reads fresh padVolumes on each call", () => {
    const pads = loadPadsInStore(2);
    const [originPad, targetPad] = pads;
    usePadMetricsStore.setState({ padVolumes: { [targetPad.id]: 0.5 } });
    vi.spyOn(audioLib, "isPadActive")
      .mockImplementation((padId) => padId === targetPad.id);

    const { result } = renderHook(() => useMultiFadeMode());
    act(() => { result.current.enter(originPad.id); });
    act(() => { result.current.togglePad(targetPad.id); });
    // Remove then re-toggle with updated live gain
    act(() => { result.current.togglePad(targetPad.id); });
    usePadMetricsStore.setState({ padVolumes: { [targetPad.id]: 0.2 } });
    act(() => { result.current.togglePad(targetPad.id); });

    const entry = useMultiFadeStore.getState().selectedPads.get(targetPad.id);
    expect(entry?.levels[0]).toBeCloseTo(20);
  });
});

describe("executeMultiFadeNow integration", () => {
  it("calls triggerPad for a non-playing origin pad with target=0 (not a silent no-op)", async () => {
    const { executeMultiFadeNow } = await import("./useMultiFadeMode");
    const { triggerPad } = await import("@/lib/audio/padPlayer");

    const pad = createMockPad({ id: "pad-origin" }); // no fadeTargetVol → target=0
    const scene = createMockScene({ pads: [pad] });
    useProjectStore.getState().loadProject(createMockHistoryEntry(), createMockProject({ scenes: [scene] }), false);

    useMultiFadeStore.setState({
      active: true,
      originPadId: "pad-origin",
      selectedPads: new Map([["pad-origin", { padId: "pad-origin", levels: [100, 0] }]]),
      reopenPadId: null,
    });

    executeMultiFadeNow();

    expect(triggerPad).toHaveBeenCalledWith(expect.objectContaining({ id: "pad-origin" }));
    expect(useMultiFadeStore.getState().active).toBe(false);
  });

  it("dispatches executeFadeTap for each selected pad and resets store", async () => {
    const { executeMultiFadeNow } = await import("./useMultiFadeMode");
    const { executeFadeTap } = await import("@/lib/audio/padPlayer");

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

    expect(executeFadeTap).toHaveBeenCalledTimes(2);
    expect(executeFadeTap).toHaveBeenCalledWith(
      expect.objectContaining({ id: "pad-exec-1" }),
      undefined,
    );
    expect(executeFadeTap).toHaveBeenCalledWith(
      expect.objectContaining({ id: "pad-exec-2" }),
      undefined,
    );

    // Store should be reset after execute
    expect(useMultiFadeStore.getState().active).toBe(false);
    expect(useMultiFadeStore.getState().selectedPads.size).toBe(0);
  });
});
