import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { useUiStore, initialUiState, OVERLAY_ID } from "@/state/uiStore";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { createMockHistoryEntry, createMockProject, createMockScene } from "@/test/factories";
import { PadConfigDrawer } from "./PadConfigDrawer";

function renderDrawer(sceneId = "scene-1") {
  return render(<PadConfigDrawer sceneId={sceneId} />);
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

    // Load a project with a scene so addPad works
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

  it("shows a validation error when name is empty and Save is clicked", async () => {
    renderDrawer();
    openDrawer();

    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
  });

  it("calls addPad with form data and closes overlay on valid submit", async () => {
    renderDrawer("scene-1");
    openDrawer();

    await userEvent.type(screen.getByLabelText(/pad name/i), "Kick");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      const pads = useProjectStore.getState().project?.scenes[0].pads;
      expect(pads).toHaveLength(1);
      expect(pads![0].name).toBe("Kick");
    });

    expect(useUiStore.getState().isOverlayOpen(OVERLAY_ID.PAD_CONFIG_DRAWER)).toBe(false);
  });

  it("closes overlay without saving when Cancel is clicked", async () => {
    renderDrawer("scene-1");
    openDrawer();

    await userEvent.type(screen.getByLabelText(/pad name/i), "Kick");
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(useUiStore.getState().isOverlayOpen(OVERLAY_ID.PAD_CONFIG_DRAWER)).toBe(false);
    expect(useProjectStore.getState().project?.scenes[0].pads).toHaveLength(0);
  });
});
