import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { Pad, PadConfig, Project, ProjectHistoryEntry, Scene } from "@/lib/schemas";
// Cross-store side effect: projectStore calls useUiStore.getState() in loadProject,
// clearProject, addScene, and deleteScene to keep activeSceneId in sync with scene
// lifecycle changes. This is a deliberate pragmatic choice — uiStore does not import
// projectStore, so there is no circular dependency. The inverse (having UI callers
// update both stores) would require duplicating scene-selection logic across all call
// sites (SceneTabBar, useGlobalHotkeys, drag-to-add, keyboard shortcuts, etc.).
//
// These four call sites pass the post-mutation `sceneIds` list to
// `setActiveSceneId` so it can enforce the activeSceneId invariant (ARCH-4):
// silently rejecting ids that don't exist in the current project.
import { useUiStore } from "./uiStore";

interface ProjectState {
  project: Project | null;
  folderPath: string | null;
  historyEntry: ProjectHistoryEntry | null;
  isTemporary: boolean;
  isDirty: boolean;
}

interface ProjectActions {
  loadProject: (historyEntry: ProjectHistoryEntry, project: Project, isTemporary: boolean) => void;
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
}

export type ProjectStore = ProjectState & ProjectActions;

export const initialProjectState: ProjectState = {
  project: null,
  folderPath: null,
  historyEntry: null,
  isTemporary: false,
  isDirty: false,
};

export const useProjectStore = create<ProjectStore>()(
  immer((set, get) => ({
    ...initialProjectState,

    loadProject: (historyEntry, project, isTemporary) => {
      set((draft) => {
        draft.historyEntry = historyEntry;
        draft.project = project;
        draft.folderPath = historyEntry.path;
        draft.isTemporary = isTemporary;
        draft.isDirty = false;
      });
      // Pass sceneIds so `setActiveSceneId` enforces the activeSceneId invariant.
      const sceneIds = project.scenes.map((s) => s.id);
      useUiStore
        .getState()
        .setActiveSceneId(sceneIds.length > 0 ? sceneIds[0] : null, sceneIds);
    },

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

    clearProject: () => {
      set(() => ({ ...initialProjectState }));
      // Null is always accepted by `setActiveSceneId`; pass an empty scene list
      // for consistency with other lifecycle call sites.
      useUiStore.getState().setActiveSceneId(null, []);
    },

    addScene: (name) => {
      let newSceneId: string | null = null;
      set((draft) => {
        if (!draft.project) return;
        const newScene: Scene = {
          id: crypto.randomUUID(),
          name: name ?? `Scene ${draft.project.scenes.length + 1}`,
          pads: [],
        };
        draft.project.scenes.push(newScene);
        draft.isDirty = true;
        newSceneId = newScene.id;
      });
      if (newSceneId) {
        // Pass updated sceneIds so `setActiveSceneId` can validate the new id
        // exists (invariant enforcement).
        const sceneIds = get().project?.scenes.map((s) => s.id) ?? [];
        useUiStore.getState().setActiveSceneId(newSceneId, sceneIds);
      }
    },

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

    deleteScene: (sceneId) => {
      const wasActive = useUiStore.getState().activeSceneId === sceneId;
      let deletedIdx = -1;
      set((draft) => {
        if (!draft.project) return;
        deletedIdx = draft.project.scenes.findIndex((s) => s.id === sceneId);
        if (deletedIdx === -1) return;
        draft.project.scenes.splice(deletedIdx, 1);
        draft.isDirty = true;
      });
      if (wasActive && deletedIdx !== -1) {
        const scenes = get().project?.scenes ?? [];
        const next = scenes.length > 0
          ? (scenes[deletedIdx] ?? scenes[deletedIdx - 1])!.id
          : null;
        // Pass updated sceneIds so `setActiveSceneId` enforces the invariant
        // against the post-delete scene list.
        const sceneIds = scenes.map((s) => s.id);
        useUiStore.getState().setActiveSceneId(next, sceneIds);
      }
    },

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
      set((draft) => {
        if (!draft.project) return;
        const scene = draft.project.scenes.find((s) => s.id === sceneId);
        if (!scene) return;
        const pad = scene.pads.find((p) => p.id === padId);
        if (!pad) return;
        pad.fadeDurationMs = durationMs;
        draft.isDirty = true;
      }),

    setPadFadeTarget: (sceneId, padId, targetVol) =>
      set((draft) => {
        if (!draft.project) return;
        const scene = draft.project.scenes.find((s) => s.id === sceneId);
        if (!scene) return;
        const pad = scene.pads.find((p) => p.id === padId);
        if (!pad) return;
        pad.fadeTargetVol = targetVol;
        draft.isDirty = true;
      }),

    setPadVolume: (sceneId, padId, vol) =>
      set((draft) => {
        if (!draft.project) return;
        const scene = draft.project.scenes.find((s) => s.id === sceneId);
        if (!scene) return;
        const pad = scene.pads.find((p) => p.id === padId);
        if (!pad) return;
        pad.volume = vol;
        draft.isDirty = true;
      }),
  }))
);
