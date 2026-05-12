import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

type OverlayType = "drawer" | "dialog";

interface OverlayEntry {
  id: string;
  type: OverlayType;
}

/** Canonical IDs for all tracked overlays. Use these instead of bare string literals. */
export const OVERLAY_ID = {
  MENU_DRAWER: "menu-drawer",
  SOUNDS_PANEL: "sounds-panel",
  SAVE_PROJECT_DIALOG: "save-project-dialog",
  CONFIRM_NAVIGATE_DIALOG: "confirm-navigate-dialog",
  CONFIRM_CLOSE_DIALOG: "confirm-close-dialog",
  LAYER_CONFIG_DIALOG: "layer-config-dialog",
  SETTINGS_DIALOG: "settings-dialog",
  EXPORT_PROGRESS_DIALOG: "export-progress-dialog",
  CONFIRM_REMOVE_MISSING_SOUNDS: "confirm-remove-missing-sounds",
  CONFIRM_REMOVE_MISSING_FOLDERS: "confirm-remove-missing-folders",
} as const;

interface UiState {
  overlayStack: OverlayEntry[];
  editMode: boolean;
  /** The pad currently under the mouse cursor, or null if none. */
  hoveredPadId: string | null;
  /** The pad currently being edited (showing its back face), or null if none. */
  editingPadId: string | null;
  /** The pad whose fade-config popover is currently open, or null if none. */
  fadePopoverPadId: string | null;
  /** In-flight target volume (0–1) being set by the popover slider before commit. */
  fadePopoverTarget: number | null;
  /** Current page index per scene, keyed by scene id. Missing keys default to 0. */
  pageByScene: Record<string, number>;
}

interface UiActions {
  /** Add an overlay to the stack. Idempotent — no-op if id already present. */
  openOverlay: (id: string, type: OverlayType) => void;
  /** Remove an overlay from the stack by id. No-op if not present. */
  closeOverlay: (id: string) => void;
  /** Toggle an overlay open/closed. */
  toggleOverlay: (id: string, type: OverlayType) => void;
  /** Returns true if the given id is anywhere in the stack. */
  isOverlayOpen: (id: string) => boolean;
  /** Returns true if the given id is the topmost overlay. */
  isTopOverlay: (id: string) => boolean;
  /** Returns true if any overlay is currently open. */
  hasOpenOverlay: () => boolean;
  /** Toggle edit mode on/off. */
  toggleEditMode: () => void;
  /** Set the currently hovered pad id, or null to clear. */
  setHoveredPadId: (id: string | null) => void;
  /** Set the pad currently being edited, or null to clear. */
  setEditingPadId: (id: string | null) => void;
  /** Set the pad whose fade-config popover is open, or null to close. */
  setFadePopoverPadId: (id: string | null) => void;
  /** Set the in-flight popover fade target (0–1), or null to clear. */
  setFadePopoverTarget: (target: number | null) => void;
  /** Set the current page for a scene's pad grid. */
  setScenePage: (sceneId: string, page: number) => void;
}

export type UiStore = UiState & UiActions;

export const initialUiState: UiState = {
  overlayStack: [],
  editMode: false,
  hoveredPadId: null,
  editingPadId: null,
  fadePopoverPadId: null,
  fadePopoverTarget: null,
  pageByScene: {},
};

// subscribeWithSelector enables the imperative .subscribe(selector, listener) form
// used by useMultiFadeSideEffects to auto-cancel on editMode/overlay transitions.
export const useUiStore = create<UiStore>()(subscribeWithSelector((set, get) => ({
  ...initialUiState,

  openOverlay: (id, type) =>
    set((state) => {
      if (state.overlayStack.some((entry) => entry.id === id)) {
        return state;
      }
      return { overlayStack: [...state.overlayStack, { id, type }] };
    }),

  closeOverlay: (id) =>
    set((state) => {
      if (!state.overlayStack.some((entry) => entry.id === id)) {
        return state;
      }
      return { overlayStack: state.overlayStack.filter((entry) => entry.id !== id) };
    }),

  toggleOverlay: (id, type) =>
    set((state) => {
      if (state.overlayStack.some((entry) => entry.id === id)) {
        return { overlayStack: state.overlayStack.filter((entry) => entry.id !== id) };
      }
      return { overlayStack: [...state.overlayStack, { id, type }] };
    }),

  isOverlayOpen: (id) => get().overlayStack.some((entry) => entry.id === id),

  isTopOverlay: (id) => {
    const { overlayStack } = get();
    return overlayStack.length > 0 && overlayStack[overlayStack.length - 1].id === id;
  },

  hasOpenOverlay: () => get().overlayStack.length > 0,

  toggleEditMode: () =>
    set((state) => ({ editMode: !state.editMode })),

  setHoveredPadId: (id) => set({ hoveredPadId: id }),

  setEditingPadId: (id) => set({ editingPadId: id }),

  setFadePopoverPadId: (id) => set(id === null ? { fadePopoverPadId: null, fadePopoverTarget: null } : { fadePopoverPadId: id }),

  setFadePopoverTarget: (target) => set({ fadePopoverTarget: target }),

  setScenePage: (sceneId, page) =>
    set((state) => ({ pageByScene: { ...state.pageByScene, [sceneId]: page } })),
})));

// Standalone selector factories for reactive subscriptions via useUiStore().
// Use these instead of `(s) => s.isOverlayOpen(id)` to avoid creating a new
// function reference on every state change, which would cause unnecessary re-renders.
export const selectIsOverlayOpen = (id: string) => (s: UiStore) =>
  s.overlayStack.some((entry) => entry.id === id);

export const selectIsTopOverlay = (id: string) => (s: UiStore) =>
  s.overlayStack.at(-1)?.id === id;

export const selectHasOpenOverlay = (s: UiStore) =>
  s.overlayStack.length > 0;
