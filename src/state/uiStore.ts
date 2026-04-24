import { create } from "zustand";

export type OverlayType = "drawer" | "dialog";

export interface OverlayEntry {
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

/** Overloaded setter for activeSceneId: sceneIds is required when id is non-null. */
export type SetActiveSceneIdFn = {
  (id: null, sceneIds?: string[]): void;
  (id: string, sceneIds: string[]): void;
};

interface UiState {
  overlayStack: OverlayEntry[];
  editMode: boolean;
  /** The currently active scene tab, or null when no project is loaded.
   * Invariant: must be null or a scene id that exists in the current project.
   * `setActiveSceneId` enforces this invariant when callers pass the current
   * scene id list (see its docstring). */
  activeSceneId: string | null;
  /** The pad currently under the mouse cursor, or null if none. */
  hoveredPadId: string | null;
  /** The pad currently being edited (showing its back face), or null if none. */
  editingPadId: string | null;
  /** The pad whose fade-config popover is currently open, or null if none. */
  fadePopoverPadId: string | null;
  /** In-flight target volume (0–1) being set by the popover slider before commit. */
  fadePopoverTarget: number | null;
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
  /** Set the active scene tab. Pass null to clear (e.g., on project close).
   *
   * When `id` is non-null, `sceneIds` is required: a non-null `id` that is NOT
   * in `sceneIds` is silently rejected, guaranteeing `activeSceneId` never
   * dangles on a non-existent scene. Pass the post-mutation scene id list from
   * project lifecycle callers (load/clear/add/delete). Tab bar and hotkey
   * callers derive `id` directly from the rendered scene list and must also
   * pass that list so the invariant is always enforced. */
  setActiveSceneId: SetActiveSceneIdFn;
  /** Set the pad whose fade-config popover is open, or null to close. */
  setFadePopoverPadId: (id: string | null) => void;
  /** Set the in-flight popover fade target (0–1), or null to clear. */
  setFadePopoverTarget: (target: number | null) => void;
}

export type UiStore = UiState & UiActions;

export const initialUiState: UiState = {
  overlayStack: [],
  editMode: false,
  activeSceneId: null,
  hoveredPadId: null,
  editingPadId: null,
  fadePopoverPadId: null,
  fadePopoverTarget: null,
};

export const useUiStore = create<UiStore>()((set, get) => ({
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

  setActiveSceneId: ((id: string | null, sceneIds?: string[]) => {
    // Enforce activeSceneId invariant: when sceneIds is provided and id is
    // non-null, silently reject ids that don't exist in the current scene list.
    if (id !== null && sceneIds !== undefined && !sceneIds.includes(id)) return;
    set({ activeSceneId: id });
  }) as SetActiveSceneIdFn,

  setFadePopoverPadId: (id) => set(id === null ? { fadePopoverPadId: null, fadePopoverTarget: null } : { fadePopoverPadId: id }),

  setFadePopoverTarget: (target) => set({ fadePopoverTarget: target }),
}));

// Standalone selector factories for reactive subscriptions via useUiStore().
// Use these instead of `(s) => s.isOverlayOpen(id)` to avoid creating a new
// function reference on every state change, which would cause unnecessary re-renders.
export const selectIsOverlayOpen = (id: string) => (s: UiStore) =>
  s.overlayStack.some((entry) => entry.id === id);

export const selectIsTopOverlay = (id: string) => (s: UiStore) =>
  s.overlayStack.at(-1)?.id === id;

export const selectHasOpenOverlay = (s: UiStore) =>
  s.overlayStack.length > 0;
