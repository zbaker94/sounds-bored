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
  addSet: (name: string) => Set;
  duplicateSet: (setId: string) => Set | null;
  addSoundsToSet: (soundIds: string[], setId: string) => void;
}

export type LibraryStore = LibraryState & LibraryActions;

export const initialLibraryState: LibraryState = {
  sounds: [],
  tags: [],
  sets: [],
  isDirty: false,
};

export const useLibraryStore = create<LibraryStore>()(
  immer((set, get) => ({
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

    addSet: (name) => {
      const newSet: Set = { id: crypto.randomUUID(), name };
      set((draft) => {
        draft.sets.push(newSet);
        draft.isDirty = true;
      });
      return newSet;
    },

    duplicateSet: (setId) => {
      const original = get().sets.find((s) => s.id === setId);
      if (!original) return null;

      const newSet: Set = {
        id: crypto.randomUUID(),
        name: original.name + " (Copy)",
      };
      set((draft) => {
        draft.sets.push(newSet);
        for (const sound of draft.sounds) {
          if (sound.sets.includes(setId)) {
            sound.sets.push(newSet.id);
          }
        }
        draft.isDirty = true;
      });
      return newSet;
    },

    addSoundsToSet: (soundIds, setId) =>
      set((draft) => {
        for (const soundId of soundIds) {
          const sound = draft.sounds.find((s) => s.id === soundId);
          if (sound && !sound.sets.includes(setId)) {
            sound.sets.push(setId);
          }
        }
        draft.isDirty = true;
      }),
  }))
);
