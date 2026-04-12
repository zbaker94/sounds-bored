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
  PAD_CONFIG_DRAWER: "pad-config-drawer",
  SETTINGS_DIALOG: "settings-dialog",
  EXPORT_PROGRESS_DIALOG: "export-progress-dialog",
} as const;

interface UiState {
  overlayStack: OverlayEntry[];
  editMode: boolean;
  confirmRemoveMissingSoundsOpen: boolean;
  confirmRemoveMissingFoldersOpen: boolean;
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
  /** Open/close the "Remove All Missing Sounds" confirmation dialog. */
  setConfirmRemoveMissingSoundsOpen: (open: boolean) => void;
  /** Open/close the "Remove All Missing Folders" confirmation dialog. */
  setConfirmRemoveMissingFoldersOpen: (open: boolean) => void;
}

export type UiStore = UiState & UiActions;

export const initialUiState: UiState = {
  overlayStack: [],
  editMode: false,
  confirmRemoveMissingSoundsOpen: false,
  confirmRemoveMissingFoldersOpen: false,
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

  setConfirmRemoveMissingSoundsOpen: (open) =>
    set(() => ({ confirmRemoveMissingSoundsOpen: open })),

  setConfirmRemoveMissingFoldersOpen: (open) =>
    set(() => ({ confirmRemoveMissingFoldersOpen: open })),
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
