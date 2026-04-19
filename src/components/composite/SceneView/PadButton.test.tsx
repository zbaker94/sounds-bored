import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useUiStore, initialUiState } from "@/state/uiStore";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { usePlaybackStore, initialPlaybackState } from "@/state/playbackStore";
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { createMockHistoryEntry, createMockProject, createMockScene, createMockPad, createMockLayer } from "@/test/factories";
import { PadButton } from "./PadButton";
import { fireEvent, act } from "@testing-library/react";
import { setPadVolume } from "@/lib/audio/padPlayer";

vi.mock("./PadBackFace", () => ({
  PadBackFace: ({ pad }: { pad: { name: string } }) => (
    <div data-testid="pad-back-face">{pad.name}</div>
  ),
}));

vi.mock("@/lib/audio/padPlayer", () => ({
  triggerPad: vi.fn().mockResolvedValue(undefined),
  setPadVolume: vi.fn(),
  resetPadGain: vi.fn(),
  releasePadHoldLayers: vi.fn(),
  stopPad: vi.fn(),
  isPadFading: vi.fn().mockReturnValue(false),
  freezePadAtCurrentVolume: vi.fn(),
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

vi.mock("@/lib/audio/audioState", () => ({
  isPadActive: vi.fn().mockReturnValue(false),
}));

function loadPadInStore(padOverrides = {}) {
  const layer = createMockLayer({ id: "layer-1" });
  const pad = createMockPad({ id: "pad-1", name: "Kick", layers: [layer], ...padOverrides });
  const scene = createMockScene({ id: "scene-1", pads: [pad] });
  const entry = createMockHistoryEntry();
  useProjectStore.getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);
  return pad;
}

describe("PadButton", () => {
  beforeEach(() => {
    useUiStore.setState({ ...initialUiState });
    useProjectStore.setState({ ...initialProjectState });
    usePlaybackStore.setState({ ...initialPlaybackState });
    // Make setPadVolume mock update the store, matching real padPlayer behaviour
    vi.mocked(setPadVolume).mockImplementation((padId: string, volume: number) => {
      const clamped = Math.max(0, Math.min(1, volume));
      const current = usePlaybackStore.getState().padVolumes;
      usePlaybackStore.getState().setAudioTick({ padVolumes: { ...current, [padId]: clamped } });
    });
  });

  describe("normal mode (editMode false)", () => {
    it("renders the pad name", () => {
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);
      expect(screen.getByTestId("pad-name")).toHaveTextContent("Kick");
    });

    it("does not show the back face", () => {
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);
      // Front face is visible; back face is aria-hidden in normal mode
      const backFace = screen.getByTestId("pad-back-face");
      // eslint-disable-next-line testing-library/no-node-access
      expect(backFace.closest('[aria-hidden="true"]')).not.toBeNull();
    });
  });

  describe("edit mode (editMode true)", () => {
    beforeEach(() => {
      useUiStore.setState({ ...initialUiState, editMode: true });
    });

    it("shows the back face when editMode is true", () => {
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);
      expect(screen.getByTestId("pad-back-face")).toBeInTheDocument();
    });

    it("renders PadBackFace on the back face in edit mode", () => {
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);
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
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);

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
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);

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
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);
      const button = screen.getByRole("button", { name: "Kick" });

      fireEvent.pointerDown(button, { button: 0, clientY: 200, pointerId: 1 });
      act(() => { vi.advanceTimersByTime(150); }); // hold phase — no bar yet

      // eslint-disable-next-line testing-library/no-node-access
      expect(button.querySelector(".bg-yellow-500")).not.toBeInTheDocument();

      // Drag to enter drag phase — setPadVolume updates padVolumes → bar appears
      fireEvent.pointerMove(button, { clientY: 190, pointerId: 1 });

      // eslint-disable-next-line testing-library/no-node-access
      expect(button.querySelector(".bg-yellow-500")).toBeInTheDocument();
    });

    it("shows pad name alongside volume percentage while dragging", () => {
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);

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
    render(<PadButton pad={pad} sceneId="scene-1" />);
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
    render(<PadButton pad={pad} sceneId="scene-1" />);
    const button = screen.getByRole("button", { name: "Kick" });
    fireEvent.pointerDown(button, { button: 0, pointerId: 1 });
    expect(mockToggle).toHaveBeenCalledWith("pad-1", 0, 1);
  });

  it("does not show pulse ring when multi-fade mode is active even while playing", () => {
    const pad = loadPadInStore();
    usePlaybackStore.setState({ ...initialPlaybackState, playingPadIds: new Set(["pad-1"]) });
    render(<PadButton pad={pad} sceneId="scene-1" />);
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
    const pad = loadPadInStore({
      layers: [createMockLayer({ selection: { type: "tag", tagIds: [], matchMode: "any", defaultVolume: 100 } })],
    });
    render(<PadButton pad={pad} sceneId="scene-1" />);
    const padEl = screen.getByRole("button", { name: "Kick" });
    fireEvent.contextMenu(padEl);
    expect(useUiStore.getState().editingPadId).toBe("pad-1");
  });

  it("right-clicking does not set editingPadId in edit mode", async () => {
    useUiStore.setState({ ...initialUiState, editMode: true });
    const pad = loadPadInStore();
    render(<PadButton pad={pad} sceneId="scene-1" />);
    const padName = screen.getByTestId("pad-name");
    // eslint-disable-next-line testing-library/no-node-access
    const wrapper = padName.closest("div[style]") ?? padName.parentElement!.parentElement!.parentElement!.parentElement!.parentElement!;
    fireEvent.contextMenu(wrapper);
    expect(useUiStore.getState().editingPadId).toBeNull();
  });

  it("right-clicking does not set editingPadId in multi-fade mode", async () => {
    useMultiFadeStore.setState({
      active: true,
      originPadId: "some-other-pad",
      selectedPads: new Map(),
      reopenPadId: null,
    });
    const pad = loadPadInStore();
    render(<PadButton pad={pad} sceneId="scene-1" />);
    const button = screen.getByRole("button", { name: "Kick" });
    fireEvent.contextMenu(button);
    expect(useUiStore.getState().editingPadId).toBeNull();
  });

  it("right-clicking does not set editingPadId when pad is unplayable", async () => {
    // createMockLayer defaults to empty instances → padSoundState === "disabled"
    const pad = loadPadInStore();
    render(<PadButton pad={pad} sceneId="scene-1" />);
    const button = screen.getByRole("button", { name: "Kick" });
    fireEvent.contextMenu(button);
    expect(useUiStore.getState().editingPadId).toBeNull();
  });

  it("shows PadBackFace when editingPadId matches this pad", () => {
    const pad = loadPadInStore();
    useUiStore.setState({ ...initialUiState, editingPadId: "pad-1" });
    render(<PadButton pad={pad} sceneId="scene-1" />);
    expect(screen.getByTestId("pad-back-face")).toBeInTheDocument();
  });

  it("shows PadBackFace when editMode is true", () => {
    const pad = loadPadInStore();
    useUiStore.setState({ ...initialUiState, editMode: true });
    render(<PadButton pad={pad} sceneId="scene-1" />);
    expect(screen.getByTestId("pad-back-face")).toBeInTheDocument();
  });
});

describe("PadButton — React.memo", () => {
  // NOTE: $$typeof is a React internal — not part of the public API.
  // Pragmatic approach: directly verifying memo wrapping is cleaner than a render-count test.
  // If this breaks on a React upgrade, replace with a render-count integration test.
  it("is wrapped in React.memo", () => {
    expect((PadButton as unknown as { $$typeof: symbol }).$$typeof).toBe(
      Symbol.for("react.memo")
    );
  });
});
