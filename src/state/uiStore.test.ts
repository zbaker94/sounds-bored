import { describe, it, expect, beforeEach } from "vitest";
import { useUiStore, initialUiState, selectIsOverlayOpen, selectIsTopOverlay, selectHasOpenOverlay } from "./uiStore";

describe("uiStore", () => {
  beforeEach(() => {
    useUiStore.setState({ ...initialUiState });
  });

  it("starts with an empty overlay stack", () => {
    expect(useUiStore.getState().overlayStack).toEqual([]);
  });

  describe("openOverlay", () => {
    it("adds an overlay to the stack", () => {
      useUiStore.getState().openOverlay("menu-drawer", "drawer");
      expect(useUiStore.getState().overlayStack).toEqual([
        { id: "menu-drawer", type: "drawer" },
      ]);
    });

    it("is idempotent — does not duplicate an already-open overlay", () => {
      const { openOverlay } = useUiStore.getState();
      openOverlay("menu-drawer", "drawer");
      openOverlay("menu-drawer", "drawer");
      expect(useUiStore.getState().overlayStack).toEqual([
        { id: "menu-drawer", type: "drawer" },
      ]);
    });

    it("adds multiple different overlays", () => {
      const { openOverlay } = useUiStore.getState();
      openOverlay("menu-drawer", "drawer");
      openOverlay("save-dialog", "dialog");
      expect(useUiStore.getState().overlayStack).toEqual([
        { id: "menu-drawer", type: "drawer" },
        { id: "save-dialog", type: "dialog" },
      ]);
    });
  });

  describe("closeOverlay", () => {
    it("removes an overlay by id", () => {
      const { openOverlay } = useUiStore.getState();
      openOverlay("menu-drawer", "drawer");
      openOverlay("save-dialog", "dialog");
      useUiStore.getState().closeOverlay("menu-drawer");
      expect(useUiStore.getState().overlayStack).toEqual([
        { id: "save-dialog", type: "dialog" },
      ]);
    });

    it("is a no-op for a non-open overlay", () => {
      useUiStore.getState().closeOverlay("menu-drawer");
      expect(useUiStore.getState().overlayStack).toEqual([]);
    });
  });

  describe("toggleOverlay", () => {
    it("opens a closed overlay", () => {
      useUiStore.getState().toggleOverlay("menu-drawer", "drawer");
      expect(useUiStore.getState().overlayStack).toEqual([
        { id: "menu-drawer", type: "drawer" },
      ]);
    });

    it("closes an open overlay", () => {
      useUiStore.getState().openOverlay("menu-drawer", "drawer");
      useUiStore.getState().toggleOverlay("menu-drawer", "drawer");
      expect(useUiStore.getState().overlayStack).toEqual([]);
    });
  });

  describe("isOverlayOpen", () => {
    it("returns true when overlay is in the stack", () => {
      useUiStore.getState().openOverlay("menu-drawer", "drawer");
      expect(useUiStore.getState().isOverlayOpen("menu-drawer")).toBe(true);
    });

    it("returns false when overlay is not in the stack", () => {
      expect(useUiStore.getState().isOverlayOpen("menu-drawer")).toBe(false);
    });

    it("returns true for a mid-stack overlay", () => {
      const { openOverlay } = useUiStore.getState();
      openOverlay("menu-drawer", "drawer");
      openOverlay("save-dialog", "dialog");
      expect(useUiStore.getState().isOverlayOpen("menu-drawer")).toBe(true);
    });
  });

  describe("isTopOverlay", () => {
    it("returns true for the topmost overlay", () => {
      const { openOverlay } = useUiStore.getState();
      openOverlay("menu-drawer", "drawer");
      openOverlay("save-dialog", "dialog");
      expect(useUiStore.getState().isTopOverlay("save-dialog")).toBe(true);
    });

    it("returns false for a non-top overlay", () => {
      const { openOverlay } = useUiStore.getState();
      openOverlay("menu-drawer", "drawer");
      openOverlay("save-dialog", "dialog");
      expect(useUiStore.getState().isTopOverlay("menu-drawer")).toBe(false);
    });

    it("returns false when stack is empty", () => {
      expect(useUiStore.getState().isTopOverlay("menu-drawer")).toBe(false);
    });
  });

  describe("hasOpenOverlay", () => {
    it("returns true when overlays are open", () => {
      useUiStore.getState().openOverlay("menu-drawer", "drawer");
      expect(useUiStore.getState().hasOpenOverlay()).toBe(true);
    });

    it("returns false when stack is empty", () => {
      expect(useUiStore.getState().hasOpenOverlay()).toBe(false);
    });
  });

  describe("stack ordering", () => {
    it("maintains correct order across open and close operations", () => {
      const { openOverlay } = useUiStore.getState();
      openOverlay("menu-drawer", "drawer");
      openOverlay("sounds-panel", "dialog");
      openOverlay("confirm-close", "dialog");
      useUiStore.getState().closeOverlay("sounds-panel");
      expect(useUiStore.getState().overlayStack).toEqual([
        { id: "menu-drawer", type: "drawer" },
        { id: "confirm-close", type: "dialog" },
      ]);
      expect(useUiStore.getState().isTopOverlay("confirm-close")).toBe(true);
    });
  });

  describe("selectIsOverlayOpen", () => {
    it("returns true when overlay is in the stack", () => {
      useUiStore.getState().openOverlay("menu-drawer", "drawer");
      expect(selectIsOverlayOpen("menu-drawer")(useUiStore.getState())).toBe(true);
    });

    it("returns false when overlay is not in the stack", () => {
      expect(selectIsOverlayOpen("menu-drawer")(useUiStore.getState())).toBe(false);
    });

    it("returns true for a mid-stack overlay", () => {
      const { openOverlay } = useUiStore.getState();
      openOverlay("menu-drawer", "drawer");
      openOverlay("save-dialog", "dialog");
      expect(selectIsOverlayOpen("menu-drawer")(useUiStore.getState())).toBe(true);
    });
  });

  describe("selectIsTopOverlay", () => {
    it("returns true for the topmost overlay", () => {
      const { openOverlay } = useUiStore.getState();
      openOverlay("menu-drawer", "drawer");
      openOverlay("save-dialog", "dialog");
      expect(selectIsTopOverlay("save-dialog")(useUiStore.getState())).toBe(true);
    });

    it("returns false for a non-top overlay", () => {
      const { openOverlay } = useUiStore.getState();
      openOverlay("menu-drawer", "drawer");
      openOverlay("save-dialog", "dialog");
      expect(selectIsTopOverlay("menu-drawer")(useUiStore.getState())).toBe(false);
    });

    it("returns false when stack is empty", () => {
      expect(selectIsTopOverlay("menu-drawer")(useUiStore.getState())).toBe(false);
    });
  });

  describe("selectHasOpenOverlay", () => {
    it("returns true when overlays are open", () => {
      useUiStore.getState().openOverlay("menu-drawer", "drawer");
      expect(selectHasOpenOverlay(useUiStore.getState())).toBe(true);
    });

    it("returns false when stack is empty", () => {
      expect(selectHasOpenOverlay(useUiStore.getState())).toBe(false);
    });
  });

  describe("editMode", () => {
    it("starts as false", () => {
      expect(useUiStore.getState().editMode).toBe(false);
    });

    it("toggleEditMode turns it on", () => {
      useUiStore.getState().toggleEditMode();
      expect(useUiStore.getState().editMode).toBe(true);
    });

    it("toggleEditMode turns it off when already on", () => {
      useUiStore.getState().toggleEditMode();
      useUiStore.getState().toggleEditMode();
      expect(useUiStore.getState().editMode).toBe(false);
    });
  });

  describe("editingPadId", () => {
    it("starts as null", () => {
      expect(useUiStore.getState().editingPadId).toBeNull();
    });

    it("setEditingPadId sets the id", () => {
      useUiStore.getState().setEditingPadId("pad-123");
      expect(useUiStore.getState().editingPadId).toBe("pad-123");
    });

    it("setEditingPadId(null) clears it", () => {
      useUiStore.getState().setEditingPadId("pad-123");
      useUiStore.getState().setEditingPadId(null);
      expect(useUiStore.getState().editingPadId).toBeNull();
    });
  });

  describe("pageByScene", () => {
    it("starts as an empty record", () => {
      expect(useUiStore.getState().pageByScene).toEqual({});
    });

    it("setScenePage sets the page for a given scene", () => {
      useUiStore.getState().setScenePage("scene-1", 2);
      expect(useUiStore.getState().pageByScene["scene-1"]).toBe(2);
    });

    it("setScenePage does not affect other scenes", () => {
      useUiStore.getState().setScenePage("scene-1", 2);
      useUiStore.getState().setScenePage("scene-2", 5);
      expect(useUiStore.getState().pageByScene["scene-1"]).toBe(2);
      expect(useUiStore.getState().pageByScene["scene-2"]).toBe(5);
    });

    it("setScenePage overwrites an existing page value", () => {
      useUiStore.getState().setScenePage("scene-1", 2);
      useUiStore.getState().setScenePage("scene-1", 0);
      expect(useUiStore.getState().pageByScene["scene-1"]).toBe(0);
    });

    it("unset scene ids default to 0 via nullish coalescing at read sites", () => {
      expect(useUiStore.getState().pageByScene["unknown-scene"] ?? 0).toBe(0);
    });

    it("resets to empty when initialUiState is applied", () => {
      useUiStore.getState().setScenePage("scene-1", 3);
      useUiStore.setState({ ...initialUiState });
      expect(useUiStore.getState().pageByScene).toEqual({});
    });
  });
});
