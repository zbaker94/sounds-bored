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
  deleteScene: (sceneId: string) => void;
  addPad: (sceneId: string, config: PadConfig) => void;
  updatePad: (sceneId: string, padId: string, config: PadConfig) => void;
  deletePad: (sceneId: string, padId: string) => void;
  duplicatePad: (sceneId: string, padId: string) => void;
  reorderScenes: (fromIndex: number, toIndex: number) => void;
  reorderPads: (sceneId: string, fromIndex: number, toIndex: number) => void;
  updateLayerVolume: (layerId: string, volumePct: number) => void;
  setPadFadeDuration: (sceneId: string, padId: string, durationMs: number | undefined) => void;
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

    deleteScene: (sceneId) =>
      set((draft) => {
        if (!draft.project) return;
        const idx = draft.project.scenes.findIndex((s) => s.id === sceneId);
        if (idx === -1) return;
        draft.project.scenes.splice(idx, 1);
        draft.isDirty = true;
        if (draft.activeSceneId === sceneId) {
          const scenes = draft.project.scenes;
          draft.activeSceneId = scenes.length > 0
            ? (scenes[idx] ?? scenes[idx - 1])!.id
            : null;
        }
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

    deletePad: (sceneId, padId) =>
      set((draft) => {
        if (!draft.project) return;
        const scene = draft.project.scenes.find((s) => s.id === sceneId);
        if (!scene) return;
        const idx = scene.pads.findIndex((p) => p.id === padId);
        if (idx === -1) return;
        scene.pads.splice(idx, 1);
        draft.isDirty = true;
      }),

    duplicatePad: (sceneId, padId) =>
      set((draft) => {
        if (!draft.project) return;
        const scene = draft.project.scenes.find((s) => s.id === sceneId);
        if (!scene) return;
        const idx = scene.pads.findIndex((p) => p.id === padId);
        if (idx === -1) return;
        const source = scene.pads[idx];
        const duplicate: Pad = {
          ...source,
          id: crypto.randomUUID(),
          layers: source.layers.map((l) => ({ ...l, id: crypto.randomUUID() })),
        };
        scene.pads.splice(idx + 1, 0, duplicate);
        draft.isDirty = true;
      }),

    reorderScenes: (fromIndex, toIndex) =>
      set((draft) => {
        if (!draft.project) return;
        const { scenes } = draft.project;
        if (fromIndex < 0 || fromIndex >= scenes.length) return;
        // Validate toIndex against post-splice length (array shrinks by 1 after removal)
        const postSpliceLength = scenes.length - 1;
        if (toIndex < 0 || toIndex > postSpliceLength) return;
        const [moved] = scenes.splice(fromIndex, 1);
        scenes.splice(toIndex, 0, moved);
        draft.isDirty = true;
      }),

    reorderPads: (sceneId, fromIndex, toIndex) =>
      set((draft) => {
        if (!draft.project) return;
        const scene = draft.project.scenes.find((s) => s.id === sceneId);
        if (!scene) return;
        if (fromIndex < 0 || fromIndex >= scene.pads.length) return;
        // Validate toIndex against post-splice length (array shrinks by 1 after removal)
        const postSpliceLength = scene.pads.length - 1;
        if (toIndex < 0 || toIndex > postSpliceLength) return;
        const [moved] = scene.pads.splice(fromIndex, 1);
        scene.pads.splice(toIndex, 0, moved);
        draft.isDirty = true;
      }),

    updateLayerVolume: (layerId, volumePct) =>
      set((draft) => {
        if (!draft.project) return;
        for (const scene of draft.project.scenes) {
          for (const pad of scene.pads) {
            const layer = pad.layers.find((l) => l.id === layerId);
            if (layer) {
              layer.volume = Math.max(0, Math.min(100, Math.round(volumePct * 100)));
              draft.isDirty = true;
              return;
            }
          }
        }
      }),

    setPadFadeDuration: (sceneId, padId, durationMs) =>
      set((draft) => {
        if (!draft.project) return;
        const scene = draft.project.scenes.find((s) => s.id === sceneId);
        if (!scene) return;
        const pad = scene.pads.find((p) => p.id === padId);
        if (!pad) return;
        pad.fadeDurationMs = durationMs;
        draft.isDirty = true;
      }),
  }))
);
