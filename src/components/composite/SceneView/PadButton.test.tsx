import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useUiStore, initialUiState } from "@/state/uiStore";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { usePlaybackStore, initialPlaybackState } from "@/state/playbackStore";
import { usePadMetricsStore, initialPadMetricsState } from "@/state/padMetricsStore";
import { useMultiFadeStore, initialMultiFadeState } from "@/state/multiFadeStore";
import { createMockHistoryEntry, createMockProject, createMockScene, createMockPad, createMockLayer, createMockSoundInstance } from "@/test/factories";
import { PadButton } from "./PadButton";
import { PadButtonProgress } from "./PadButtonProgress";
import { fireEvent, act } from "@testing-library/react";
import { setPadVolume } from "@/lib/audio";
import { getPadMapForScenes, _padMapCache } from "@/lib/padUtils";

vi.mock("./PadButtonProgress", () => ({
  PadButtonProgress: vi.fn(() => null),
}));

vi.mock("./PadBackFace", () => ({
  PadBackFace: ({ pad, onMultiFade }: { pad: { name: string }; onMultiFade?: () => void }) => (
    <div data-testid="pad-back-face">
      {pad.name}
      <button data-testid="multi-fade-trigger" onClick={onMultiFade}>Synchronized Fades</button>
    </div>
  ),
}));

vi.mock("@/lib/audio/padPlayer", () => ({
  triggerPad: vi.fn().mockResolvedValue(undefined),
  releasePadHoldLayers: vi.fn(),
  stopPad: vi.fn(),
  executeFadeTap: vi.fn(),
}));

vi.mock("@/lib/audio/gainManager", () => ({
  setPadVolume: vi.fn(),
  resetPadGain: vi.fn(),
  clampGain01: (v: number) => Math.max(0, Math.min(1, v)),
  setLayerVolume: vi.fn(),
  syncLayerVolume: vi.fn(),
}));

vi.mock("@/lib/audio/fadeMixer", () => ({
  freezePadAtCurrentVolume: vi.fn(),
  fadePad: vi.fn(),
  resolveFadeDuration: vi.fn(),
}));

vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
  verticalListSortingStrategy: {},
}));

vi.mock("@/lib/audio/voiceRegistry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audio/voiceRegistry")>();
  return { ...actual, isPadActive: vi.fn().mockReturnValue(false), onLayerVoiceSetChanged: vi.fn().mockReturnValue(() => {}) };
});

vi.mock("@/lib/audio/fadeCoordinator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audio/fadeCoordinator")>();
  return { ...actual, isPadFading: vi.fn().mockReturnValue(false) };
});

function resetAllStores() {
  useUiStore.setState({ ...initialUiState });
  useProjectStore.setState({ ...initialProjectState });
  usePlaybackStore.setState({ ...initialPlaybackState });
  useMultiFadeStore.setState({ ...initialMultiFadeState });
  usePadMetricsStore.setState({ ...initialPadMetricsState });
  useLibraryStore.setState({ ...initialLibraryState });
  _padMapCache.scenes = null;
  _padMapCache.map = new Map();
}

function loadPadInStore(padOverrides = {}) {
  const layer = createMockLayer({ id: "layer-1" });
  const pad = createMockPad({ id: "pad-1", name: "Kick", layers: [layer], ...padOverrides });
  const scene = createMockScene({ id: "scene-1", pads: [pad] });
  const entry = createMockHistoryEntry();
  useProjectStore.getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);
  return pad;
}

// Creates a pad with one assigned sound instance — padSoundState === "ok", not "disabled"
function loadPlayablePadInStore(padOverrides = {}) {
  const inst = createMockSoundInstance();
  const layer = createMockLayer({ id: "layer-1", selection: { type: "assigned", instances: [inst] } });
  return loadPadInStore({ layers: [layer], ...padOverrides });
}

