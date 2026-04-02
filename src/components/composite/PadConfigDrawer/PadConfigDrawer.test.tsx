import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { useUiStore, initialUiState, OVERLAY_ID } from "@/state/uiStore";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { createMockHistoryEntry, createMockProject, createMockScene, createMockPad, createMockLayer, createMockSound } from "@/test/factories";
import { PadConfigDrawer } from "./PadConfigDrawer";

function renderDrawer(props: { sceneId?: string; padId?: string } = {}) {
  return render(<PadConfigDrawer sceneId={props.sceneId ?? "scene-1"} padId={props.padId} />);
}

function openDrawer() {
  act(() => {
    useUiStore.getState().openOverlay(OVERLAY_ID.PAD_CONFIG_DRAWER, "dialog");
  });
}

describe("PadConfigDrawer", () => {
  beforeEach(() => {
    useProjectStore.setState({ ...initialProjectState });
    useUiStore.setState({ ...initialUiState });
    useLibraryStore.setState({ ...initialLibraryState });

    const entry = createMockHistoryEntry();
    const scene = createMockScene({ id: "scene-1" });
    useProjectStore.getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);
  });

  it("is not visible when overlay is closed", () => {
    renderDrawer();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("is visible when overlay is open", () => {
    renderDrawer();
    openDrawer();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows the pad name input", () => {
    renderDrawer();
    openDrawer();
    expect(screen.getByLabelText(/pad name/i)).toBeInTheDocument();
  });

  it("shows at least one layer item", () => {
    renderDrawer();
    openDrawer();
    expect(screen.getByText(/layer 1/i)).toBeInTheDocument();
  });

  it("shows Add Layer button", () => {
    renderDrawer();
    openDrawer();
    expect(screen.getByRole("button", { name: /add layer/i })).toBeInTheDocument();
  });

  it("shows a validation error when name is empty and Save is clicked", async () => {
    renderDrawer();
    openDrawer();
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
  });

  it("create mode: calls addPad and closes overlay on valid submit", async () => {
    const sound = createMockSound({ id: "sound-1", name: "Kick" });
    useLibraryStore.setState({ sounds: [sound], tags: [], sets: [], isDirty: false });

    renderDrawer();
    openDrawer();

    await userEvent.type(screen.getByLabelText(/pad name/i), "Kick");

    // Layer 1 starts expanded — select a sound directly
    const checkbox = await screen.findByRole("checkbox", { name: /kick/i });
    await userEvent.click(checkbox);

    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      const pads = useProjectStore.getState().project?.scenes[0].pads;
      expect(pads).toHaveLength(1);
      expect(pads![0].name).toBe("Kick");
      expect(pads![0].layers).toHaveLength(1);
    });

    expect(useUiStore.getState().isOverlayOpen(OVERLAY_ID.PAD_CONFIG_DRAWER)).toBe(false);
  });

  it("edit mode: calls updatePad when padId is provided", async () => {
    const layer = createMockLayer({ id: "layer-1", selection: { type: "assigned", instances: [{ id: "inst-1", soundId: "s1", volume: 1 }] } });
    const pad = createMockPad({ id: "pad-1", name: "Original", layers: [layer] });
    const scene = createMockScene({ id: "scene-1", pads: [pad] });
    const entry = createMockHistoryEntry();
    useProjectStore.getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);

    render(<PadConfigDrawer sceneId="scene-1" padId="pad-1" initialConfig={{ name: "Original", layers: [layer], muteTargetPadIds: [] }} />);
    openDrawer();

    const nameInput = screen.getByLabelText(/pad name/i);
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Updated");

    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      const pads = useProjectStore.getState().project?.scenes[0].pads;
      expect(pads![0].name).toBe("Updated");
    });
  });

  it("closes overlay without saving when Cancel is clicked", async () => {
    renderDrawer();
    openDrawer();
    await userEvent.type(screen.getByLabelText(/pad name/i), "Kick");
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(useUiStore.getState().isOverlayOpen(OVERLAY_ID.PAD_CONFIG_DRAWER)).toBe(false);
    expect(useProjectStore.getState().project?.scenes[0].pads).toHaveLength(0);
  });

  it("clicking Add Layer adds a second layer item", async () => {
    renderDrawer();
    openDrawer();
    await userEvent.click(screen.getByRole("button", { name: /add layer/i }));
    expect(screen.getByText(/layer 2/i)).toBeInTheDocument();
  });
});
