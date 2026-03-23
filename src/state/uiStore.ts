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
} as const;

interface UiState {
  overlayStack: OverlayEntry[];
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
}

export type UiStore = UiState & UiActions;

export const initialUiState: UiState = {
  overlayStack: [],
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
}));
