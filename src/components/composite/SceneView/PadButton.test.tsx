import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useUiStore, initialUiState } from "@/state/uiStore";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { usePlaybackStore, initialPlaybackState } from "@/state/playbackStore";
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { createMockHistoryEntry, createMockProject, createMockScene, createMockPad, createMockLayer } from "@/test/factories";
import { PadButton } from "./PadButton";
import { fireEvent, act } from "@testing-library/react";
import { setPadVolume, stopPad } from "@/lib/audio/padPlayer";

vi.mock("./PadLiveControlPopover", () => ({
  PadLiveControlPopover: ({ open }: { open: boolean }) =>
    open ? <div data-testid="live-control-popover" /> : null,
}));

vi.mock("@/lib/audio/padPlayer", () => ({
  triggerPad: vi.fn().mockResolvedValue(undefined),
  setPadVolume: vi.fn(),
  resetPadGain: vi.fn(),
  releasePadHoldLayers: vi.fn(),
  stopPad: vi.fn(),
  getPadProgress: vi.fn().mockReturnValue(null),
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
      usePlaybackStore.getState().updatePadVolume(padId, Math.max(0, Math.min(1, volume)));
    });
  });

  describe("normal mode (editMode false)", () => {
    it("renders the pad name", () => {
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);
      expect(screen.getByTestId("pad-name")).toHaveTextContent("Kick");
    });

    it("does not show the edit overlay", () => {
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);
      expect(screen.queryByRole("button", { name: /edit pad/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /duplicate pad/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /delete pad/i })).not.toBeInTheDocument();
    });
  });

  describe("edit mode (editMode true)", () => {
    beforeEach(() => {
      useUiStore.setState({ ...initialUiState, editMode: true });
    });

    it("shows the edit overlay with action buttons", () => {
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);
      expect(screen.getByRole("button", { name: /edit pad/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /duplicate pad/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /delete pad/i })).toBeInTheDocument();
    });

    it("shows layer count in overlay", () => {
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);
      expect(screen.getByText(/1 layer/i)).toBeInTheDocument();
    });

    it("clicking edit button calls onEditClick with the pad", async () => {
      const pad = loadPadInStore();
      const onEditClick = vi.fn();
      render(<PadButton pad={pad} sceneId="scene-1" onEditClick={onEditClick} />);
      await userEvent.click(screen.getByRole("button", { name: /edit pad/i }));
      expect(onEditClick).toHaveBeenCalledTimes(1);
      expect(onEditClick).toHaveBeenCalledWith(pad);
    });

    it("clicking duplicate button calls duplicatePad", async () => {
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);
      await userEvent.click(screen.getByRole("button", { name: /duplicate pad/i }));
      const pads = useProjectStore.getState().project!.scenes[0].pads;
      expect(pads).toHaveLength(2);
      expect(pads[1].name).toBe("Kick");
    });

    it("clicking delete button shows confirm dialog", async () => {
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);
      await userEvent.click(screen.getByRole("button", { name: /delete pad/i }));
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText(/delete pad/i)).toBeInTheDocument();
    });

    it("confirming delete removes the pad", async () => {
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);
      await userEvent.click(screen.getByRole("button", { name: /delete pad/i }));
      const confirmBtn = await screen.findByRole("button", { name: /^delete$/i });
      await userEvent.click(confirmBtn);
      expect(useProjectStore.getState().project!.scenes[0].pads).toHaveLength(0);
    });

    it("confirming delete calls stopPad before removing the pad", async () => {
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);
      await userEvent.click(screen.getByRole("button", { name: /delete pad/i }));
      const confirmBtn = await screen.findByRole("button", { name: /^delete$/i });
      await userEvent.click(confirmBtn);
      expect(stopPad).toHaveBeenCalledWith(pad);
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

    it("shows volume percentage instead of pad name while in hold phase", () => {
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);

      const button = screen.getByRole("button", { name: "Kick" });

      // Pointer down on a non-playing pad
      fireEvent.pointerDown(button, { button: 0, clientY: 200, pointerId: 1 });

      // Advance past HOLD_MS (150 ms) to enter hold phase; startVolume=0 (not playing)
      act(() => { vi.advanceTimersByTime(150); });

      expect(screen.getByText("0%")).toBeInTheDocument();
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

      expect(screen.getByText("50%")).toBeInTheDocument();
    });

    it("shows volume transition bar during hold phase and hides it after release", () => {
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);
      const button = screen.getByRole("button", { name: "Kick" });

      fireEvent.pointerDown(button, { button: 0, clientY: 200, pointerId: 1 });
      act(() => { vi.advanceTimersByTime(150); }); // hold activates

      // eslint-disable-next-line testing-library/no-node-access
      expect(button.querySelector(".bg-yellow-500")).toBeInTheDocument();

      act(() => { fireEvent.pointerUp(button, { pointerId: 1 }); });
      // Volume display lingers 670ms after transition ends before hiding
      act(() => { vi.advanceTimersByTime(700); });

      // eslint-disable-next-line testing-library/no-node-access
      expect(button.querySelector(".bg-yellow-500")).not.toBeInTheDocument();
    });

    it("restores pad name after drag ends", () => {
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
      // Volume display lingers 670ms after transition ends before hiding
      act(() => { vi.advanceTimersByTime(700); });

      // After release: name still shown, volume % gone
      expect(screen.getByTestId("pad-name")).toHaveTextContent("Kick");
      expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
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
    useMultiFadeStore.setState({
      active: true,
      originPadId: "some-other-pad",
      selectedPads: new Map(),
      reopenPadId: null,
      toggleMultiFadePad: mockToggle,
    } as any);
    render(<PadButton pad={pad} sceneId="scene-1" />);
    const button = screen.getByRole("button", { name: "Kick" });
    fireEvent.pointerDown(button, { button: 0, pointerId: 1 });
    expect(mockToggle).toHaveBeenCalledWith("pad-1", expect.any(Boolean), expect.any(Number));
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

  it("right-clicking the pad button opens the live control popover", async () => {
    const pad = loadPadInStore();
    render(<PadButton pad={pad} sceneId="scene-1" />);
    // The context menu handler is on the outer div wrapper, not the button itself
    const button = screen.getByRole("button", { name: "Kick" });
    // eslint-disable-next-line testing-library/no-node-access
    const wrapper = button.parentElement!.parentElement!.parentElement!.parentElement!;
    fireEvent.contextMenu(wrapper);
    expect(screen.getByTestId("live-control-popover")).toBeInTheDocument();
  });

  it("right-clicking does not open popover in edit mode", async () => {
    useUiStore.setState({ ...initialUiState, editMode: true });
    const pad = loadPadInStore();
    render(<PadButton pad={pad} sceneId="scene-1" />);
    // In edit mode the Kick button has aria-hidden; query by test-id on the pad name span
    const padName = screen.getByTestId("pad-name");
    // eslint-disable-next-line testing-library/no-node-access
    const wrapper = padName.closest("div[style]") ?? padName.parentElement!.parentElement!.parentElement!.parentElement!.parentElement!;
    fireEvent.contextMenu(wrapper);
    expect(screen.queryByTestId("live-control-popover")).not.toBeInTheDocument();
  });

  it("right-clicking does not open popover in multi-fade mode", async () => {
    useMultiFadeStore.setState({
      active: true,
      originPadId: "some-other-pad",
      selectedPads: new Map(),
      reopenPadId: null,
    });
    const pad = loadPadInStore();
    render(<PadButton pad={pad} sceneId="scene-1" />);
    const button = screen.getByRole("button", { name: "Kick" });
    // eslint-disable-next-line testing-library/no-node-access
    const wrapper = button.parentElement!.parentElement!.parentElement!.parentElement!;
    fireEvent.contextMenu(wrapper);
    expect(screen.queryByTestId("live-control-popover")).not.toBeInTheDocument();
  });

  it("popover opens when forcePopoverOpen prop is set", () => {
    const pad = loadPadInStore();
    render(<PadButton pad={pad} sceneId="scene-1" forcePopoverOpen={true} />);
    expect(screen.getByTestId("live-control-popover")).toBeInTheDocument();
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