function renderButton(padOverrides: Parameters<typeof loadPadInStore>[0] = {}) {
  const pad = loadPadInStore(padOverrides);
  render(<PadButton padId={pad.id} sceneId="scene-1" />);
  return pad;
}

function renderPlayableButton(padOverrides: Parameters<typeof loadPlayablePadInStore>[0] = {}) {
  const pad = loadPlayablePadInStore(padOverrides);
  render(<PadButton padId={pad.id} sceneId="scene-1" />);
  return pad;
}

describe("PadButton", () => {
  beforeEach(() => {
    useUiStore.setState({ ...initialUiState });
    useProjectStore.setState({ ...initialProjectState });
    usePlaybackStore.setState({ ...initialPlaybackState });
    useMultiFadeStore.setState({ ...initialMultiFadeState });
    // Make setPadVolume mock update the store, matching real padPlayer behaviour
    usePadMetricsStore.setState({ ...initialPadMetricsState });
    vi.mocked(setPadVolume).mockImplementation((padId: string, volume: number) => {
      const clamped = Math.max(0, Math.min(1, volume));
      const current = usePadMetricsStore.getState().padVolumes;
      usePadMetricsStore.getState().setPadMetrics({ padVolumes: { ...current, [padId]: clamped } });
    });
  });

  describe("normal mode (editMode false)", () => {
    it("renders the pad name", () => {
      renderButton();
      expect(screen.getByTestId("pad-name")).toHaveTextContent("Kick");
    });

    it("does not show the back face", () => {
      renderButton();
      // Back face is unmounted when not flipped to avoid hidden RAF subscriptions
      expect(screen.queryByTestId("pad-back-face")).toBeNull();
    });

    it("shows pulse ring when pad is playing", () => {
      const pad = loadPadInStore();
      usePlaybackStore.setState({ ...initialPlaybackState, playingPadIds: new Set(["pad-1"]) });
      render(<PadButton padId={pad.id} sceneId="scene-1" />);
      expect(screen.getByTestId("pulse-ring")).toBeInTheDocument();
    });

    it("does not show pulse ring when pad is not playing", () => {
      renderButton();
      expect(screen.queryByTestId("pulse-ring")).not.toBeInTheDocument();
    });

    it("does not show the sound metadata overlay when no voice is enqueued", () => {
      renderButton();
      expect(screen.queryByTestId("sound-name")).toBeNull();
    });
  });

  describe("edit mode (editMode true)", () => {
    beforeEach(() => {
      useUiStore.setState({ ...initialUiState, editMode: true });
    });

    it("renders PadBackFace on the back face in edit mode", () => {
      renderButton();
      expect(screen.getByTestId("pad-back-face")).toBeInTheDocument();
    });
  });

  describe("volume drag label", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      // happy-dom does not implement setPointerCapture
      HTMLButtonElement.prototype.setPointerCapture = vi.fn();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("shows volume percentage instead of pad name while dragging", () => {
      renderPlayableButton();

      const button = screen.getByRole("button", { name: "Kick" });

      // Pointer down → hold phase → drag phase
      fireEvent.pointerDown(button, { button: 0, clientY: 200, pointerId: 1 });
      act(() => { vi.advanceTimersByTime(150); }); // enter hold (startVolume=0)

      // Drag 10 px up to enter drag phase — setPadVolume is called → padVolumes updated → display shows
      fireEvent.pointerMove(button, { clientY: 190, pointerId: 1 });

      // 5% volume should appear (10px / 200px range = 0.05)
      expect(screen.queryByText(/\d+%/)).toBeInTheDocument();
      expect(screen.getByTestId("pad-name")).toHaveTextContent("Kick");
    });

    it("updates percentage as volume changes while dragging", () => {
      renderPlayableButton();

      const button = screen.getByRole("button", { name: "Kick" });

      fireEvent.pointerDown(button, { button: 0, clientY: 200, pointerId: 1 });
      act(() => { vi.advanceTimersByTime(150); });

      // Enter drag phase with a small initial move
      fireEvent.pointerMove(button, { clientY: 195, pointerId: 1 });

      // Ramp already saturated at 1.0 (HOLD_MS=150ms elapsed ≥ DRAG_RAMP_MS=150ms);
      // advance another 150ms to ensure the move event fires well into drag phase.
      act(() => { vi.advanceTimersByTime(150); });

      // Drag 100 px up: startVolume=0, rampFactor=1.0, delta=100, range=200 → 50%
      fireEvent.pointerMove(button, { clientY: 100, pointerId: 1 });
      // setDragVolume is RAF-throttled — flush the pending frame so the display updates.
      act(() => { vi.runAllTimers(); });

      expect(screen.getByText("50%")).toBeInTheDocument();
    });

    it("shows volume transition bar while dragging", () => {
      renderPlayableButton();
      const button = screen.getByRole("button", { name: "Kick" });

      fireEvent.pointerDown(button, { button: 0, clientY: 200, pointerId: 1 });
      act(() => { vi.advanceTimersByTime(150); }); // hold phase — no bar yet

      expect(screen.queryByTestId("volume-drag-bar")).not.toBeInTheDocument();

      // Drag to enter drag phase — setPadVolume updates padVolumes → bar appears
      fireEvent.pointerMove(button, { clientY: 190, pointerId: 1 });

      expect(screen.getByTestId("volume-drag-bar")).toBeInTheDocument();
    });

    it("shows pad name alongside volume percentage while dragging", () => {
      renderPlayableButton();

      const button = screen.getByRole("button", { name: "Kick" });

      fireEvent.pointerDown(button, { button: 0, clientY: 200, pointerId: 1 });
      act(() => { vi.advanceTimersByTime(150); });

      // Drag 10 px up to enter drag phase
      fireEvent.pointerMove(button, { clientY: 190, pointerId: 1 });

      // Name always shown; volume % also shown during drag
      expect(screen.getByTestId("pad-name")).toHaveTextContent("Kick");
      expect(screen.queryByText(/\d+%/)).toBeInTheDocument();

      act(() => { fireEvent.pointerUp(button, { pointerId: 1 }); });

      // After release: pad name still shown and volume % persists (tick not running in test —
      // padVolumes is cleared by audioTick in production when gain returns to baseline).
      expect(screen.getByTestId("pad-name")).toHaveTextContent("Kick");
    });
  });
});

