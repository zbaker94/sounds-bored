import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { useUiStore, initialUiState } from "@/state/uiStore";
import { SceneTabBar } from "./SceneTabBar";
import { createMockProject, createMockHistoryEntry, createMockScene } from "@/test/factories";
import { stopScene } from "@/lib/audio";

vi.mock("@/lib/audio/padPlayer", () => ({
  stopScene: vi.fn(),
}));

vi.mock("@/contexts/ProjectActionsContext", () => ({
  useProjectActions: () => ({
    canSave: false,
    handleSaveClick: vi.fn(),
    requestNavigateAway: vi.fn(),
    requestSaveAndThen: vi.fn(),
  }),
}));

function renderWithTooltip(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe("SceneTabBar", () => {
  beforeEach(() => {
    useProjectStore.setState({ ...initialProjectState });
    useUiStore.setState({ ...initialUiState });
  });

  function loadProject(scenes = [createMockScene({ id: "s1", name: "Scene 1" })]) {
    const entry = createMockHistoryEntry();
    useProjectStore.getState().loadProject(
      entry,
      createMockProject({ scenes }),
      false
    );
  }

  it("should render an add scene button", () => {
    renderWithTooltip(<SceneTabBar />);
    expect(screen.getByRole("button", { name: /add scene/i })).toBeInTheDocument();
  });

  it("should render no tabs when no project is loaded", () => {
    renderWithTooltip(<SceneTabBar />);
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("should render no tabs when scenes list is empty", () => {
    loadProject([]);
    renderWithTooltip(<SceneTabBar />);
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("should render a tab for each scene", () => {
    loadProject([
      createMockScene({ id: "s1", name: "Scene 1" }),
      createMockScene({ id: "s2", name: "Scene 2" }),
    ]);

    renderWithTooltip(<SceneTabBar />);

    expect(screen.getByRole("tab", { name: "Scene 1" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Scene 2" })).toBeInTheDocument();
  });

  it("should render data-state=active on the tab matching activeSceneId", () => {
    loadProject([
      createMockScene({ id: "s1", name: "Scene 1" }),
      createMockScene({ id: "s2", name: "Scene 2" }),
    ]);
    useProjectStore.setState({ activeSceneId: "s2" });

    renderWithTooltip(<SceneTabBar />);

    expect(screen.getByRole("tab", { name: "Scene 2" })).toHaveAttribute("data-state", "active");
    expect(screen.getByRole("tab", { name: "Scene 1" })).toHaveAttribute("data-state", "inactive");
  });

  it("should render no tab as active when activeSceneId is null", () => {
    loadProject([createMockScene({ id: "s1", name: "Scene 1" })]);
    useProjectStore.setState({ activeSceneId: null });

    renderWithTooltip(<SceneTabBar />);

    expect(screen.getByRole("tab", { name: "Scene 1" })).toHaveAttribute("data-state", "inactive");
  });

  it("should call addScene when the add button is clicked", () => {
    loadProject([]);
    renderWithTooltip(<SceneTabBar />);

    fireEvent.click(screen.getByRole("button", { name: /add scene/i }));

    expect(useProjectStore.getState().project?.scenes).toHaveLength(1);
  });

  it("should update activeSceneId in the store when a tab is clicked", () => {
    loadProject([
      createMockScene({ id: "s1", name: "Scene 1" }),
      createMockScene({ id: "s2", name: "Scene 2" }),
    ]);

    renderWithTooltip(<SceneTabBar />);

    // Radix Tabs does not respond to `click` in happy-dom — it fires onValueChange
    // via the `mousedown` handler internally. Using fireEvent.mouseDown is the
    // correct way to test this in a jsdom/happy-dom environment.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Scene 2" }));

    expect(useProjectStore.getState().activeSceneId).toBe("s2");
  });

  describe("inline scene rename", () => {
    function loadSingleScene() {
      loadProject([createMockScene({ id: "s1", name: "Scene 1" })]);
    }

    function openRenameInput() {
      loadSingleScene();
      renderWithTooltip(<SceneTabBar />);
      fireEvent.mouseDown(screen.getByRole("button", { name: /edit scene name/i }));
      return screen.getByLabelText("Scene name input");
    }

    it("should have edit icon with opacity-0 by default", () => {
      loadSingleScene();
      renderWithTooltip(<SceneTabBar />);

      const editButton = screen.getByRole("button", { name: /edit scene name/i });
      expect(editButton).toHaveClass("opacity-0");
    });

    it("should show an input with the current scene name when edit icon is clicked", () => {
      const input = openRenameInput();
      expect(input).toBeInTheDocument();
      expect(input).toHaveValue("Scene 1");
    });

    it("should commit rename when Enter is pressed", () => {
      const input = openRenameInput();

      fireEvent.change(input, { target: { value: "Renamed Scene" } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(useProjectStore.getState().project?.scenes[0].name).toBe("Renamed Scene");
      expect(screen.queryByLabelText("Scene name input")).not.toBeInTheDocument();
    });

    it("should cancel rename when Escape is pressed without updating the store", () => {
      const input = openRenameInput();

      fireEvent.change(input, { target: { value: "Renamed Scene" } });
      fireEvent.keyDown(input, { key: "Escape" });

      expect(useProjectStore.getState().project?.scenes[0].name).toBe("Scene 1");
      expect(screen.queryByLabelText("Scene name input")).not.toBeInTheDocument();
    });

    it("should commit rename when checkmark button is clicked", () => {
      const input = openRenameInput();

      fireEvent.change(input, { target: { value: "Check Rename" } });
      fireEvent.mouseDown(screen.getByRole("button", { name: /confirm rename/i }));

      expect(useProjectStore.getState().project?.scenes[0].name).toBe("Check Rename");
    });

    it("should commit rename on input blur", () => {
      const input = openRenameInput();

      fireEvent.change(input, { target: { value: "Blur Rename" } });
      fireEvent.blur(input);

      expect(useProjectStore.getState().project?.scenes[0].name).toBe("Blur Rename");
    });

    it("should revert to original name when blank name is submitted", () => {
      const input = openRenameInput();

      fireEvent.change(input, { target: { value: "   " } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(useProjectStore.getState().project?.scenes[0].name).toBe("Scene 1");
      expect(screen.queryByLabelText("Scene name input")).not.toBeInTheDocument();
    });
  });

  describe("delete scene", () => {
    function loadSingleScene() {
      loadProject([createMockScene({ id: "s1", name: "Scene 1" })]);
    }

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should have delete button with opacity-0 by default", () => {
      loadSingleScene();
      renderWithTooltip(<SceneTabBar />);

      const deleteButton = screen.getByRole("button", { name: /delete scene/i });
      expect(deleteButton).toHaveClass("opacity-0");
    });

    it("should open confirmation dialog when delete button is clicked", () => {
      loadSingleScene();
      renderWithTooltip(<SceneTabBar />);

      fireEvent.click(screen.getByRole("button", { name: /delete scene/i }));

      expect(screen.getByText(/delete scene/i, { selector: "[data-slot='dialog-title']" })).toBeInTheDocument();
      expect(screen.getByText(/are you sure you want to delete/i)).toBeInTheDocument();
    });

    it("should delete the scene when Delete button in dialog is confirmed", () => {
      loadSingleScene();
      renderWithTooltip(<SceneTabBar />);

      fireEvent.click(screen.getByRole("button", { name: /delete scene/i }));
      fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));

      expect(useProjectStore.getState().project?.scenes).toHaveLength(0);
    });

    it("should call stopScene before deleting to stop any playing audio", () => {
      const scene = createMockScene({ id: "s1", name: "Scene 1" });
      loadProject([scene]);
      renderWithTooltip(<SceneTabBar />);

      fireEvent.click(screen.getByRole("button", { name: /delete scene/i }));
      fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));

      expect(stopScene).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }));
    });

    it("should not delete the scene when Cancel is clicked in dialog", () => {
      loadSingleScene();
      renderWithTooltip(<SceneTabBar />);

      fireEvent.click(screen.getByRole("button", { name: /delete scene/i }));
      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

      expect(useProjectStore.getState().project?.scenes).toHaveLength(1);
    });

    it("should not show delete button while editing", () => {
      loadSingleScene();
      renderWithTooltip(<SceneTabBar />);

      fireEvent.mouseDown(screen.getByRole("button", { name: /edit scene name/i }));

      expect(screen.queryByRole("button", { name: /delete scene/i })).not.toBeInTheDocument();
    });

    it("should update activeSceneId to adjacent scene after deletion", () => {
      loadProject([
        createMockScene({ id: "s1", name: "Scene 1" }),
        createMockScene({ id: "s2", name: "Scene 2" }),
      ]);
      useProjectStore.setState({ activeSceneId: "s1" });
      renderWithTooltip(<SceneTabBar />);

      const deleteButtons = screen.getAllByRole("button", { name: /delete scene/i });
      fireEvent.click(deleteButtons[0]);
      fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));

      expect(useProjectStore.getState().project?.scenes).toHaveLength(1);
      expect(useProjectStore.getState().activeSceneId).toBe("s2");
    });
  });

  describe("scene reorder", () => {
    it("should reorder scenes when reorderScenes is called with valid indices", () => {
      loadProject([
        createMockScene({ id: "s1", name: "Scene 1" }),
        createMockScene({ id: "s2", name: "Scene 2" }),
        createMockScene({ id: "s3", name: "Scene 3" }),
      ]);

      renderWithTooltip(<SceneTabBar />);

      // Simulate a drag that moves Scene 1 to the position of Scene 3
      useProjectStore.getState().reorderScenes(0, 2);

      const scenes = useProjectStore.getState().project?.scenes;
      expect(scenes).toHaveLength(3);
      expect(scenes![0].id).toBe("s2");
      expect(scenes![1].id).toBe("s3");
      expect(scenes![2].id).toBe("s1");
    });

    it("should reorder scenes when moving the last scene to the first position", () => {
      loadProject([
        createMockScene({ id: "s1", name: "Scene 1" }),
        createMockScene({ id: "s2", name: "Scene 2" }),
        createMockScene({ id: "s3", name: "Scene 3" }),
      ]);

      renderWithTooltip(<SceneTabBar />);

      useProjectStore.getState().reorderScenes(2, 0);

      const scenes = useProjectStore.getState().project?.scenes;
      expect(scenes![0].id).toBe("s3");
      expect(scenes![1].id).toBe("s1");
      expect(scenes![2].id).toBe("s2");
    });

    it("should mark project as dirty after reorder", () => {
      loadProject([
        createMockScene({ id: "s1", name: "Scene 1" }),
        createMockScene({ id: "s2", name: "Scene 2" }),
      ]);

      renderWithTooltip(<SceneTabBar />);

      expect(useProjectStore.getState().isDirty).toBe(false);

      useProjectStore.getState().reorderScenes(0, 1);

      expect(useProjectStore.getState().isDirty).toBe(true);
    });

    it("should render tabs in the updated order after reorder", () => {
      loadProject([
        createMockScene({ id: "s1", name: "Scene 1" }),
        createMockScene({ id: "s2", name: "Scene 2" }),
        createMockScene({ id: "s3", name: "Scene 3" }),
      ]);

      const { rerender } = renderWithTooltip(<SceneTabBar />);

      useProjectStore.getState().reorderScenes(0, 2);

      rerender(<TooltipProvider><SceneTabBar /></TooltipProvider>);

      const tabs = screen.getAllByRole("tab");
      expect(tabs[0]).toHaveTextContent("Scene 2");
      expect(tabs[1]).toHaveTextContent("Scene 3");
      expect(tabs[2]).toHaveTextContent("Scene 1");
    });
  });
});
