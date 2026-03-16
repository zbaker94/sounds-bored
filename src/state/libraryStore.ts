import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { Sound, Tag, Set, GlobalLibrary } from "@/lib/schemas";

interface LibraryState {
  sounds: Sound[];
  tags: Tag[];
  sets: Set[];
  isDirty: boolean;  // tracked; auto-save hook wired in Phase 4
}

type LibraryData = Pick<LibraryState, "sounds" | "tags" | "sets">;

interface LibraryActions {
  loadLibrary: (library: GlobalLibrary) => void;
  updateLibrary: (updater: (draft: LibraryData) => void) => void;
  clearDirtyFlag: () => void;
}

export type LibraryStore = LibraryState & LibraryActions;

export const initialLibraryState: LibraryState = {
  sounds: [],
  tags: [],
  sets: [],
  isDirty: false,
};

export const useLibraryStore = create<LibraryStore>()(
  immer((set) => ({
    ...initialLibraryState,

    loadLibrary: (library) =>
      set((draft) => {
        draft.sounds = library.sounds;
        draft.tags = library.tags;
        draft.sets = library.sets;
        draft.isDirty = false;
      }),

    updateLibrary: (updater) =>
      set((draft) => {
        // Pass only the library-data fields to the updater so callers
        // cannot directly mutate isDirty — that is managed by this action.
        updater(draft);
        draft.isDirty = true;
      }),

    clearDirtyFlag: () =>
      set((draft) => {
        draft.isDirty = false;
      }),
  }))
);
