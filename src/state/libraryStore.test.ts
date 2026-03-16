import { describe, it, expect, beforeEach } from "vitest";
import { useLibraryStore, initialLibraryState } from "./libraryStore";
import { createMockGlobalLibrary } from "@/test/factories";
import { Sound, Tag, Set } from "@/lib/schemas";

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
});
