import { describe, it, expect, beforeEach } from "vitest";
import { useProjectStore, initialProjectState } from "./projectStore";
import { useUiStore, initialUiState } from "./uiStore";
import { createMockProject, createMockHistoryEntry, createMockScene, createMockPad, createMockLayer } from "@/test/factories";
import type { PadConfig } from "@/lib/schemas";

function getState() {
  return useProjectStore.getState();
}

function getActiveSceneId() {
  return useProjectStore.getState().activeSceneId;
}

describe("projectStore", () => {
  beforeEach(() => {
    useProjectStore.setState({ ...initialProjectState });
    useUiStore.setState({ ...initialUiState });
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
      expect(getActiveSceneId()).toBeNull();
    });

    it("should auto-select first scene on loadProject when scenes exist", () => {
      const entry = createMockHistoryEntry();
      const project = createMockProject({
        scenes: [createMockScene({ id: "s1" }), createMockScene({ id: "s2" })],
      });

      getState().loadProject(entry, project, false);

      expect(getActiveSceneId()).toBe("s1");
    });

    it("should remain null on loadProject when scenes is empty", () => {
      const entry = createMockHistoryEntry();
      getState().loadProject(entry, createMockProject({ scenes: [] }), false);

      expect(getActiveSceneId()).toBeNull();
    });

    it("should update when setActiveSceneId is called", () => {
      const entry = createMockHistoryEntry();
      const project = createMockProject({
        scenes: [createMockScene({ id: "s1" }), createMockScene({ id: "s2" })],
      });
      getState().loadProject(entry, project, false);

      expect(getActiveSceneId()).toBe("s1"); // pre-condition: loadProject auto-selected first scene
      getState().setActiveSceneId("s2");

      expect(getActiveSceneId()).toBe("s2");
    });

    it("should reset to null on clearProject", () => {
      const entry = createMockHistoryEntry();
      const project = createMockProject({
        scenes: [createMockScene({ id: "s1" })],
      });
      getState().loadProject(entry, project, false);

      getState().clearProject();

      expect(getActiveSceneId()).toBeNull();
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

      expect(getActiveSceneId()).toBe("s2");
    });
  });

  describe("addScene", () => {
    it("should do nothing if no project is loaded", () => {
      getState().addScene();

      expect(getState().project).toBeNull();
      expect(getActiveSceneId()).toBeNull();
    });

    it("should add a scene with empty pads to the project", () => {
      const entry = createMockHistoryEntry();
      getState().loadProject(entry, createMockProject({ scenes: [] }), false);

      getState().addScene();

      expect(getState().project?.scenes).toHaveLength(1);
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
      expect(getActiveSceneId()).toBe(newSceneId);
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

  describe("renameScene", () => {
    function loadWithScenes() {
      const entry = createMockHistoryEntry();
      const scenes = [createMockScene({ id: "s1", name: "Scene 1" }), createMockScene({ id: "s2", name: "Scene 2" })];
      getState().loadProject(entry, createMockProject({ scenes }), false);
    }

    it("renames the scene and marks dirty", () => {
      loadWithScenes();
      getState().renameScene("s1", "Renamed");
      expect(getState().project!.scenes[0].name).toBe("Renamed");
      expect(getState().isDirty).toBe(true);
    });

    it("trims the name", () => {
      loadWithScenes();
      getState().renameScene("s1", "  Trimmed  ");
      expect(getState().project!.scenes[0].name).toBe("Trimmed");
    });

    it("is a no-op on blank name", () => {
      loadWithScenes();
      getState().renameScene("s1", "   ");
      expect(getState().project!.scenes[0].name).toBe("Scene 1");
      expect(getState().isDirty).toBe(false);
    });

    it("is a no-op on unknown sceneId", () => {
      loadWithScenes();
      getState().renameScene("nonexistent", "Whatever");
      expect(getState().isDirty).toBe(false);
    });

    it("is a no-op when no project is loaded", () => {
      getState().renameScene("s1", "Name");
      expect(getState().project).toBeNull();
    });
  });

  describe("deleteScene", () => {
    function loadWithThreeScenes() {
      const entry = createMockHistoryEntry();
      const scenes = [
        createMockScene({ id: "s1" }),
        createMockScene({ id: "s2" }),
        createMockScene({ id: "s3" }),
      ];
      getState().loadProject(entry, createMockProject({ scenes }), false);
    }

    it("removes the scene from the project", () => {
      loadWithThreeScenes();
      getState().deleteScene("s2");
      expect(getState().project!.scenes.map((s) => s.id)).toEqual(["s1", "s3"]);
    });

    it("marks the project as dirty", () => {
      loadWithThreeScenes();
      getState().deleteScene("s2");
      expect(getState().isDirty).toBe(true);
    });

    it("is a no-op when sceneId does not exist — does not touch activeSceneId", () => {
      loadWithThreeScenes();
      getState().deleteScene("nonexistent");
      expect(getState().project!.scenes).toHaveLength(3);
      expect(getState().isDirty).toBe(false);
      expect(getActiveSceneId()).toBe("s1"); // unchanged
    });

    it("is a no-op when no project is loaded", () => {
      getState().deleteScene("s1");
      expect(getState().project).toBeNull();
    });

    it("does not change activeSceneId when a non-active scene is deleted", () => {
      loadWithThreeScenes();
      getState().setActiveSceneId("s1");
      getState().deleteScene("s3");
      expect(getActiveSceneId()).toBe("s1");
    });

    it("advances activeSceneId to the next scene when active middle scene is deleted", () => {
      loadWithThreeScenes();
      getState().setActiveSceneId("s2");
      getState().deleteScene("s2");
      expect(getActiveSceneId()).toBe("s3");
    });

    it("falls back to the previous scene when the active last scene is deleted", () => {
      loadWithThreeScenes();
      getState().setActiveSceneId("s3");
      getState().deleteScene("s3");
      expect(getActiveSceneId()).toBe("s2");
    });

    it("sets activeSceneId to null when the only scene is deleted", () => {
      const entry = createMockHistoryEntry();
      getState().loadProject(entry, createMockProject({ scenes: [createMockScene({ id: "only" })] }), false);
      getState().deleteScene("only");
      expect(getActiveSceneId()).toBeNull();
      expect(getState().project!.scenes).toHaveLength(0);
    });
  });

  describe("addPad", () => {
    function loadWithScene() {
      const entry = createMockHistoryEntry();
      const scene = createMockScene({ id: "scene-1" });
      getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);
      return scene.id;
    }

    it("should do nothing if no project is loaded", () => {
      const config: PadConfig = { name: "Kick", layers: [], muteTargetPadIds: [] };
      getState().addPad("any-scene", config);
      expect(getState().project).toBeNull();
    });

    it("should do nothing if sceneId does not exist", () => {
      loadWithScene();
      const config: PadConfig = { name: "Kick", layers: [], muteTargetPadIds: [] };
      getState().addPad("nonexistent", config);
      expect(getState().project?.scenes[0].pads).toHaveLength(0);
    });

    it("should add a pad with the given name to the scene", () => {
      const sceneId = loadWithScene();
      const layer = createMockLayer();
      const config: PadConfig = {
        name: "Kick",
        layers: [layer],
        muteTargetPadIds: [],
      };
      getState().addPad(sceneId, config);
      expect(getState().project?.scenes[0].pads).toHaveLength(1);
      expect(getState().project?.scenes[0].pads[0].name).toBe("Kick");
    });

    it("should assign a generated id to the pad", () => {
      const sceneId = loadWithScene();
      const config: PadConfig = { name: "Kick", layers: [], muteTargetPadIds: [] };
      getState().addPad(sceneId, config);
      expect(getState().project?.scenes[0].pads[0].id).toBeTruthy();
    });

    it("should mark project as dirty", () => {
      const sceneId = loadWithScene();
      const config: PadConfig = { name: "Kick", layers: [], muteTargetPadIds: [] };
      getState().addPad(sceneId, config);
      expect(getState().isDirty).toBe(true);
    });

    it("uses the supplied id when provided", () => {
      const sceneId = loadWithScene();
      const config: PadConfig = { name: "Test", layers: [], muteTargetPadIds: [] };
      getState().addPad(sceneId, config, "my-custom-id");
      expect(getState().project?.scenes[0].pads[0].id).toBe("my-custom-id");
    });
  });

  describe("updatePad", () => {
    function loadWithPad() {
      const entry = createMockHistoryEntry();
      const pad = createMockPad({ id: "pad-1", name: "Original" });
      const scene = createMockScene({ id: "scene-1", pads: [pad] });
      getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);
      return { sceneId: scene.id, padId: pad.id };
    }

    it("should do nothing if no project is loaded", () => {
      const config: PadConfig = { name: "Updated", layers: [], muteTargetPadIds: [] };
      getState().updatePad("any-scene", "any-pad", config);
      expect(getState().project).toBeNull();
    });

    it("should do nothing if padId does not exist in the scene", () => {
      const { sceneId } = loadWithPad();
      const config: PadConfig = { name: "Updated", layers: [], muteTargetPadIds: [] };
      getState().updatePad(sceneId, "nonexistent-pad", config);
      expect(getState().project?.scenes[0].pads[0].name).toBe("Original");
    });

    it("should update the pad fields, leaving id unchanged", () => {
      const { sceneId, padId } = loadWithPad();
      const config: PadConfig = { name: "Updated Name", layers: [], muteTargetPadIds: [] };
      getState().updatePad(sceneId, padId, config);
      const pad = getState().project?.scenes[0].pads[0];
      expect(pad?.id).toBe("pad-1");
      expect(pad?.name).toBe("Updated Name");
    });

    it("should mark project as dirty", () => {
      const { sceneId, padId } = loadWithPad();
      const config: PadConfig = { name: "Updated", layers: [], muteTargetPadIds: [] };
      getState().updatePad(sceneId, padId, config);
      expect(getState().isDirty).toBe(true);
    });
  });

  describe("deletePad", () => {
    function loadSceneWithPad() {
      const scene = createMockScene({ id: "scene-1" });
      const pad = createMockPad({ id: "pad-1", name: "Kick" });
      scene.pads.push(pad);
      const entry = createMockHistoryEntry();
      getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);
      return { scene, pad };
    }

    it("removes the pad from the scene", () => {
      loadSceneWithPad();
      getState().deletePad("scene-1", "pad-1");
      expect(getState().project?.scenes[0].pads).toHaveLength(0);
    });

    it("marks the project as dirty", () => {
      loadSceneWithPad();
      getState().deletePad("scene-1", "pad-1");
      expect(getState().isDirty).toBe(true);
    });

    it("is a no-op if pad does not exist", () => {
      loadSceneWithPad();
      getState().deletePad("scene-1", "nonexistent");
      expect(getState().project?.scenes[0].pads).toHaveLength(1);
      expect(getState().isDirty).toBe(false);
    });

    it("is a no-op if scene does not exist", () => {
      loadSceneWithPad();
      getState().deletePad("nonexistent", "pad-1");
      expect(getState().project?.scenes[0].pads).toHaveLength(1);
      expect(getState().isDirty).toBe(false);
    });
  });

  describe("duplicatePad", () => {
    function loadSceneWithTwoPads() {
      const scene = createMockScene({ id: "scene-1" });
      const layer = createMockLayer({ id: "layer-1" });
      const pad1 = createMockPad({ id: "pad-1", name: "Kick", layers: [layer] });
      const pad2 = createMockPad({ id: "pad-2", name: "Snare" });
      scene.pads.push(pad1, pad2);
      const entry = createMockHistoryEntry();
      getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);
      return { scene, pad1, pad2, layer };
    }

    it("inserts a new pad immediately after the source pad", () => {
      loadSceneWithTwoPads();
      getState().duplicatePad("scene-1", "pad-1");
      const pads = getState().project!.scenes[0].pads;
      expect(pads).toHaveLength(3);
      expect(pads[0].id).toBe("pad-1");
      expect(pads[1].name).toBe("Kick"); // duplicate is at index 1
      expect(pads[2].id).toBe("pad-2");
    });

    it("assigns a new unique id to the duplicated pad", () => {
      loadSceneWithTwoPads();
      getState().duplicatePad("scene-1", "pad-1");
      const pads = getState().project!.scenes[0].pads;
      expect(pads[1].id).not.toBe("pad-1");
      expect(pads[1].id).toBeTruthy();
    });

    it("assigns new ids to all layers in the duplicated pad", () => {
      loadSceneWithTwoPads();
      getState().duplicatePad("scene-1", "pad-1");
      const duplicate = getState().project!.scenes[0].pads[1];
      expect(duplicate.layers[0].id).not.toBe("layer-1");
    });

    it("marks the project as dirty", () => {
      loadSceneWithTwoPads();
      getState().duplicatePad("scene-1", "pad-1");
      expect(getState().isDirty).toBe(true);
    });

    it("is a no-op if pad does not exist", () => {
      loadSceneWithTwoPads();
      getState().duplicatePad("scene-1", "nonexistent");
      expect(getState().project?.scenes[0].pads).toHaveLength(2);
    });

    it("is a no-op if scene does not exist", () => {
      loadSceneWithTwoPads();
      getState().duplicatePad("nonexistent", "pad-1");
      expect(getState().project?.scenes[0].pads).toHaveLength(2);
    });
  });

  function loadTwoScenes() {
    const entry = createMockHistoryEntry();
    const layer = createMockLayer();
    const pad = createMockPad({ layers: [layer] });
    const scene1 = createMockScene({ pads: [pad] });
    const scene2 = createMockScene({ pads: [] });
    getState().loadProject(entry, createMockProject({ scenes: [scene1, scene2] }), false);
    return { pad, scene1, scene2, layer };
  }

  describe("movePadToScene", () => {
    it("moves the pad to the target scene", () => {
      const { pad, scene1, scene2 } = loadTwoScenes();
      getState().movePadToScene(scene1.id, pad.id, scene2.id);
      const targetScene = getState().project!.scenes.find((s) => s.id === scene2.id);
      expect(targetScene?.pads).toHaveLength(1);
      expect(targetScene?.pads[0].id).toBe(pad.id);
    });

    it("removes the pad from the source scene", () => {
      const { pad, scene1, scene2 } = loadTwoScenes();
      getState().movePadToScene(scene1.id, pad.id, scene2.id);
      const sourceScene = getState().project!.scenes.find((s) => s.id === scene1.id);
      expect(sourceScene?.pads).toHaveLength(0);
    });

    it("marks the project as dirty", () => {
      const { pad, scene1, scene2 } = loadTwoScenes();
      expect(getState().isDirty).toBe(false);
      getState().movePadToScene(scene1.id, pad.id, scene2.id);
      expect(getState().isDirty).toBe(true);
    });

    it("is a no-op if no project is loaded", () => {
      getState().movePadToScene("scene-1", "pad-1", "scene-2");
      expect(getState().project).toBeNull();
    });

    it("is a no-op if fromSceneId does not exist", () => {
      const { pad, scene2 } = loadTwoScenes();
      getState().movePadToScene("nonexistent", pad.id, scene2.id);
      const targetScene = getState().project!.scenes.find((s) => s.id === scene2.id);
      expect(targetScene?.pads).toHaveLength(0);
      expect(getState().isDirty).toBe(false);
    });

    it("is a no-op if padId does not exist", () => {
      const { scene1, scene2 } = loadTwoScenes();
      getState().movePadToScene(scene1.id, "nonexistent", scene2.id);
      const sourceScene = getState().project!.scenes.find((s) => s.id === scene1.id);
      const targetScene = getState().project!.scenes.find((s) => s.id === scene2.id);
      expect(sourceScene?.pads).toHaveLength(1);
      expect(targetScene?.pads).toHaveLength(0);
      expect(getState().isDirty).toBe(false);
    });

    it("is a no-op if toSceneId does not exist", () => {
      const { pad, scene1 } = loadTwoScenes();
      getState().movePadToScene(scene1.id, pad.id, "nonexistent");
      const sourceScene = getState().project!.scenes.find((s) => s.id === scene1.id);
      expect(sourceScene?.pads).toHaveLength(1);
      expect(getState().isDirty).toBe(false);
    });

    it("is a no-op if fromSceneId and toSceneId are the same", () => {
      const { pad, scene1 } = loadTwoScenes();
      getState().movePadToScene(scene1.id, pad.id, scene1.id);
      const sourceScene = getState().project!.scenes.find((s) => s.id === scene1.id);
      expect(sourceScene?.pads).toHaveLength(1);
      expect(sourceScene?.pads[0].id).toBe(pad.id);
      expect(getState().isDirty).toBe(false);
    });
  });

  describe("copyPadToScene", () => {
    it("copies the pad to the target scene", () => {
      const { pad, scene1, scene2 } = loadTwoScenes();
      getState().copyPadToScene(scene1.id, pad.id, scene2.id);
      const targetScene = getState().project!.scenes.find((s) => s.id === scene2.id);
      expect(targetScene?.pads).toHaveLength(1);
    });

    it("keeps the pad in the source scene", () => {
      const { pad, scene1, scene2 } = loadTwoScenes();
      getState().copyPadToScene(scene1.id, pad.id, scene2.id);
      const sourceScene = getState().project!.scenes.find((s) => s.id === scene1.id);
      expect(sourceScene?.pads).toHaveLength(1);
      expect(sourceScene?.pads[0].id).toBe(pad.id);
    });

    it("assigns a new unique id to the copied pad", () => {
      const { pad, scene1, scene2 } = loadTwoScenes();
      getState().copyPadToScene(scene1.id, pad.id, scene2.id);
      const targetScene = getState().project!.scenes.find((s) => s.id === scene2.id);
      expect(targetScene?.pads[0].id).not.toBe(pad.id);
      expect(targetScene?.pads[0].id).toBeTruthy();
    });

    it("assigns a new id to the layer in the copied pad", () => {
      const { pad, layer, scene1, scene2 } = loadTwoScenes();
      getState().copyPadToScene(scene1.id, pad.id, scene2.id);
      const targetScene = getState().project!.scenes.find((s) => s.id === scene2.id);
      expect(targetScene?.pads[0].layers[0].id).not.toBe(layer.id);
    });

    it("marks the project as dirty", () => {
      const { pad, scene1, scene2 } = loadTwoScenes();
      expect(getState().isDirty).toBe(false);
      getState().copyPadToScene(scene1.id, pad.id, scene2.id);
      expect(getState().isDirty).toBe(true);
    });

    it("is a no-op if no project is loaded", () => {
      getState().copyPadToScene("scene-1", "pad-1", "scene-2");
      expect(getState().project).toBeNull();
    });

    it("is a no-op if fromSceneId does not exist", () => {
      const { pad, scene2 } = loadTwoScenes();
      getState().copyPadToScene("nonexistent", pad.id, scene2.id);
      const targetScene = getState().project!.scenes.find((s) => s.id === scene2.id);
      expect(targetScene?.pads).toHaveLength(0);
      expect(getState().isDirty).toBe(false);
    });

    it("is a no-op if padId does not exist", () => {
      const { scene1, scene2 } = loadTwoScenes();
      getState().copyPadToScene(scene1.id, "nonexistent", scene2.id);
      const sourceScene = getState().project!.scenes.find((s) => s.id === scene1.id);
      const targetScene = getState().project!.scenes.find((s) => s.id === scene2.id);
      expect(sourceScene?.pads).toHaveLength(1);
      expect(targetScene?.pads).toHaveLength(0);
      expect(getState().isDirty).toBe(false);
    });

    it("is a no-op if toSceneId does not exist", () => {
      const { pad, scene1 } = loadTwoScenes();
      getState().copyPadToScene(scene1.id, pad.id, "nonexistent");
      const sourceScene = getState().project!.scenes.find((s) => s.id === scene1.id);
      expect(sourceScene?.pads).toHaveLength(1);
      expect(getState().isDirty).toBe(false);
    });

    it("is a no-op if fromSceneId and toSceneId are the same", () => {
      const { pad, scene1 } = loadTwoScenes();
      getState().copyPadToScene(scene1.id, pad.id, scene1.id);
      const sourceScene = getState().project!.scenes.find((s) => s.id === scene1.id);
      expect(sourceScene?.pads).toHaveLength(1);
      expect(sourceScene?.pads[0].id).toBe(pad.id);
      expect(getState().isDirty).toBe(false);
    });
  });

  describe("reorderScenes", () => {
    function loadWithThreeScenes() {
      const entry = createMockHistoryEntry();
      const scenes = [
        createMockScene({ id: "s1", name: "Scene A" }),
        createMockScene({ id: "s2", name: "Scene B" }),
        createMockScene({ id: "s3", name: "Scene C" }),
      ];
      getState().loadProject(entry, createMockProject({ scenes }), false);
    }

    it("should move a scene from one position to another", () => {
      loadWithThreeScenes();
      getState().reorderScenes(0, 2);
      const ids = getState().project!.scenes.map((s) => s.id);
      expect(ids).toEqual(["s2", "s3", "s1"]);
    });

    it("should preserve all scenes in correct order when moving forward", () => {
      loadWithThreeScenes();
      getState().reorderScenes(2, 0);
      const ids = getState().project!.scenes.map((s) => s.id);
      expect(ids).toEqual(["s3", "s1", "s2"]);
    });

    it("should be a no-op when fromIndex equals toIndex", () => {
      loadWithThreeScenes();
      getState().reorderScenes(1, 1);
      const ids = getState().project!.scenes.map((s) => s.id);
      expect(ids).toEqual(["s1", "s2", "s3"]);
    });

    it("should mark the project as dirty", () => {
      loadWithThreeScenes();
      expect(getState().isDirty).toBe(false);
      getState().reorderScenes(0, 1);
      expect(getState().isDirty).toBe(true);
    });

    it("should do nothing if no project is loaded", () => {
      getState().reorderScenes(0, 1);
      expect(getState().project).toBeNull();
    });

    it("should be a no-op for negative fromIndex", () => {
      loadWithThreeScenes();
      getState().reorderScenes(-1, 1);
      const ids = getState().project!.scenes.map((s) => s.id);
      expect(ids).toEqual(["s1", "s2", "s3"]);
      expect(getState().isDirty).toBe(false);
    });

    it("should be a no-op for out-of-bounds fromIndex", () => {
      loadWithThreeScenes();
      getState().reorderScenes(5, 1);
      const ids = getState().project!.scenes.map((s) => s.id);
      expect(ids).toEqual(["s1", "s2", "s3"]);
      expect(getState().isDirty).toBe(false);
    });

    it("should be a no-op for out-of-bounds toIndex", () => {
      loadWithThreeScenes();
      getState().reorderScenes(0, 10);
      const ids = getState().project!.scenes.map((s) => s.id);
      expect(ids).toEqual(["s1", "s2", "s3"]);
      expect(getState().isDirty).toBe(false);
    });

    it("should be a no-op when toIndex equals array length (post-splice boundary)", () => {
      loadWithThreeScenes();
      getState().reorderScenes(0, 3); // 3 === scenes.length, > postSpliceLength(2)
      const ids = getState().project!.scenes.map((s) => s.id);
      expect(ids).toEqual(["s1", "s2", "s3"]);
      expect(getState().isDirty).toBe(false);
    });
  });

  describe("reorderPads", () => {
    function loadWithThreePads() {
      const entry = createMockHistoryEntry();
      const pads = [
        createMockPad({ id: "p1", name: "Kick" }),
        createMockPad({ id: "p2", name: "Snare" }),
        createMockPad({ id: "p3", name: "HiHat" }),
      ];
      const scene = createMockScene({ id: "scene-1", pads });
      getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);
    }

    it("should move a pad from one position to another", () => {
      loadWithThreePads();
      getState().reorderPads("scene-1", 0, 2);
      const ids = getState().project!.scenes[0].pads.map((p) => p.id);
      expect(ids).toEqual(["p2", "p3", "p1"]);
    });

    it("should preserve all pads in correct order when moving backward", () => {
      loadWithThreePads();
      getState().reorderPads("scene-1", 2, 0);
      const ids = getState().project!.scenes[0].pads.map((p) => p.id);
      expect(ids).toEqual(["p3", "p1", "p2"]);
    });

    it("should mark the project as dirty", () => {
      loadWithThreePads();
      expect(getState().isDirty).toBe(false);
      getState().reorderPads("scene-1", 0, 1);
      expect(getState().isDirty).toBe(true);
    });

    it("should be a no-op for an invalid sceneId", () => {
      loadWithThreePads();
      getState().reorderPads("nonexistent", 0, 1);
      const ids = getState().project!.scenes[0].pads.map((p) => p.id);
      expect(ids).toEqual(["p1", "p2", "p3"]);
      expect(getState().isDirty).toBe(false);
    });

    it("should do nothing if no project is loaded", () => {
      getState().reorderPads("scene-1", 0, 1);
      expect(getState().project).toBeNull();
    });

    it("should be a no-op for negative fromIndex", () => {
      loadWithThreePads();
      getState().reorderPads("scene-1", -1, 1);
      const ids = getState().project!.scenes[0].pads.map((p) => p.id);
      expect(ids).toEqual(["p1", "p2", "p3"]);
      expect(getState().isDirty).toBe(false);
    });

    it("should be a no-op for out-of-bounds fromIndex", () => {
      loadWithThreePads();
      getState().reorderPads("scene-1", 5, 1);
      const ids = getState().project!.scenes[0].pads.map((p) => p.id);
      expect(ids).toEqual(["p1", "p2", "p3"]);
      expect(getState().isDirty).toBe(false);
    });

    it("should be a no-op for out-of-bounds toIndex", () => {
      loadWithThreePads();
      getState().reorderPads("scene-1", 0, 10);
      const ids = getState().project!.scenes[0].pads.map((p) => p.id);
      expect(ids).toEqual(["p1", "p2", "p3"]);
      expect(getState().isDirty).toBe(false);
    });

    it("should be a no-op when toIndex equals array length (post-splice boundary)", () => {
      loadWithThreePads();
      getState().reorderPads("scene-1", 0, 3); // 3 === pads.length, > postSpliceLength(2)
      const ids = getState().project!.scenes[0].pads.map((p) => p.id);
      expect(ids).toEqual(["p1", "p2", "p3"]);
      expect(getState().isDirty).toBe(false);
    });
  });

  describe("setPadFadeDuration", () => {
    function loadWithPad() {
      const entry = createMockHistoryEntry();
      const pad = createMockPad({ id: "pad-1", name: "Kick" });
      const scene = createMockScene({ id: "scene-1", pads: [pad] });
      getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);
      return { sceneId: scene.id, padId: pad.id };
    }

    it("should set fadeDurationMs on the pad", () => {
      const { sceneId, padId } = loadWithPad();
      getState().setPadFadeDuration(sceneId, padId, 3000);
      const pad = getState().project?.scenes[0].pads[0];
      expect(pad?.fadeDurationMs).toBe(3000);
    });

    it("should clear fadeDurationMs when passed undefined", () => {
      const { sceneId, padId } = loadWithPad();
      getState().setPadFadeDuration(sceneId, padId, 3000);
      getState().setPadFadeDuration(sceneId, padId, undefined);
      const pad = getState().project?.scenes[0].pads[0];
      expect(pad?.fadeDurationMs).toBeUndefined();
    });

    it("should mark project as dirty", () => {
      const { sceneId, padId } = loadWithPad();
      getState().setPadFadeDuration(sceneId, padId, 1500);
      expect(getState().isDirty).toBe(true);
    });

    it("should do nothing if no project is loaded", () => {
      getState().setPadFadeDuration("any-scene", "any-pad", 2000);
      expect(getState().project).toBeNull();
    });

    it("should do nothing if padId does not exist in the scene", () => {
      const { sceneId } = loadWithPad();
      getState().setPadFadeDuration(sceneId, "nonexistent-pad", 2000);
      const pad = getState().project?.scenes[0].pads[0];
      expect(pad?.fadeDurationMs).toBeUndefined();
    });

    it("should do nothing if sceneId does not exist", () => {
      loadWithPad();
      getState().setPadFadeDuration("nonexistent-scene", "pad-1", 2000);
      const pad = getState().project?.scenes[0].pads[0];
      expect(pad?.fadeDurationMs).toBeUndefined();
    });
  });

  describe("setPadFadeTarget", () => {
    function loadWithPad() {
      const entry = createMockHistoryEntry();
      const pad = createMockPad({ id: "pad-1", name: "Kick" });
      const scene = createMockScene({ id: "scene-1", pads: [pad] });
      getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);
      return { sceneId: scene.id, padId: pad.id };
    }

    it("should set fadeTargetVol on the pad", () => {
      const { sceneId, padId } = loadWithPad();
      getState().setPadFadeTarget(sceneId, padId, 50);
      const pad = getState().project?.scenes[0].pads[0];
      expect(pad?.fadeTargetVol).toBe(50);
    });

    it("should mark project as dirty", () => {
      const { sceneId, padId } = loadWithPad();
      getState().setPadFadeTarget(sceneId, padId, 75);
      expect(getState().isDirty).toBe(true);
    });

    it("should do nothing if no project is loaded", () => {
      getState().setPadFadeTarget("any-scene", "any-pad", 50);
      expect(getState().project).toBeNull();
    });

    it("should do nothing if padId does not exist in the scene", () => {
      const { sceneId } = loadWithPad();
      getState().setPadFadeTarget(sceneId, "nonexistent-pad", 50);
      const pad = getState().project?.scenes[0].pads[0];
      expect(pad?.fadeTargetVol).toBeUndefined();
    });

    it("should do nothing if sceneId does not exist", () => {
      loadWithPad();
      getState().setPadFadeTarget("nonexistent-scene", "pad-1", 50);
      const pad = getState().project?.scenes[0].pads[0];
      expect(pad?.fadeTargetVol).toBeUndefined();
    });
  });

  describe("setPadVolume", () => {
    function loadWithPad() {
      const entry = createMockHistoryEntry();
      const pad = createMockPad({ id: "pad-1", name: "Kick" });
      const scene = createMockScene({ id: "scene-1", pads: [pad] });
      getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);
      return { sceneId: scene.id, padId: pad.id };
    }

    it("should set volume on the pad", () => {
      const { sceneId, padId } = loadWithPad();
      getState().setPadVolume(sceneId, padId, 80);
      const pad = getState().project?.scenes[0].pads[0];
      expect(pad?.volume).toBe(80);
    });

    it("should mark project as dirty", () => {
      const { sceneId, padId } = loadWithPad();
      getState().setPadVolume(sceneId, padId, 60);
      expect(getState().isDirty).toBe(true);
    });

    it("should do nothing if no project is loaded", () => {
      getState().setPadVolume("any-scene", "any-pad", 80);
      expect(getState().project).toBeNull();
    });

    it("should do nothing if padId does not exist in the scene", () => {
      const { sceneId } = loadWithPad();
      getState().setPadVolume(sceneId, "nonexistent-pad", 80);
      const pad = getState().project?.scenes[0].pads[0];
      expect(pad?.volume).toBeUndefined();
    });

    it("should do nothing if sceneId does not exist", () => {
      loadWithPad();
      getState().setPadVolume("nonexistent-scene", "pad-1", 80);
      const pad = getState().project?.scenes[0].pads[0];
      expect(pad?.volume).toBeUndefined();
    });
  });

  describe("updateLayerVolume", () => {
    function loadWithLayers() {
      const layer1 = createMockLayer({ id: "layer-1", volume: 100 });
      const layer2 = createMockLayer({ id: "layer-2", volume: 100 });
      const pad = createMockPad({ id: "pad-1", layers: [layer1, layer2] });
      const scene = createMockScene({ id: "scene-1", pads: [pad] });
      const project = createMockProject({ scenes: [scene] });
      getState().loadProject(createMockHistoryEntry(), project, false);
    }

    it("updates the target layer volume and marks isDirty", () => {
      loadWithLayers();
      getState().updateLayerVolume("layer-1", 0.5);
      const layer = getState().project?.scenes[0].pads[0].layers.find((l) => l.id === "layer-1");
      expect(layer?.volume).toBe(50);
      expect(getState().isDirty).toBe(true);
    });

    it("does not modify other layers", () => {
      loadWithLayers();
      getState().updateLayerVolume("layer-1", 0.5);
      const layer2 = getState().project?.scenes[0].pads[0].layers.find((l) => l.id === "layer-2");
      expect(layer2?.volume).toBe(100);
    });

    it("clamps volume to [0, 100] range — 0 at bottom boundary", () => {
      loadWithLayers();
      getState().updateLayerVolume("layer-1", 0);
      const layer = getState().project?.scenes[0].pads[0].layers.find((l) => l.id === "layer-1");
      expect(layer?.volume).toBe(0);
    });

    it("clamps volume to [0, 100] range — 100 at top boundary", () => {
      loadWithLayers();
      getState().updateLayerVolume("layer-1", 1);
      const layer = getState().project?.scenes[0].pads[0].layers.find((l) => l.id === "layer-1");
      expect(layer?.volume).toBe(100);
    });

    it("is a no-op for an unknown layer ID", () => {
      loadWithLayers();
      getState().updateLayerVolume("nonexistent-layer", 0.5);
      const layer1 = getState().project?.scenes[0].pads[0].layers.find((l) => l.id === "layer-1");
      const layer2 = getState().project?.scenes[0].pads[0].layers.find((l) => l.id === "layer-2");
      expect(layer1?.volume).toBe(100);
      expect(layer2?.volume).toBe(100);
      expect(getState().isDirty).toBe(false);
    });

    it("finds a layer across multiple scenes", () => {
      const layer = createMockLayer({ id: "layer-remote", volume: 100 });
      const pad = createMockPad({ id: "pad-remote", layers: [layer] });
      const scene1 = createMockScene({ id: "scene-1", pads: [] });
      const scene2 = createMockScene({ id: "scene-2", pads: [pad] });
      const project = createMockProject({ scenes: [scene1, scene2] });
      getState().loadProject(createMockHistoryEntry(), project, false);

      getState().updateLayerVolume("layer-remote", 0.75);

      const found = getState().project?.scenes[1].pads[0].layers[0];
      expect(found?.volume).toBe(75);
    });
  });
});
