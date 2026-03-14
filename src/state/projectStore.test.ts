import { describe, it, expect, beforeEach } from "vitest";
import { useProjectStore, initialProjectState } from "./projectStore";
import { createMockProject, createMockHistoryEntry } from "@/test/factories";

function getState() {
  return useProjectStore.getState();
}

describe("projectStore", () => {
  beforeEach(() => {
    useProjectStore.setState({ ...initialProjectState });
  });

  describe("initial state", () => {
    it("should start with null project and folderPath", () => {
      expect(getState().project).toBeNull();
      expect(getState().folderPath).toBeNull();
      expect(getState().historyEntry).toBeNull();
      expect(getState().isTemporary).toBe(false);
      expect(getState().isDirty).toBe(false);
    });
  });

  describe("loadProject", () => {
    it("should set project, folderPath, and historyEntry", () => {
      const entry = createMockHistoryEntry({ path: "/projects/my-project" });
      const project = createMockProject({ name: "My Project" });

      getState().loadProject(entry, project, false);

      expect(getState().project?.name).toBe("My Project");
      expect(getState().folderPath).toBe("/projects/my-project");
      expect(getState().historyEntry).toEqual(entry);
    });

    it("should set isTemporary correctly", () => {
      const entry = createMockHistoryEntry();
      const project = createMockProject();

      getState().loadProject(entry, project, true);
      expect(getState().isTemporary).toBe(true);

      getState().loadProject(entry, project, false);
      expect(getState().isTemporary).toBe(false);
    });

    it("should always initialize isDirty to false", () => {
      const entry = createMockHistoryEntry();
      const project = createMockProject();

      getState().loadProject(entry, project, true);
      expect(getState().isDirty).toBe(false);
    });

    it("should derive folderPath from historyEntry.path", () => {
      const entry = createMockHistoryEntry({ path: "/some/custom/path" });
      getState().loadProject(entry, createMockProject(), false);
      expect(getState().folderPath).toBe("/some/custom/path");
    });
  });

  describe("updateProject", () => {
    it("should update the project and mark isDirty", () => {
      const entry = createMockHistoryEntry();
      getState().loadProject(entry, createMockProject({ name: "Original" }), false);
      expect(getState().isDirty).toBe(false);

      getState().updateProject(createMockProject({ name: "Updated" }));

      expect(getState().project?.name).toBe("Updated");
      expect(getState().isDirty).toBe(true);
    });

    it("should do nothing if no project is loaded", () => {
      getState().updateProject(createMockProject({ name: "Should Not Apply" }));
      expect(getState().project).toBeNull();
      expect(getState().isDirty).toBe(false);
    });
  });

  describe("clearDirtyFlag", () => {
    it("should clear isDirty without changing isTemporary", () => {
      const entry = createMockHistoryEntry();
      getState().loadProject(entry, createMockProject(), true);
      getState().updateProject(createMockProject({ name: "Changed" }));
      expect(getState().isDirty).toBe(true);

      getState().clearDirtyFlag();

      expect(getState().isDirty).toBe(false);
      expect(getState().isTemporary).toBe(true); // unchanged
    });
  });

  describe("markAsPermanent", () => {
    it("should set isTemporary=false, isDirty=false, and update historyEntry", () => {
      const tempEntry = createMockHistoryEntry({ path: "/temp/project" });
      getState().loadProject(tempEntry, createMockProject(), true);
      getState().updateProject(createMockProject({ name: "Dirty" }));

      const permEntry = createMockHistoryEntry({ path: "/permanent/project" });
      getState().markAsPermanent(permEntry);

      expect(getState().isTemporary).toBe(false);
      expect(getState().isDirty).toBe(false);
      expect(getState().folderPath).toBe("/permanent/project");
      expect(getState().historyEntry?.path).toBe("/permanent/project");
    });
  });

  describe("clearProject", () => {
    it("should reset all state to initial values", () => {
      const entry = createMockHistoryEntry();
      getState().loadProject(entry, createMockProject(), true);
      getState().updateProject(createMockProject({ name: "Dirty" }));

      getState().clearProject();

      expect(getState().project).toBeNull();
      expect(getState().folderPath).toBeNull();
      expect(getState().historyEntry).toBeNull();
      expect(getState().isTemporary).toBe(false);
      expect(getState().isDirty).toBe(false);
    });
  });
});