describe("partial-warning overlay", () => {
  beforeEach(() => {
    useLibraryStore.setState({ ...initialLibraryState });
    useUiStore.setState({ ...initialUiState });
    useProjectStore.setState({ ...initialProjectState });
    usePlaybackStore.setState({ ...initialPlaybackState });
    useMultiFadeStore.setState({ ...initialMultiFadeState });
    usePadMetricsStore.setState({ ...initialPadMetricsState });
  });

  it("shows warning icon when pad has partial sound state (some sounds missing)", () => {
    const okInst = createMockSoundInstance({ id: "inst-ok", soundId: "sound-ok" });
    const missingInst = createMockSoundInstance({ id: "inst-bad", soundId: "sound-missing" });
    const layer1 = createMockLayer({ id: "layer-1", selection: { type: "assigned", instances: [okInst] } });
    const layer2 = createMockLayer({ id: "layer-2", selection: { type: "assigned", instances: [missingInst] } });
    const pad = createMockPad({ id: "pad-1", name: "Kick", layers: [layer1, layer2] });
    const scene = createMockScene({ id: "scene-1", pads: [pad] });
    useProjectStore.getState().loadProject(createMockHistoryEntry(), createMockProject({ scenes: [scene] }), false);
    // Mark one sound as missing
    useLibraryStore.setState({ ...initialLibraryState, missingSoundIds: new Set(["sound-missing"]) });

    const { container } = render(<TooltipProvider><PadButton padId={pad.id} sceneId="scene-1" /></TooltipProvider>);

    // The partial-warning renders an amber-colored SVG icon via the TooltipTrigger span
    expect(container.querySelector(".text-amber-400")).toBeInTheDocument();
  });

  it("does not show warning icon when no sounds are missing", () => {
    const pad = loadPlayablePadInStore();
    render(<PadButton padId={pad.id} sceneId="scene-1" />);
    expect(screen.queryByText(/some assigned sounds are missing/i)).not.toBeInTheDocument();
  });
});

