import { describe, it, expect, beforeEach } from "vitest";
import { useProjectStore, initialProjectState } from "./projectStore";
import { createMockProject, createMockHistoryEntry, createMockScene } from "@/test/factories";

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
      expect(getState().activeSceneId).toBeNull();
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
      const savedProject = createMockProject({ name: "User Given Name" });
      getState().markAsPermanent(permEntry, savedProject);

      expect(getState().isTemporary).toBe(false);
      expect(getState().isDirty).toBe(false);
      expect(getState().folderPath).toBe("/permanent/project");
      expect(getState().historyEntry?.path).toBe("/permanent/project");
    });

    it("should update project.name to the saved project name (Save As bug fix)", () => {
      // Reproduces the bug: temp project has temp name in store;
      // after Save As, markAsPermanent must update project so auto-save
      // doesn't overwrite the correctly-named file with the stale temp name.
      const tempEntry = createMockHistoryEntry({ path: "/temp/temp_MyProject_123" });
      const tempProject = createMockProject({ name: "temp_MyProject_123" });
      getState().loadProject(tempEntry, tempProject, true);

      const permEntry = createMockHistoryEntry({ path: "/projects/My Project" });
      const savedProject = createMockProject({ name: "My Project" });
      getState().markAsPermanent(permEntry, savedProject);

      expect(getState().project?.name).toBe("My Project");
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

  describe("activeSceneId", () => {
    it("should start as null", () => {
      expect(getState().activeSceneId).toBeNull();
    });

    it("should auto-select first scene on loadProject when scenes exist", () => {
      const entry = createMockHistoryEntry();
      const project = createMockProject({
        scenes: [createMockScene({ id: "s1" }), createMockScene({ id: "s2" })],
      });

      getState().loadProject(entry, project, false);

      expect(getState().activeSceneId).toBe("s1");
    });

    it("should remain null on loadProject when scenes is empty", () => {
      const entry = createMockHistoryEntry();
      getState().loadProject(entry, createMockProject({ scenes: [] }), false);

      expect(getState().activeSceneId).toBeNull();
    });

    it("should update on setActiveSceneId", () => {
      const entry = createMockHistoryEntry();
      const project = createMockProject({
        scenes: [createMockScene({ id: "s1" }), createMockScene({ id: "s2" })],
      });
      getState().loadProject(entry, project, false);

      expect(getState().activeSceneId).toBe("s1"); // pre-condition: loadProject auto-selected first scene
      getState().setActiveSceneId("s2");

      expect(getState().activeSceneId).toBe("s2");
    });

    it("should not update if the sceneId does not exist in the project", () => {
      const entry = createMockHistoryEntry();
      const project = createMockProject({
        scenes: [createMockScene({ id: "s1" })],
      });
      getState().loadProject(entry, project, false);

      getState().setActiveSceneId("nonexistent-id");

      expect(getState().activeSceneId).toBe("s1"); // unchanged
    });

    it("should reset to null on clearProject", () => {
      const entry = createMockHistoryEntry();
      const project = createMockProject({
        scenes: [createMockScene({ id: "s1" })],
      });
      getState().loadProject(entry, project, false);

      getState().clearProject();

      expect(getState().activeSceneId).toBeNull();
    });

    it("should preserve activeSceneId through markAsPermanent", () => {
      const tempEntry = createMockHistoryEntry({ path: "/temp/temp_Test_123" });
      const project = createMockProject({
        scenes: [createMockScene({ id: "s1" }), createMockScene({ id: "s2" })],
      });
      getState().loadProject(tempEntry, project, true);
      getState().setActiveSceneId("s2");

      const permEntry = createMockHistoryEntry({ path: "/projects/My Project" });
      getState().markAsPermanent(permEntry, project);

      expect(getState().activeSceneId).toBe("s2");
    });
  });

  describe("addScene", () => {
    it("should do nothing if no project is loaded", () => {
      getState().addScene();

      expect(getState().project).toBeNull();
      expect(getState().activeSceneId).toBeNull();
    });

    it("should add a scene with default 4x4 grid to an empty project", () => {
      const entry = createMockHistoryEntry();
      getState().loadProject(entry, createMockProject({ scenes: [] }), false);

      getState().addScene();

      expect(getState().project?.scenes).toHaveLength(1);
      expect(getState().project?.scenes[0].rows).toBe(4);
      expect(getState().project?.scenes[0].cols).toBe(4);
      expect(getState().project?.scenes[0].pads).toEqual([]);
    });

    it("should auto-name scenes sequentially based on current count", () => {
      const entry = createMockHistoryEntry();
      getState().loadProject(
        entry,
        createMockProject({ scenes: [createMockScene({ id: "s1", name: "Scene 1" })] }),
        false
      );

      getState().addScene();

      expect(getState().project?.scenes[1].name).toBe("Scene 2");
    });

    it("should use provided name when given", () => {
      const entry = createMockHistoryEntry();
      getState().loadProject(entry, createMockProject({ scenes: [] }), false);

      getState().addScene("Ambient Sounds");

      expect(getState().project?.scenes[0].name).toBe("Ambient Sounds");
    });

    it("should set activeSceneId to the new scene's id", () => {
      const entry = createMockHistoryEntry();
      getState().loadProject(entry, createMockProject({ scenes: [] }), false);

      getState().addScene();

      const newSceneId = getState().project?.scenes[0].id;
      expect(newSceneId).toBeTruthy();
      expect(getState().activeSceneId).toBe(newSceneId);
    });

    it("should generate unique ids for each scene", () => {
      const entry = createMockHistoryEntry();
      getState().loadProject(entry, createMockProject({ scenes: [] }), false);

      getState().addScene();
      getState().addScene();

      const ids = getState().project?.scenes.map((s) => s.id);
      expect(ids?.[0]).not.toBe(ids?.[1]);
    });

    it("should mark project as dirty", () => {
      const entry = createMockHistoryEntry();
      getState().loadProject(entry, createMockProject({ scenes: [] }), false);
      expect(getState().isDirty).toBe(false);

      getState().addScene();

      expect(getState().isDirty).toBe(true);
    });
  });
});
