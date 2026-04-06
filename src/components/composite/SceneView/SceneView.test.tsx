import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { useUiStore, initialUiState, OVERLAY_ID } from "@/state/uiStore";
import { createMockHistoryEntry, createMockProject, createMockScene, createMockPad } from "@/test/factories";
import { SceneView } from "./SceneView";

vi.mock("@/lib/audio/padPlayer", () => ({
  triggerPad: vi.fn().mockResolvedValue(undefined),
  setPadVolume: vi.fn(),
  resetPadGain: vi.fn(),
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
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  rectSortingStrategy: {},
  verticalListSortingStrategy: {},
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  closestCenter: vi.fn(),
  PointerSensor: class {},
  useSensor: () => ({}),
  useSensors: () => [],
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: {
    Transform: { toString: () => undefined },
  },
}));

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

  describe("activeScene derivation", () => {
    it("renders scene content when activeSceneId matches a scene", () => {
      const pad = createMockPad({ id: "pad-1", name: "Pad 1" });
      const scene = createMockScene({ id: "scene-1", pads: [pad] });
      const entry = createMockHistoryEntry();
      useProjectStore.getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);
      useProjectStore.getState().setActiveSceneId("scene-1");

      render(<SceneView />);

      expect(screen.queryByText(/no scenes yet/i)).not.toBeInTheDocument();
    });

    it("renders empty state when activeSceneId does not match any scene", () => {
      const scene = createMockScene({ id: "scene-1" });
      const entry = createMockHistoryEntry();
      useProjectStore.getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);
      // Bypass setActiveSceneId validation to test the defensive fallback in SceneView
      useProjectStore.setState({ activeSceneId: "non-existent-id" });

      render(<SceneView />);

      expect(screen.getByText(/no scenes yet/i)).toBeInTheDocument();
    });
  });

  describe("reorderPads", () => {
    it("reorders pads in the store when reorderPads is called", () => {
      const padA = createMockPad({ id: "pad-a", name: "Pad A" });
      const padB = createMockPad({ id: "pad-b", name: "Pad B" });
      const padC = createMockPad({ id: "pad-c", name: "Pad C" });
      const scene = createMockScene({ id: "scene-1", pads: [padA, padB, padC] });
      const entry = createMockHistoryEntry();
      useProjectStore.getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);

      useProjectStore.getState().reorderPads("scene-1", 0, 2);

      const pads = useProjectStore.getState().project!.scenes[0].pads;
      expect(pads[0].id).toBe("pad-b");
      expect(pads[1].id).toBe("pad-c");
      expect(pads[2].id).toBe("pad-a");
    });

    it("marks the project as dirty after reorder", () => {
      const padA = createMockPad({ id: "pad-a", name: "Pad A" });
      const padB = createMockPad({ id: "pad-b", name: "Pad B" });
      const scene = createMockScene({ id: "scene-1", pads: [padA, padB] });
      const entry = createMockHistoryEntry();
      useProjectStore.getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);

      // clearDirtyFlag to ensure we start clean
      useProjectStore.getState().clearDirtyFlag();
      expect(useProjectStore.getState().isDirty).toBe(false);

      useProjectStore.getState().reorderPads("scene-1", 0, 1);

      expect(useProjectStore.getState().isDirty).toBe(true);
    });
  });
});