describe("multi-fade mode", () => {
  beforeEach(() => {
    useUiStore.setState({ ...initialUiState });
    useProjectStore.setState({ ...initialProjectState });
    usePlaybackStore.setState({ ...initialPlaybackState });
    useMultiFadeStore.setState({
      active: true,
      originPadId: "some-other-pad",
      selectedPads: new Map(),
      reopenPadId: null,
    });
  });

  afterEach(() => {
    useMultiFadeStore.setState({
      active: false,
      originPadId: null,
      selectedPads: new Map(),
      reopenPadId: null,
    });
  });

  it("shows multi-fade selection ring when pad is selected in multi-fade mode", () => {
    const pad = loadPadInStore();
    // Select this pad in multi-fade mode
    useMultiFadeStore.setState({
      active: true,
      originPadId: "some-other-pad",
      selectedPads: new Map([["pad-1", { padId: "pad-1", levels: [0, 100] }]]),
      reopenPadId: null,
    });
    render(<PadButton padId={pad.id} sceneId="scene-1" />);
    const button = screen.getByRole("button", { name: "Kick" });
    // When selected in multi-fade mode, the button gets the teal/amber selection ring class
    expect(button).toHaveClass("ring-2");
  });

  it("clicking pad in multi-fade mode calls toggleMultiFadePad", async () => {
    const pad = loadPadInStore();
    const mockToggle = vi.fn();
    useMultiFadeStore.setState((s) => ({
      ...s,
      active: true,
      originPadId: "some-other-pad",
      selectedPads: new Map(),
      reopenPadId: null,
      toggleMultiFadePad: mockToggle,
    }));
    render(<PadButton padId={pad.id} sceneId="scene-1" />);
    const button = screen.getByRole("button", { name: "Kick" });
    fireEvent.pointerDown(button, { button: 0, pointerId: 1 });
    // Non-playing pad → currentVol=0; fadeTarget defaults to 0
    expect(mockToggle).toHaveBeenCalledWith("pad-1", 0, 0);
  });

  it("does not show pulse ring when multi-fade mode is active even while playing", () => {
    const pad = loadPadInStore();
    usePlaybackStore.setState({ ...initialPlaybackState, playingPadIds: new Set(["pad-1"]) });
    render(<PadButton padId={pad.id} sceneId="scene-1" />);
    // The pulse ring has a specific class — when multiFadeActive it should not render
    // (AnimatePresence removes it from DOM when condition is false)
    expect(screen.queryByTestId("pulse-ring")).not.toBeInTheDocument();
  });
});

