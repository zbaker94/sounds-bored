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
  /** Ensure a tag with the given name exists (case-insensitive match); create if not found. Returns the tag. */
  ensureTagExists: (name: string, color?: string) => Tag;
  /** Add tagIds to each sound in soundIds. Idempotent — won't create duplicates in sound.tags. */
  assignTagsToSounds: (soundIds: string[], tagIds: string[]) => void;
  /** Remove tagId from each sound in soundIds. */
  removeTagFromSounds: (soundIds: string[], tagId: string) => void;
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

    ensureTagExists: (name, color) => {
      const existing = get().tags.find(
        (t) => t.name.toLowerCase() === name.toLowerCase(),
      );
      if (existing) return existing;

      const newTag: Tag = { id: crypto.randomUUID(), name, color };
      set((draft) => {
        draft.tags.push(newTag);
        draft.isDirty = true;
      });
      return newTag;
    },

    assignTagsToSounds: (soundIds, tagIds) =>
      set((draft) => {
        for (const sound of draft.sounds) {
          if (soundIds.includes(sound.id)) {
            for (const tagId of tagIds) {
              if (!sound.tags.includes(tagId)) {
                sound.tags.push(tagId);
              }
            }
          }
        }
        draft.isDirty = true;
      }),

    removeTagFromSounds: (soundIds, tagId) =>
      set((draft) => {
        for (const sound of draft.sounds) {
          if (soundIds.includes(sound.id)) {
            sound.tags = sound.tags.filter((t) => t !== tagId);
          }
        }
        draft.isDirty = true;
      }),
  }))
);
