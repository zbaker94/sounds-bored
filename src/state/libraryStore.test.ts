import { describe, it, expect, beforeEach } from "vitest";
import { useLibraryStore, initialLibraryState } from "./libraryStore";
import { createMockGlobalLibrary, createMockSound, createMockSet, createMockTag } from "@/test/factories";

function getState() {
  return useLibraryStore.getState();
}

describe("libraryStore", () => {
  beforeEach(() => {
    useLibraryStore.setState({ ...initialLibraryState });
  });

  describe("initial state", () => {
    it("should start with empty arrays and isDirty false", () => {
      expect(getState().sounds).toEqual([]);
      expect(getState().tags).toEqual([]);
      expect(getState().sets).toEqual([]);
      expect(getState().isDirty).toBe(false);
    });

    it("should start with empty missingSoundIds and missingFolderIds sets", () => {
      expect(getState().missingSoundIds.size).toBe(0);
      expect(getState().missingFolderIds.size).toBe(0);
    });
  });

  describe("loadLibrary", () => {
    it("should populate sounds, tags, sets from library", () => {
      const lib = createMockGlobalLibrary({
        sounds: [{ id: "s1", name: "Kick", tags: [], sets: [] }],
        tags: [{ id: "t1", name: "Drums" }],
        sets: [{ id: "set1", name: "My Set" }],
      });
      getState().loadLibrary(lib);
      expect(getState().sounds).toHaveLength(1);
      expect(getState().tags).toHaveLength(1);
      expect(getState().sets).toHaveLength(1);
    });

    it("should reset isDirty to false on load", () => {
      getState().loadLibrary(createMockGlobalLibrary());
      // manually set dirty
      useLibraryStore.setState({ isDirty: true });
      getState().loadLibrary(createMockGlobalLibrary());
      expect(getState().isDirty).toBe(false);
    });
  });

  describe("updateLibrary", () => {
    it("should apply an immer updater and set isDirty", () => {
      getState().loadLibrary(createMockGlobalLibrary());
      getState().updateLibrary((draft) => {
        draft.sounds.push({ id: "s1", name: "Kick", tags: [], sets: [] });
      });
      expect(getState().sounds).toHaveLength(1);
      expect(getState().isDirty).toBe(true);
    });

    it("should expose only sounds, tags, and sets to the updater — not isDirty or runtime fields", () => {
      let hasIsDirty = true;
      let hasMissingSoundIds = true;
      let hasIsReconciling = true;
      let hasSounds = false;
      getState().updateLibrary((draft) => {
        // Check membership while proxy is still live
        hasIsDirty = "isDirty" in (draft as object);
        hasMissingSoundIds = "missingSoundIds" in (draft as object);
        hasIsReconciling = "isReconciling" in (draft as object);
        hasSounds = "sounds" in (draft as object);
      });
      expect(hasIsDirty).toBe(false);
      expect(hasMissingSoundIds).toBe(false);
      expect(hasIsReconciling).toBe(false);
      expect(hasSounds).toBe(true);
    });

    it("should still propagate mutations to sounds through the projected updater", () => {
      getState().loadLibrary(createMockGlobalLibrary({
        sounds: [{ id: "s1", name: "Existing", tags: [], sets: [] }],
      }));
      getState().updateLibrary((draft) => {
        draft.sounds.push({ id: "s2", name: "New", tags: [], sets: [] });
      });
      expect(getState().sounds).toHaveLength(2);
      expect(getState().sounds[1].name).toBe("New");
    });

    it("should propagate whole-array assignment through the projected updater", () => {
      getState().loadLibrary(createMockGlobalLibrary({
        sounds: [{ id: "s1", name: "Old", tags: [], sets: [] }],
      }));
      getState().updateLibrary((draft) => {
        draft.sounds = [{ id: "s2", name: "Replaced", tags: [], sets: [] }];
      });
      expect(getState().sounds).toHaveLength(1);
      expect(getState().sounds[0].id).toBe("s2");
    });

    it("should propagate filter-reassignment through the projected updater", () => {
      getState().loadLibrary(createMockGlobalLibrary({
        sounds: [
          { id: "s1", name: "Keep", tags: [], sets: [] },
          { id: "s2", name: "Drop", tags: [], sets: [] },
        ],
      }));
      getState().updateLibrary((draft) => {
        draft.sounds = draft.sounds.filter((s) => s.id !== "s2");
      });
      expect(getState().sounds.map((s) => s.id)).toEqual(["s1"]);
    });

    it("should propagate deep item mutations through the projected updater", () => {
      getState().loadLibrary(createMockGlobalLibrary({
        sounds: [{ id: "s1", name: "Old", filePath: "a.wav", tags: [], sets: [] }],
      }));
      getState().updateLibrary((draft) => {
        const target = draft.sounds.find((s) => s.id === "s1");
        if (target) { target.name = "New"; target.filePath = "b.wav"; }
      });
      expect(getState().sounds[0].name).toBe("New");
      expect(getState().sounds[0].filePath).toBe("b.wav");
    });

    it("should not mutate state or set isDirty if the updater throws", () => {
      getState().loadLibrary(createMockGlobalLibrary({
        sounds: [{ id: "s1", name: "Kick", tags: [], sets: [] }],
      }));
      useLibraryStore.setState({ isDirty: false });
      expect(() =>
        getState().updateLibrary(() => { throw new Error("boom"); }),
      ).toThrow("boom");
      expect(getState().sounds).toHaveLength(1);
      expect(getState().isDirty).toBe(false);
    });
  });

  describe("clearDirtyFlag", () => {
    it("should set isDirty to false", () => {
      useLibraryStore.setState({ isDirty: true });
      getState().clearDirtyFlag();
      expect(getState().isDirty).toBe(false);
    });
  });

  describe("addSet", () => {
    it("should create a set with the given name", () => {
      getState().addSet("My Set");

      expect(getState().sets).toHaveLength(1);
      expect(getState().sets[0].name).toBe("My Set");
    });

    it("should return the new Set object", () => {
      const result = getState().addSet("My Set");

      expect(result.name).toBe("My Set");
      expect(result.id).toBeTruthy();
      expect(getState().sets[0]).toEqual(result);
    });

    it("should mark isDirty = true", () => {
      expect(getState().isDirty).toBe(false);

      getState().addSet("My Set");

      expect(getState().isDirty).toBe(true);
    });
  });

  describe("duplicateSet", () => {
    it("should return null for an unknown id", () => {
      const result = getState().duplicateSet("nonexistent-id");

      expect(result).toBeNull();
    });

    it("should create a copy with ' (Copy)' suffix", () => {
      const original = createMockSet({ id: "set-1", name: "Drums" });
      useLibraryStore.setState({ sets: [original] });

      const copy = getState().duplicateSet("set-1");

      expect(copy).not.toBeNull();
      expect(copy!.name).toBe("Drums (Copy)");
      expect(copy!.id).not.toBe(original.id);
      expect(getState().sets).toHaveLength(2);
    });

    it("should not modify the original set", () => {
      const original = createMockSet({ id: "set-1", name: "Drums" });
      useLibraryStore.setState({ sets: [original] });

      getState().duplicateSet("set-1");

      const stored = getState().sets.find((s) => s.id === "set-1");
      expect(stored?.name).toBe("Drums");
    });

    it("should copy set membership: sounds that had the original setId also get the new setId", () => {
      const original = createMockSet({ id: "set-1", name: "Drums" });
      const sound1 = createMockSound({ id: "sound-1", sets: ["set-1"] });
      const sound2 = createMockSound({ id: "sound-2", sets: ["set-1", "set-other"] });
      useLibraryStore.setState({ sets: [original], sounds: [sound1, sound2] });

      const copy = getState().duplicateSet("set-1");

      const s1 = getState().sounds.find((s) => s.id === "sound-1");
      const s2 = getState().sounds.find((s) => s.id === "sound-2");
      expect(s1?.sets).toContain(copy!.id);
      expect(s2?.sets).toContain(copy!.id);
    });

    it("should NOT copy membership for sounds that didn't have the original setId", () => {
      const original = createMockSet({ id: "set-1", name: "Drums" });
      const soundWithSet = createMockSound({ id: "sound-1", sets: ["set-1"] });
      const soundWithout = createMockSound({ id: "sound-2", sets: ["set-other"] });
      useLibraryStore.setState({ sets: [original], sounds: [soundWithSet, soundWithout] });

      const copy = getState().duplicateSet("set-1");

      const s2 = getState().sounds.find((s) => s.id === "sound-2");
      expect(s2?.sets).not.toContain(copy!.id);
      expect(s2?.sets).toEqual(["set-other"]);
    });

    it("should mark isDirty = true", () => {
      const original = createMockSet({ id: "set-1", name: "Drums" });
      useLibraryStore.setState({ sets: [original], isDirty: false });

      getState().duplicateSet("set-1");

      expect(getState().isDirty).toBe(true);
    });
  });

  describe("addSoundsToSet", () => {
    it("should add the setId to each sound's sets array", () => {
      const sound1 = createMockSound({ id: "sound-1", sets: [] });
      const sound2 = createMockSound({ id: "sound-2", sets: [] });
      useLibraryStore.setState({ sounds: [sound1, sound2] });

      getState().addSoundsToSet(["sound-1", "sound-2"], "set-1");

      expect(getState().sounds[0].sets).toEqual(["set-1"]);
      expect(getState().sounds[1].sets).toEqual(["set-1"]);
    });

    it("should be idempotent (calling twice doesn't create duplicates)", () => {
      const sound = createMockSound({ id: "sound-1", sets: [] });
      useLibraryStore.setState({ sounds: [sound] });

      getState().addSoundsToSet(["sound-1"], "set-1");
      getState().addSoundsToSet(["sound-1"], "set-1");

      expect(getState().sounds[0].sets).toEqual(["set-1"]);
    });

    it("should mark isDirty = true", () => {
      const sound = createMockSound({ id: "sound-1", sets: [] });
      useLibraryStore.setState({ sounds: [sound], isDirty: false });

      getState().addSoundsToSet(["sound-1"], "set-1");

      expect(getState().isDirty).toBe(true);
    });
  });

  describe("ensureTagExists", () => {
    it("should create a tag with isSystem: true when requested", () => {
      const tag = getState().ensureTagExists("imported", undefined, true);

      expect(tag.isSystem).toBe(true);
      expect(getState().tags).toHaveLength(1);
      expect(getState().tags[0].isSystem).toBe(true);
    });

    it("should upgrade an existing non-system tag to isSystem: true", () => {
      const existing = createMockTag({ id: "t1", name: "imported" });
      useLibraryStore.setState({ tags: [existing] });

      const tag = getState().ensureTagExists("imported", undefined, true);

      expect(tag.isSystem).toBe(true);
      expect(getState().tags[0].isSystem).toBe(true);
    });

    it("should not downgrade an existing system tag when isSystem is not passed", () => {
      const existing = createMockTag({ id: "t1", name: "imported", isSystem: true });
      useLibraryStore.setState({ tags: [existing] });

      const tag = getState().ensureTagExists("imported");

      expect(tag.isSystem).toBe(true);
      expect(getState().tags[0].isSystem).toBe(true);
    });

    it("should create a non-system tag by default", () => {
      const tag = getState().ensureTagExists("drums");

      expect(tag.isSystem).toBeUndefined();
    });
  });

  describe("removeTagFromSounds", () => {
    it("should silently skip system tags (does not remove them)", () => {
      const systemTag = createMockTag({ id: "sys-t1", name: "imported", isSystem: true });
      const sound = createMockSound({ id: "sound-1", tags: ["sys-t1"] });
      useLibraryStore.setState({ tags: [systemTag], sounds: [sound], isDirty: false });

      getState().removeTagFromSounds(["sound-1"], "sys-t1");

      // Tag should still be on the sound
      expect(getState().sounds[0].tags).toContain("sys-t1");
    });

    it("should remove non-system tags normally", () => {
      const tag = createMockTag({ id: "t1", name: "drums" });
      const sound = createMockSound({ id: "sound-1", tags: ["t1"] });
      useLibraryStore.setState({ tags: [tag], sounds: [sound], isDirty: false });

      getState().removeTagFromSounds(["sound-1"], "t1");

      expect(getState().sounds[0].tags).not.toContain("t1");
    });
  });

  describe("assignTagsToSounds", () => {
    it("should silently skip system tag IDs", () => {
      const systemTag = createMockTag({ id: "sys-t1", name: "imported", isSystem: true });
      const normalTag = createMockTag({ id: "t1", name: "drums" });
      const sound = createMockSound({ id: "sound-1", tags: [] });
      useLibraryStore.setState({ tags: [systemTag, normalTag], sounds: [sound] });

      getState().assignTagsToSounds(["sound-1"], ["sys-t1", "t1"]);

      // Only the non-system tag should be assigned
      expect(getState().sounds[0].tags).toEqual(["t1"]);
    });

    it("should assign non-system tags normally", () => {
      const tag = createMockTag({ id: "t1", name: "drums" });
      const sound = createMockSound({ id: "sound-1", tags: [] });
      useLibraryStore.setState({ tags: [tag], sounds: [sound] });

      getState().assignTagsToSounds(["sound-1"], ["t1"]);

      expect(getState().sounds[0].tags).toEqual(["t1"]);
    });
  });

  describe("systemAssignTagsToSounds", () => {
    it("should assign system tags (bypasses the guard)", () => {
      const systemTag = createMockTag({ id: "sys-t1", name: "imported", isSystem: true });
      const sound = createMockSound({ id: "sound-1", tags: [] });
      useLibraryStore.setState({ tags: [systemTag], sounds: [sound] });

      getState().systemAssignTagsToSounds(["sound-1"], ["sys-t1"]);

      expect(getState().sounds[0].tags).toEqual(["sys-t1"]);
    });
  });

  describe("setMissingState", () => {
    const emptySet = () => new Set<string>();

    it("should update missingSoundIds and missingFolderIds", () => {
      const soundIds = new Set(["s1", "s2"]);
      const folderIds = new Set(["f1"]);

      getState().setMissingState(soundIds, folderIds, emptySet(), emptySet());

      expect(getState().missingSoundIds).toEqual(soundIds);
      expect(getState().missingFolderIds).toEqual(folderIds);
    });

    it("should not mark isDirty", () => {
      useLibraryStore.setState({ isDirty: false });

      getState().setMissingState(new Set(["s1"]), emptySet(), emptySet(), emptySet());

      expect(getState().isDirty).toBe(false);
    });

    it("should replace previous missing state entirely", () => {
      getState().setMissingState(new Set(["s1", "s2"]), new Set(["f1"]), emptySet(), emptySet());
      getState().setMissingState(new Set(["s3"]), emptySet(), emptySet(), emptySet());

      expect(getState().missingSoundIds).toEqual(new Set(["s3"]));
      expect(getState().missingFolderIds.size).toBe(0);
    });

    it("should clear missing state when called with empty sets", () => {
      getState().setMissingState(new Set(["s1"]), new Set(["f1"]), emptySet(), emptySet());
      getState().setMissingState(emptySet(), emptySet(), emptySet(), emptySet());

      expect(getState().missingSoundIds.size).toBe(0);
      expect(getState().missingFolderIds.size).toBe(0);
    });

    it("should store unknownSoundIds and unknownFolderIds", () => {
      const unknownSounds = new Set(["s-unknown"]);
      const unknownFolders = new Set(["f-unknown"]);

      getState().setMissingState(emptySet(), emptySet(), unknownSounds, unknownFolders);

      expect(getState().unknownSoundIds).toEqual(unknownSounds);
      expect(getState().unknownFolderIds).toEqual(unknownFolders);
    });

    it("should replace previous unknown state entirely", () => {
      getState().setMissingState(emptySet(), emptySet(), new Set(["s1"]), new Set(["f1"]));
      getState().setMissingState(emptySet(), emptySet(), new Set(["s2"]), emptySet());

      expect(getState().unknownSoundIds).toEqual(new Set(["s2"]));
      expect(getState().unknownFolderIds.size).toBe(0);
    });

    it("initial state has empty unknown sets", () => {
      expect(getState().unknownSoundIds.size).toBe(0);
      expect(getState().unknownFolderIds.size).toBe(0);
    });
  });

  describe("updateSoundAnalysis", () => {
    it("sets loudnessLufs on an existing sound", () => {
      const sound = createMockSound({ id: "s1" });
      useLibraryStore.setState({ ...initialLibraryState, sounds: [sound] });

      getState().updateSoundAnalysis("s1", { loudnessLufs: -14.5 });

      const updated = getState().sounds.find((s) => s.id === "s1");
      expect(updated?.loudnessLufs).toBe(-14.5);
    });

    it("marks isDirty when updating an existing sound", () => {
      const sound = createMockSound({ id: "s1" });
      useLibraryStore.setState({ ...initialLibraryState, sounds: [sound], isDirty: false });

      getState().updateSoundAnalysis("s1", { loudnessLufs: -18 });

      expect(getState().isDirty).toBe(true);
    });

    it("does not overwrite loudnessLufs when called without that field", () => {
      const sound = createMockSound({ id: "s1", loudnessLufs: -12 });
      useLibraryStore.setState({ ...initialLibraryState, sounds: [sound] });

      getState().updateSoundAnalysis("s1", {});

      expect(getState().sounds[0].loudnessLufs).toBe(-12);
    });

    it("is a no-op for an unknown soundId", () => {
      const sound = createMockSound({ id: "s1" });
      useLibraryStore.setState({ ...initialLibraryState, sounds: [sound], isDirty: false });

      getState().updateSoundAnalysis("nonexistent", { loudnessLufs: -14 });

      expect(getState().isDirty).toBe(false);
      expect(getState().sounds[0].loudnessLufs).toBeUndefined();
    });
  });
});