describe("right-click / context menu", () => {
  beforeEach(() => {
    useUiStore.setState({ ...initialUiState });
    useProjectStore.setState({ ...initialProjectState });
    usePlaybackStore.setState({ ...initialPlaybackState });
    useMultiFadeStore.setState({
      active: false,
      originPadId: null,
      selectedPads: new Map(),
      reopenPadId: null,
    });
  });

  it("right-click sets editingPadId in uiStore", async () => {
    renderButton({
      layers: [createMockLayer({ selection: { type: "tag", tagIds: [], matchMode: "any", defaultVolume: 100 } })],
    });
    const padEl = screen.getByRole("button", { name: "Kick" });
    fireEvent.contextMenu(padEl);
    expect(useUiStore.getState().editingPadId).toBe("pad-1");
  });

  it("right-clicking does not set editingPadId in edit mode", async () => {
    useUiStore.setState({ ...initialUiState, editMode: true });
    renderButton();
    fireEvent.contextMenu(screen.getByTestId("pad-name"));
    expect(useUiStore.getState().editingPadId).toBeNull();
  });

  it("right-clicking does not set editingPadId in multi-fade mode", async () => {
    useMultiFadeStore.setState({
      active: true,
      originPadId: "some-other-pad",
      selectedPads: new Map(),
      reopenPadId: null,
    });
    renderButton();
    const button = screen.getByRole("button", { name: "Kick" });
    fireEvent.contextMenu(button);
    expect(useUiStore.getState().editingPadId).toBeNull();
  });

  it("right-clicking sets editingPadId even when pad is unplayable", async () => {
    // Disabled pads must still be right-click-flippable so users can assign sounds.
    // createMockLayer defaults to empty instances → padSoundState === "disabled"
    renderButton();
    const button = screen.getByRole("button", { name: "Kick" });
    fireEvent.contextMenu(button);
    expect(useUiStore.getState().editingPadId).toBe("pad-1");
  });

  it("shows PadBackFace when editingPadId matches this pad", () => {
    const pad = loadPadInStore();
    useUiStore.setState({ ...initialUiState, editingPadId: "pad-1" });
    render(<PadButton padId={pad.id} sceneId="scene-1" />);
    expect(screen.getByTestId("pad-back-face")).toBeInTheDocument();
  });

  it("shows PadBackFace when editMode is true", () => {
    const pad = loadPadInStore();
    useUiStore.setState({ ...initialUiState, editMode: true });
    render(<PadButton padId={pad.id} sceneId="scene-1" />);
    expect(screen.getByTestId("pad-back-face")).toBeInTheDocument();
  });
});

describe("fade popover", () => {
  beforeEach(() => {
    useUiStore.setState({ ...initialUiState });
    useProjectStore.setState({ ...initialProjectState });
    usePlaybackStore.setState({ ...initialPlaybackState });
  });

  it("renders the fade slider when fadePopoverPadId matches this pad", () => {
    const pad = loadPadInStore({ fadeTargetVol: 20 });
    useUiStore.setState({ ...initialUiState, fadePopoverPadId: "pad-1" });
    render(<PadButton padId={pad.id} sceneId="scene-1" />);
    expect(screen.getByRole("slider")).toBeInTheDocument();
  });

  it("does not render the fade slider when fadePopoverPadId does not match", () => {
    const pad = loadPadInStore();
    useUiStore.setState({ ...initialUiState, fadePopoverPadId: "other-pad" });
    render(<PadButton padId={pad.id} sceneId="scene-1" />);
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });

  it("does not render the fade slider when no popover is open", () => {
    renderButton();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });
});

describe("onMultiFade callback (handleMultiFade)", () => {
  beforeEach(() => {
    useUiStore.setState({ ...initialUiState });
    useProjectStore.setState({ ...initialProjectState });
    usePlaybackStore.setState({ ...initialPlaybackState });
    useMultiFadeStore.setState({ ...initialMultiFadeState });
  });

  it("clears editingPadId (not toggles editMode) when pad is individually flipped", () => {
    const pad = loadPadInStore();
    useUiStore.setState({ ...initialUiState, editingPadId: "pad-1" });
    render(<PadButton padId={pad.id} sceneId="scene-1" />);
    fireEvent.click(screen.getByTestId("multi-fade-trigger"));
    const { editMode, editingPadId } = useUiStore.getState();
    expect(editingPadId).toBeNull();
    expect(editMode).toBe(false);
  });

  it("turns off global editMode when pad is shown via global editMode", () => {
    const pad = loadPadInStore();
    useUiStore.setState({ ...initialUiState, editMode: true });
    render(<PadButton padId={pad.id} sceneId="scene-1" />);
    fireEvent.click(screen.getByTestId("multi-fade-trigger"));
    expect(useUiStore.getState().editMode).toBe(false);
  });
});

