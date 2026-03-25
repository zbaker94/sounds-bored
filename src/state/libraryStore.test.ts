import { describe, it, expect, beforeEach } from "vitest";
import { useLibraryStore, initialLibraryState } from "./libraryStore";
import { createMockGlobalLibrary, createMockSound, createMockSet } from "@/test/factories";

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
});
