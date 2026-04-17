import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { Sound, Tag, SoundSet, GlobalLibrary } from "@/lib/schemas";

interface LibraryState {
  sounds: Sound[];
  tags: Tag[];
  sets: SoundSet[];
  isDirty: boolean;  // tracked; auto-save hook wired in Phase 4
  // Runtime-only — never persisted to disk
  missingSoundIds: Set<string>;
  missingFolderIds: Set<string>;
  /** IDs whose existence could not be determined (permission denied, out-of-scope). */
  unknownSoundIds: Set<string>;
  unknownFolderIds: Set<string>;
  /** True while a full library reconciliation (folder scan + missing-state refresh) is running. */
  isReconciling: boolean;
}

type LibraryData = Pick<LibraryState, "sounds" | "tags" | "sets">;

interface LibraryActions {
  loadLibrary: (library: GlobalLibrary) => void;
  /** Update sounds, tags, and/or sets via an Immer-style updater.
   * Defense-in-depth: the draft is a runtime projection of only persisted fields,
   * so `any`-typed or JS callers cannot reach `isDirty`, `missingSoundIds`, or `isReconciling`.
   * Both push/splice mutations and whole-array assignment (`draft.sounds = x`) are supported. */
  updateLibrary: (updater: (draft: LibraryData) => void) => void;
  clearDirtyFlag: () => void;
  setIsReconciling: (value: boolean) => void;
  /** Atomically checks and sets isReconciling. Returns true if the lock was acquired, false if already in flight. */
  tryStartReconciling: () => boolean;
  addSet: (name: string) => SoundSet;
  duplicateSet: (setId: string) => SoundSet | null;
  deleteSet: (setId: string) => void;
  addSoundsToSet: (soundIds: string[], setId: string) => void;
  /** Ensure a tag with the given name exists (case-insensitive match); create if not found. Returns the tag. */
  ensureTagExists: (name: string, color?: string, isSystem?: boolean) => Tag;
  /** Add tagIds to each sound in soundIds. Idempotent — won't create duplicates in sound.tags. Silently skips system tags. */
  assignTagsToSounds: (soundIds: string[], tagIds: string[]) => void;
  /** Remove tagId from each sound in soundIds. Silently skips system tags. */
  removeTagFromSounds: (soundIds: string[], tagId: string) => void;
  /** Like assignTagsToSounds but bypasses the system tag guard. For internal use (import, bootloader). */
  systemAssignTagsToSounds: (soundIds: string[], tagIds: string[]) => void;
  /** Update runtime missing-file state. Not persisted. */
  setMissingState: (
    missingSoundIds: Set<string>,
    missingFolderIds: Set<string>,
    unknownSoundIds: Set<string>,
    unknownFolderIds: Set<string>,
  ) => void;
}

export type LibraryStore = LibraryState & LibraryActions;

export const initialLibraryState: LibraryState = {
  sounds: [],
  tags: [],
  sets: [],
  isDirty: false,
  missingSoundIds: new Set<string>(),
  missingFolderIds: new Set<string>(),
  unknownSoundIds: new Set<string>(),
  unknownFolderIds: new Set<string>(),
  isReconciling: false,
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
        // INVARIANT: Do NOT mutate sound.tags directly via this action — use
        // assignTagsToSounds / removeTagFromSounds / systemAssignTagsToSounds
        // so system-tag guards are enforced. updateLibrary is for structural
        // changes (sounds list, sets) not tag assignments.
        // Project only the persisted-data fields so callers cannot access or
        // mutate isDirty, missingSoundIds, or other runtime-only state.
        // projected.sounds/tags/sets are still the live Immer proxies, so
        // push/splice/deep-item mutations write through to draft automatically.
        // The explicit write-back below handles the other pattern used by callers:
        //   draft.sounds = newArray  (whole-array replacement / filter result)
        // Unconditional write-back is safe — Immer preserves references for proxies
        // that were not reassigned, so no spurious copy-on-write fires.
        const projected: LibraryData = { sounds: draft.sounds, tags: draft.tags, sets: draft.sets };
        updater(projected);
        draft.sounds = projected.sounds;
        draft.tags = projected.tags;
        draft.sets = projected.sets;
        draft.isDirty = true;
      }),

    clearDirtyFlag: () =>
      set((draft) => {
        draft.isDirty = false;
      }),

    setIsReconciling: (value) => set({ isReconciling: value }),

    tryStartReconciling: () => {
      if (get().isReconciling) return false;
      set({ isReconciling: true });
      return true;
    },

    addSet: (name) => {
      const newSet: SoundSet = { id: crypto.randomUUID(), name };
      set((draft) => {
        draft.sets.push(newSet);
        draft.isDirty = true;
      });
      return newSet;
    },

    duplicateSet: (setId) => {
      const original = get().sets.find((s) => s.id === setId);
      if (!original) return null;

      const newSet: SoundSet = {
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

    deleteSet: (setId) =>
      set((draft) => {
        draft.sets = draft.sets.filter((s) => s.id !== setId);
        for (const sound of draft.sounds) {
          sound.sets = sound.sets.filter((id) => id !== setId);
        }
        draft.isDirty = true;
      }),

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

    ensureTagExists: (name, color, isSystem) => {
      const existing = get().tags.find(
        (t) => t.name.toLowerCase() === name.toLowerCase(),
      );
      if (existing) {
        // NOTE: If a user has already created a tag with the same name as a system
        // tag (e.g., "imported"), and isSystem:true is requested, the existing tag
        // is silently promoted to system status and becomes non-removable by the user.
        // This is an acceptable tradeoff for a desktop app, but callers should be
        // aware. Use SYSTEM_TAG_IMPORTED (a known name) to reduce collision risk.
        if (isSystem && !existing.isSystem) {
          set((draft) => {
            const tag = draft.tags.find((t) => t.id === existing.id);
            if (tag) {
              tag.isSystem = true;
              draft.isDirty = true;
            }
          });
          return { ...existing, isSystem: true };
        }
        return existing;
      }

      const newTag: Tag = { id: crypto.randomUUID(), name, color, isSystem };
      set((draft) => {
        draft.tags.push(newTag);
        draft.isDirty = true;
      });
      return newTag;
    },

    assignTagsToSounds: (soundIds, tagIds) =>
      set((draft) => {
        // Filter out system tag IDs — user-facing action should not assign system tags.
        const nonSystemTagIds = tagIds.filter(
          (tid) => !draft.tags.find((t) => t.id === tid)?.isSystem,
        );
        for (const sound of draft.sounds) {
          if (soundIds.includes(sound.id)) {
            for (const tagId of nonSystemTagIds) {
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
        // Silently skip system tags — they cannot be removed by users.
        const tag = draft.tags.find((t) => t.id === tagId);
        if (tag?.isSystem) return;

        for (const sound of draft.sounds) {
          if (soundIds.includes(sound.id)) {
            sound.tags = sound.tags.filter((t) => t !== tagId);
          }
        }
        draft.isDirty = true;
      }),

    systemAssignTagsToSounds: (soundIds, tagIds) =>
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

    // Plain set — Immer + Set can be finicky, and missing state is simple runtime data
    setMissingState: (missingSoundIds, missingFolderIds, unknownSoundIds, unknownFolderIds) =>
      set({ missingSoundIds, missingFolderIds, unknownSoundIds, unknownFolderIds }),
  }))
);