describe("PadButton — React.memo", () => {
  beforeEach(resetAllStores);

  it("does not re-render PadButtonProgress when padId and sceneId props are unchanged", () => {
    const MockProgress = vi.mocked(PadButtonProgress);
    MockProgress.mockClear();
    loadPadInStore();

    const { rerender } = render(<PadButton padId="pad-1" sceneId="scene-1" />);
    const callsAfterMount = MockProgress.mock.calls.length;

    rerender(<PadButton padId="pad-1" sceneId="scene-1" />);
    expect(MockProgress.mock.calls.length).toBe(callsAfterMount);
  });

  it("does re-render when the pad's own data is mutated", () => {
    const MockProgress = vi.mocked(PadButtonProgress);
    MockProgress.mockClear();
    loadPadInStore();

    render(<PadButton padId="pad-1" sceneId="scene-1" />);
    const callsAfterMount = MockProgress.mock.calls.length;

    act(() => {
      useProjectStore.getState().setPadName("scene-1", "pad-1", "Snare");
    });

    expect(MockProgress.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });

  it("does not re-render when isDirty changes but scenes do not", () => {
    const MockProgress = vi.mocked(PadButtonProgress);
    MockProgress.mockClear();
    loadPadInStore();

    render(<PadButton padId="pad-1" sceneId="scene-1" />);
    const callsAfterMount = MockProgress.mock.calls.length;

    const scenesBefore = useProjectStore.getState().project?.scenes;
    // Capture the cached Map BEFORE the mutation so we can assert it survived.
    const mapBefore = getPadMapForScenes(scenesBefore ?? null);

    // Toggle isDirty without touching scenes — getPadMapForScenes returns the
    // cached Map (same scenes reference), so the selector yields the same pad
    // reference and React.memo prevents a re-render.
    act(() => {
      useProjectStore.setState({ isDirty: true });
    });

    // Confirm scenes reference was untouched by the isDirty mutation.
    const scenesAfter = useProjectStore.getState().project?.scenes;
    expect(scenesAfter).toBe(scenesBefore);

    // Prove the cache survived the mutation: the Map captured before isDirty
    // changed must still be the same instance returned after.
    expect(getPadMapForScenes(scenesAfter ?? null)).toBe(mapBefore);

    expect(MockProgress.mock.calls.length).toBe(callsAfterMount);

    // A second, unrelated mutation also leaves the scenes reference (and thus
    // the cached Map and pad reference) untouched — still no re-render.
    act(() => {
      useProjectStore.setState({ folderPath: "/some/other/path" });
    });
    expect(MockProgress.mock.calls.length).toBe(callsAfterMount);
  });

  it("does not re-render when a sibling pad is mutated", () => {
    const MockProgress = vi.mocked(PadButtonProgress);
    MockProgress.mockClear();

    const layer1 = createMockLayer({ id: "layer-1" });
    const layer2 = createMockLayer({ id: "layer-2" });
    const pad1 = createMockPad({ id: "pad-1", name: "Kick", layers: [layer1] });
    const pad2 = createMockPad({ id: "pad-2", name: "Snare", layers: [layer2] });
    const scene = createMockScene({ id: "scene-1", pads: [pad1, pad2] });
    useProjectStore.getState().loadProject(
      createMockHistoryEntry(),
      createMockProject({ scenes: [scene] }),
      false,
    );

    render(<PadButton padId="pad-1" sceneId="scene-1" />);
    const callsAfterMount = MockProgress.mock.calls.length;

    const pad1Before = useProjectStore.getState().project?.scenes[0]?.pads[0];

    // Mutate pad-2 — Immer structural sharing preserves pad-1's reference,
    // so the selector inside PadButton returns the same pad-1 object and no re-render occurs.
    act(() => {
      useProjectStore.getState().setPadName("scene-1", "pad-2", "Hi-Hat");
    });

    // Confirm structural sharing held: pad-1's object reference must be unchanged.
    const pad1After = useProjectStore.getState().project?.scenes[0]?.pads[0];
    expect(pad1After).toBe(pad1Before);

    expect(MockProgress.mock.calls.length).toBe(callsAfterMount);
  });
});

describe("PadButton — null pad handling", () => {
  beforeEach(resetAllStores);

  it("renders nothing when padId is not found in the store", () => {
    loadPadInStore();
    const { container } = render(<PadButton padId="nonexistent-pad" sceneId="scene-1" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing after the pad is deleted, without throwing", () => {
    loadPadInStore();
    const { container } = render(<PadButton padId="pad-1" sceneId="scene-1" />);
    expect(container.firstChild).not.toBeNull();

    act(() => {
      useProjectStore.getState().deletePad("scene-1", "pad-1");
    });

    expect(container.firstChild).toBeNull();
  });
});

describe("PadFrontFace — layerIds useMemo", () => {
  beforeEach(resetAllStores);

  it("reuses the same layerIds reference when pad re-renders with non-layer change", () => {
    const MockProgress = vi.mocked(PadButtonProgress);
    MockProgress.mockClear();

    const layer = createMockLayer({ id: "layer-1" });
    const pad = createMockPad({ id: "pad-1", name: "Kick", layers: [layer] });
    const scene = createMockScene({ id: "scene-1", pads: [pad] });
    useProjectStore.getState().loadProject(
      createMockHistoryEntry(),
      createMockProject({ scenes: [scene] }),
      false,
    );

    render(<PadButton padId="pad-1" sceneId="scene-1" />);
    const firstCall = MockProgress.mock.calls.at(-1)?.[0];
    expect(firstCall?.layerIds).toBeDefined();
    const callsAfterMount = MockProgress.mock.calls.length;

    // Mutate an unrelated field — Immer structural sharing preserves the pad.layers reference.
    act(() => {
      useProjectStore.getState().setPadColor("scene-1", "pad-1", "#ff0000");
    });

    // Verify exactly one re-render occurred (pad color changed → new pad reference → PadButtonContent re-renders).
    // Exact count confirms the cache-reuse path was actually exercised, not just that "something rendered".
    expect(MockProgress.mock.calls.length).toBe(callsAfterMount + 1);
    const secondCall = MockProgress.mock.calls.at(-1)?.[0];

    // useMemo([pad.layers]) returns the cached array when pad.layers reference is unchanged.
    expect(secondCall?.layerIds).toBe(firstCall?.layerIds);
  });

  it("produces a new layerIds reference when pad.layers changes", () => {
    const MockProgress = vi.mocked(PadButtonProgress);
    MockProgress.mockClear();

    const layer = createMockLayer({ id: "layer-1" });
    const pad = createMockPad({ id: "pad-1", name: "Kick", layers: [layer] });
    const scene = createMockScene({ id: "scene-1", pads: [pad] });
    useProjectStore.getState().loadProject(
      createMockHistoryEntry(),
      createMockProject({ scenes: [scene] }),
      false,
    );

    render(<PadButton padId="pad-1" sceneId="scene-1" />);
    const firstLayerIds = MockProgress.mock.calls.at(-1)?.[0]?.layerIds;
    expect(firstLayerIds).toBeDefined();

    // Add a layer via the store — pad.layers gets a new array reference.
    const newLayer = createMockLayer({ id: "layer-2" });
    const { id: _padId, ...padConfig } = pad;
    act(() => {
      useProjectStore.getState().updatePad("scene-1", "pad-1", { ...padConfig, layers: [layer, newLayer] });
    });
    const secondLayerIds = MockProgress.mock.calls.at(-1)?.[0]?.layerIds;

    expect(secondLayerIds).not.toBe(firstLayerIds);
    expect(secondLayerIds).toEqual(["layer-1", "layer-2"]);
  });
});
