import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { Pad, PadConfig, Project, ProjectHistoryEntry, Scene } from "@/lib/schemas";

interface ProjectState {
  project: Project | null;
  folderPath: string | null;
  historyEntry: ProjectHistoryEntry | null;
  isTemporary: boolean;
  isDirty: boolean;
  activeSceneId: string | null;
}

interface ProjectActions {
  loadProject: (historyEntry: ProjectHistoryEntry, project: Project, isTemporary: boolean) => void;
  /**
   * Replaces the entire project object and marks state as dirty.
   * @transitional This generic setter will be replaced by specific actions
   * (e.g., addScene, updatePad, renamePad) in Phase 3+. Prefer specific actions
   * for any new mutation work. Do not remove until specific actions are in place.
   */
  updateProject: (project: Project) => void;
  clearDirtyFlag: () => void;
  markAsPermanent: (historyEntry: ProjectHistoryEntry, project: Project) => void;
  clearProject: () => void;
  setActiveSceneId: (sceneId: string) => void;
  addScene: (name?: string) => void;
  renameScene: (sceneId: string, name: string) => void;
  addPad: (sceneId: string, config: PadConfig) => void;
  updatePad: (sceneId: string, padId: string, config: PadConfig) => void;
}

export type ProjectStore = ProjectState & ProjectActions;

export const initialProjectState: ProjectState = {
  project: null,
  folderPath: null,
  historyEntry: null,
  isTemporary: false,
  isDirty: false,
  activeSceneId: null,
};

export const useProjectStore = create<ProjectStore>()(
  immer((set) => ({
    ...initialProjectState,

    loadProject: (historyEntry, project, isTemporary) =>
      set((draft) => {
        draft.historyEntry = historyEntry;
        draft.project = project;
        draft.folderPath = historyEntry.path;
        draft.isTemporary = isTemporary;
        draft.isDirty = false;
        draft.activeSceneId = project.scenes.length > 0 ? project.scenes[0].id : null;
      }),

    updateProject: (project) =>
      set((draft) => {
        if (draft.project !== null) {
          draft.project = project;
          draft.isDirty = true;
        }
      }),

    clearDirtyFlag: () =>
      set((draft) => {
        draft.isDirty = false;
      }),

    markAsPermanent: (historyEntry, project) =>
      set((draft) => {
        draft.historyEntry = historyEntry;
        draft.project = project;
        draft.folderPath = historyEntry.path;
        draft.isTemporary = false;
        draft.isDirty = false;
      }),

    clearProject: () => set(() => ({ ...initialProjectState })),

    setActiveSceneId: (sceneId) =>
      set((draft) => {
        if (draft.project?.scenes.some((s) => s.id === sceneId)) {
          draft.activeSceneId = sceneId;
        }
      }),

    addScene: (name) =>
      set((draft) => {
        if (!draft.project) return;
        const newScene: Scene = {
          id: crypto.randomUUID(),
          name: name ?? `Scene ${draft.project.scenes.length + 1}`,
          pads: [],
        };
        draft.project.scenes.push(newScene);
        draft.activeSceneId = newScene.id;
        draft.isDirty = true;
      }),

    renameScene: (sceneId, name) =>
      set((draft) => {
        if (!draft.project) return;
        const trimmed = name.trim();
        if (!trimmed) return;
        const scene = draft.project.scenes.find((s) => s.id === sceneId);
        if (!scene) return;
        scene.name = trimmed;
        draft.isDirty = true;
      }),

    addPad: (sceneId, config) =>
      set((draft) => {
        if (!draft.project) return;
        const scene = draft.project.scenes.find((s) => s.id === sceneId);
        if (!scene) return;
        const newPad: Pad = {
          id: crypto.randomUUID(),
          ...config,
        };
        scene.pads.push(newPad);
        draft.isDirty = true;
      }),

    updatePad: (sceneId, padId, config) =>
      set((draft) => {
        if (!draft.project) return;
        const scene = draft.project.scenes.find((s) => s.id === sceneId);
        if (!scene) return;
        const pad = scene.pads.find((p) => p.id === padId);
        if (!pad) return;
        Object.assign(pad, config);
        draft.isDirty = true;
      }),
  }))
);
