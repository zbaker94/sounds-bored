import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { Pad, PadConfig, Project, ProjectHistoryEntry, Scene } from "@/lib/schemas";

interface ProjectState {
  project: Project | null;
  folderPath: string | null;
  historyEntry: ProjectHistoryEntry | null;
  isTemporary: boolean;
  isDirty: boolean;
  loadSessionId: number;
  /** The currently active scene tab, or null when no project is loaded.
   * Invariant: null or a scene id that exists in the current project.
   * Kept in projectStore so scene lifecycle transitions are atomic. */
  activeSceneId: string | null;
}

interface ProjectActions {
  loadProject: (historyEntry: ProjectHistoryEntry, project: Project, isTemporary: boolean) => void;
  /** Set the active scene. Silently rejects ids that don't exist in the current project. */
  setActiveSceneId: (id: string | null) => void;
  /**
   * Replaces the entire project object and marks state as dirty.
   *
   * Use this for bulk reconciliation operations that must atomically replace the whole
   * project (e.g., stripping references to deleted sounds, resolving missing files on load).
   * For targeted mutations, prefer specific actions: `addScene`, `updatePad`, `renamePad`, etc.
   */
  updateProject: (project: Project) => void;
  clearDirtyFlag: () => void;
  markAsPermanent: (historyEntry: ProjectHistoryEntry, project: Project) => void;
  clearProject: () => void;
  addScene: (name?: string) => void;
  renameScene: (sceneId: string, name: string) => void;
  deleteScene: (sceneId: string) => void;
  addPad: (sceneId: string, config: PadConfig, id?: string) => void;
  updatePad: (sceneId: string, padId: string, config: PadConfig) => void;
  deletePad: (sceneId: string, padId: string) => void;
  duplicatePad: (sceneId: string, padId: string) => void;
  reorderScenes: (fromIndex: number, toIndex: number) => void;
  reorderPads: (sceneId: string, fromIndex: number, toIndex: number) => void;
  updateLayerVolume: (layerId: string, volumePct: number) => void;
  setPadFadeDuration: (sceneId: string, padId: string, durationMs: number | undefined) => void;
  setPadFadeTarget: (sceneId: string, padId: string, targetVol: number) => void;
  setPadVolume: (sceneId: string, padId: string, vol: number) => void;
  setPadName: (sceneId: string, padId: string, name: string) => void;
  setPadColor: (sceneId: string, padId: string, color: string | undefined) => void;
}

export type ProjectStore = ProjectState & ProjectActions;

export const initialProjectState: ProjectState = {
  project: null,
  folderPath: null,
  historyEntry: null,
  isTemporary: false,
  isDirty: false,
  loadSessionId: 0,
  activeSceneId: null,
};

const withPad =
  (sceneId: string, padId: string, update: (pad: Pad) => void) =>
  (draft: ProjectStore) => {
    if (!draft.project) return;
    const scene = draft.project.scenes.find((s) => s.id === sceneId);
    if (!scene) return;
    const pad = scene.pads.find((p) => p.id === padId);
    if (!pad) return;
    update(pad);
    draft.isDirty = true;
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
        draft.loadSessionId += 1;
        draft.activeSceneId = project.scenes[0]?.id ?? null;
      }),

    setActiveSceneId: (id) =>
      set((draft) => {
        if (id === null) {
          draft.activeSceneId = null;
          return;
        }
        if (draft.project?.scenes.some((s) => s.id === id)) {
          draft.activeSceneId = id;
        }
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

    addScene: (name) =>
      set((draft) => {
        if (!draft.project) return;
        const newScene: Scene = {
          id: crypto.randomUUID(),
          name: name ?? `Scene ${draft.project.scenes.length + 1}`,
          pads: [],
        };
        draft.project.scenes.push(newScene);
        draft.isDirty = true;
        draft.activeSceneId = newScene.id;
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
        const deletedIdx = draft.project.scenes.findIndex((s) => s.id === sceneId);
        if (deletedIdx === -1) return;
        const wasActive = draft.activeSceneId === sceneId;
        draft.project.scenes.splice(deletedIdx, 1);
        draft.isDirty = true;
        if (wasActive) {
          const { scenes } = draft.project;
          const candidate = scenes[deletedIdx] ?? scenes[deletedIdx - 1] ?? scenes[0];
          draft.activeSceneId = candidate?.id ?? null;
        }
      }),

    addPad: (sceneId, config, id) =>
      set((draft) => {
        if (!draft.project) return;
        const scene = draft.project.scenes.find((s) => s.id === sceneId);
        if (!scene) return;
        const newPad: Pad = {
          id: id ?? crypto.randomUUID(),
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
        // Object.assign performs a partial merge — keys absent from `config` retain
        // their previous values. Callers MUST include every optional PadConfig field
        // explicitly (set to `undefined` to clear) so that values can be cleared.
        // See issue #172 — omitting muteGroupId/color silently preserved stale values.
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
      set(withPad(sceneId, padId, (pad) => { pad.fadeDurationMs = durationMs; })),

    setPadFadeTarget: (sceneId, padId, targetVol) =>
      set(withPad(sceneId, padId, (pad) => { pad.fadeTargetVol = targetVol; })),

    setPadVolume: (sceneId, padId, vol) =>
      set(withPad(sceneId, padId, (pad) => { pad.volume = vol; })),

    setPadName: (sceneId, padId, name) =>
      set(withPad(sceneId, padId, (pad) => { pad.name = name; })),

    setPadColor: (sceneId, padId, color) =>
      set(withPad(sceneId, padId, (pad) => { pad.color = color; })),
  }))
);
