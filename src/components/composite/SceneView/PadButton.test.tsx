import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useUiStore, initialUiState } from "@/state/uiStore";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { createMockHistoryEntry, createMockProject, createMockScene, createMockPad, createMockLayer } from "@/test/factories";
import { PadButton } from "./PadButton";
import { fireEvent, act } from "@testing-library/react";

vi.mock("@/lib/audio/padPlayer", () => ({
  triggerPad: vi.fn().mockResolvedValue(undefined),
  setPadVolume: vi.fn(),
  resetPadGain: vi.fn(),
  getPadProgress: vi.fn().mockReturnValue(null),
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
      expect(screen.queryByText("Kick")).not.toBeInTheDocument();
    });

    it("updates percentage as volume changes while dragging", () => {
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);

      const button = screen.getByRole("button");

      fireEvent.pointerDown(button, { button: 0, clientY: 200, pointerId: 1 });
      act(() => { vi.advanceTimersByTime(150); });

      // Drag 100 px up: startVolume=0, delta=100, range=200 → newVolume=0.5
      fireEvent.pointerMove(button, { clientY: 100, pointerId: 1 });

      expect(screen.getByText("50%")).toBeInTheDocument();
    });

    it("restores pad name after drag ends", () => {
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);

      const button = screen.getByRole("button");

      fireEvent.pointerDown(button, { button: 0, clientY: 200, pointerId: 1 });
      act(() => { vi.advanceTimersByTime(150); });

      // Drag 10 px up to enter drag phase
      fireEvent.pointerMove(button, { clientY: 190, pointerId: 1 });

      expect(screen.queryByText("Kick")).not.toBeInTheDocument();

      fireEvent.pointerUp(button, { pointerId: 1 });

      expect(screen.getByText("Kick")).toBeInTheDocument();
      expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
    });
  });
});
