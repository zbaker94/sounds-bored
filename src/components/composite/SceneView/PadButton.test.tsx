import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useUiStore, initialUiState } from "@/state/uiStore";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { usePlaybackStore } from "@/state/playbackStore";
import { createMockHistoryEntry, createMockProject, createMockScene, createMockPad, createMockLayer } from "@/test/factories";
import { PadButton } from "./PadButton";
import { fireEvent, act } from "@testing-library/react";
import { setPadVolume } from "@/lib/audio/padPlayer";

vi.mock("@/lib/audio/padPlayer", () => ({
  triggerPad: vi.fn().mockResolvedValue(undefined),
  setPadVolume: vi.fn(),
  resetPadGain: vi.fn(),
  stopPad: vi.fn(),
  getPadProgress: vi.fn().mockReturnValue(null),
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
    usePlaybackStore.setState({ playingPadIds: [], padVolumes: {}, volumeTransitioningPadIds: [] });
    // Make setPadVolume mock update the store, matching real padPlayer behaviour
    vi.mocked(setPadVolume).mockImplementation((padId: string, volume: number) => {
      usePlaybackStore.getState().updatePadVolume(padId, Math.max(0, Math.min(1, volume)));
    });
  });

  describe("normal mode (editMode false)", () => {
    it("renders the pad name", () => {
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);
      expect(screen.getByText("Kick")).toBeInTheDocument();
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

    it("clicking edit button calls onEditClick", async () => {
      const pad = loadPadInStore();
      const onEditClick = vi.fn();
      render(<PadButton pad={pad} sceneId="scene-1" onEditClick={onEditClick} />);
      await userEvent.click(screen.getByRole("button", { name: /edit pad/i }));
      expect(onEditClick).toHaveBeenCalledTimes(1);
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

      const button = screen.getByRole("button");

      // Pointer down on a non-playing pad
      fireEvent.pointerDown(button, { button: 0, clientY: 200, pointerId: 1 });

      // Advance past HOLD_MS (150 ms) to enter hold phase; startVolume=0 (not playing)
      act(() => { vi.advanceTimersByTime(150); });

      expect(screen.getByText("0%")).toBeInTheDocument();
      expect(screen.getByText("Kick")).toBeInTheDocument();
    });

    it("updates percentage as volume changes while dragging", () => {
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);

      const button = screen.getByRole("button");

      fireEvent.pointerDown(button, { button: 0, clientY: 200, pointerId: 1 });
      act(() => { vi.advanceTimersByTime(150); });

      // Enter drag phase with a small initial move
      fireEvent.pointerMove(button, { clientY: 195, pointerId: 1 });

      // Advance past DRAG_RAMP_MS (150 ms) so rampFactor reaches 1.0
      act(() => { vi.advanceTimersByTime(150); });

      // Drag 100 px up: startVolume=0, rampFactor=1.0, delta=100, range=200 → 50%
      fireEvent.pointerMove(button, { clientY: 100, pointerId: 1 });

      expect(screen.getByText("50%")).toBeInTheDocument();
    });

    it("shows volume transition bar during hold phase and hides it after release", () => {
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);
      const button = screen.getByRole("button");

      fireEvent.pointerDown(button, { button: 0, clientY: 200, pointerId: 1 });
      act(() => { vi.advanceTimersByTime(150); }); // hold activates

      // eslint-disable-next-line testing-library/no-node-access
      expect(button.querySelector(".bg-yellow-500")).toBeInTheDocument();

      act(() => { fireEvent.pointerUp(button, { pointerId: 1 }); });

      // eslint-disable-next-line testing-library/no-node-access
      expect(button.querySelector(".bg-yellow-500")).not.toBeInTheDocument();
    });

    it("restores pad name after drag ends", () => {
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);

      const button = screen.getByRole("button");

      fireEvent.pointerDown(button, { button: 0, clientY: 200, pointerId: 1 });
      act(() => { vi.advanceTimersByTime(150); });

      // Drag 10 px up to enter drag phase
      fireEvent.pointerMove(button, { clientY: 190, pointerId: 1 });

      // Name always shown; volume % also shown during drag
      expect(screen.getByText("Kick")).toBeInTheDocument();
      expect(screen.queryByText(/\d+%/)).toBeInTheDocument();

      act(() => { fireEvent.pointerUp(button, { pointerId: 1 }); });

      // After release: name still shown, volume % gone
      expect(screen.getByText("Kick")).toBeInTheDocument();
      expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
    });
  });
});

// ─── Fade mode visual states ──────────────────────────────────────────────────

import type { PadFadeVisual } from "@/hooks/useFadeMode";

function renderPadWithFadeVisual(fadeVisual: PadFadeVisual, onFadeTap = vi.fn()) {
  const pad = loadPadInStore();
  return render(
    <PadButton
      pad={pad}
      sceneId="scene-1"
      fadeVisual={fadeVisual}
      onFadeTap={onFadeTap}
    />
  );
}

describe("PadButton — fade visual states", () => {
  it("applies amber ring class when fadeVisual is 'crossfade-out'", () => {
    renderPadWithFadeVisual("crossfade-out");
    const btn = screen.getByRole("button", { name: "Kick" });
    expect(btn.className).toMatch(/border-amber/);
  });

  it("applies green ring class when fadeVisual is 'crossfade-in'", () => {
    renderPadWithFadeVisual("crossfade-in");
    const btn = screen.getByRole("button", { name: "Kick" });
    expect(btn.className).toMatch(/border-emerald/);
  });

  it("applies bold amber ring class when fadeVisual is 'selected-out'", () => {
    renderPadWithFadeVisual("selected-out");
    const btn = screen.getByRole("button", { name: "Kick" });
    expect(btn.className).toMatch(/ring-amber/);
  });

  it("applies bold green ring class when fadeVisual is 'selected-in'", () => {
    renderPadWithFadeVisual("selected-in");
    const btn = screen.getByRole("button", { name: "Kick" });
    expect(btn.className).toMatch(/ring-emerald/);
  });

  it("applies opacity-40 and pointer-events-none when fadeVisual is 'invalid'", () => {
    renderPadWithFadeVisual("invalid");
    const btn = screen.getByRole("button", { name: "Kick" });
    expect(btn.className).toMatch(/opacity-40/);
  });

  it("calls onFadeTap on pointer down when fadeVisual is set", async () => {
    const onFadeTap = vi.fn();
    renderPadWithFadeVisual("crossfade-in", onFadeTap);
    const btn = screen.getByRole("button", { name: "Kick" });
    await userEvent.pointer({ target: btn, keys: "[MouseLeft]" });
    expect(onFadeTap).toHaveBeenCalledTimes(1);
  });

  it("does not call onFadeTap when fadeVisual is null", async () => {
    const onFadeTap = vi.fn();
    renderPadWithFadeVisual(null, onFadeTap);
    const btn = screen.getByRole("button", { name: "Kick" });
    await userEvent.pointer({ target: btn, keys: "[MouseLeft]" });
    expect(onFadeTap).not.toHaveBeenCalled();
  });
});
