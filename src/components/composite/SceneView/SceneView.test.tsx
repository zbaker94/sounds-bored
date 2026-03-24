import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { useUiStore, initialUiState, OVERLAY_ID } from "@/state/uiStore";
import { createMockHistoryEntry, createMockProject, createMockScene } from "@/test/factories";
import { SceneView } from "./SceneView";

describe("SceneView", () => {
  beforeEach(() => {
    useProjectStore.setState({ ...initialProjectState });
    useUiStore.setState({ ...initialUiState });

    const entry = createMockHistoryEntry();
    const scene = createMockScene({ id: "scene-1", name: "Scene 1" });
    useProjectStore.getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);
  });

  it("renders the Add Pad button when scene has no pads", () => {
    render(<SceneView />);
    expect(screen.getByRole("button", { name: /add pad/i })).toBeInTheDocument();
  });

  it("clicking Add Pad opens the PAD_CONFIG_DRAWER overlay", async () => {
    render(<SceneView />);

    await userEvent.click(screen.getByRole("button", { name: /add pad/i }));

    expect(useUiStore.getState().isOverlayOpen(OVERLAY_ID.PAD_CONFIG_DRAWER)).toBe(true);
  });

  it("does NOT call addPad directly when Add Pad is clicked (overlay opens first)", async () => {
    render(<SceneView />);

    await userEvent.click(screen.getByRole("button", { name: /add pad/i }));

    // No pad created yet — it's created by PadConfigDrawer on form submit
    expect(useProjectStore.getState().project?.scenes[0].pads).toHaveLength(0);
  });
});
