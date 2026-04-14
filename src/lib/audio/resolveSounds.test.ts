import { describe, it, expect } from "vitest";
import { filterSoundsByTags, resolveLayerSounds } from "./resolveSounds";
import type { Sound, Layer } from "@/lib/schemas";

function makeSound(overrides: Partial<Sound> & { id: string }): Sound {
  return {
    name: overrides.id,
    filePath: "/sounds/test.wav",
    tags: [],
    sets: [],
    ...overrides,
  };
}

function makeAssignedLayer(soundIds: string[]): Layer {
  return {
    id: "layer-1",
    name: "Layer 1",
    volume: 100,
    selection: {
      type: "assigned",
      instances: soundIds.map((id, i) => ({ id: `inst-${i}`, soundId: id, volume: 100 })),
    },
    arrangement: "simultaneous",
    playbackMode: "one-shot",
    retriggerMode: "restart",
    cycleMode: false,
    fadeDurationMs: null,
  };
}

function makeTagLayer(tagIds: string[], matchMode: "any" | "all" = "any"): Layer {
  return {
    id: "layer-tag",
    name: "Tag Layer",
    volume: 100,
    selection: { type: "tag", tagIds, matchMode },
    arrangement: "simultaneous",
    playbackMode: "one-shot",
    retriggerMode: "restart",
    cycleMode: false,
    fadeDurationMs: null,
  };
}

function makeSetLayer(setId: string): Layer {
  return {
    id: "layer-set",
    name: "Set Layer",
    volume: 100,
    selection: { type: "set", setId },
    arrangement: "simultaneous",
    playbackMode: "one-shot",
    retriggerMode: "restart",
    cycleMode: false,
    fadeDurationMs: null,
  };
}

describe("filterSoundsByTags", () => {
  const sounds: Sound[] = [
    makeSound({ id: "s1", tags: ["drums", "electronic"] }),
    makeSound({ id: "s2", tags: ["drums", "acoustic"] }),
    makeSound({ id: "s3", tags: ["electronic", "ambient"] }),
    makeSound({ id: "s4", tags: ["vocal"] }),
    makeSound({ id: "s5", tags: ["drums"], filePath: undefined }),
  ];

  describe('matchMode "any" (OR)', () => {
    it("returns sounds matching any of the specified tags", () => {
      const result = filterSoundsByTags(sounds, ["electronic"], "any");
      expect(result.map((s) => s.id)).toEqual(["s1", "s3"]);
    });

    it("returns sounds matching either tag", () => {
      const result = filterSoundsByTags(sounds, ["vocal", "ambient"], "any");
      expect(result.map((s) => s.id)).toEqual(["s3", "s4"]);
    });

    it("returns empty array when tagIds is empty", () => {
      const result = filterSoundsByTags(sounds, [], "any");
      expect(result).toEqual([]);
    });

    it("excludes sounds without filePath", () => {
      const result = filterSoundsByTags(sounds, ["drums"], "any");
      expect(result.map((s) => s.id)).toEqual(["s1", "s2"]);
      expect(result.find((s) => s.id === "s5")).toBeUndefined();
    });
  });

  describe('matchMode "all" (AND)', () => {
    it("returns only sounds matching all specified tags", () => {
      const result = filterSoundsByTags(sounds, ["drums", "electronic"], "all");
      expect(result.map((s) => s.id)).toEqual(["s1"]);
    });

    it("returns sounds that have the single specified tag", () => {
      const result = filterSoundsByTags(sounds, ["drums"], "all");
      expect(result.map((s) => s.id)).toEqual(["s1", "s2"]);
    });

    it("returns empty array when tagIds is empty", () => {
      const result = filterSoundsByTags(sounds, [], "all");
      expect(result).toEqual([]);
    });

    it("returns empty array when no sounds match all tags", () => {
      const result = filterSoundsByTags(sounds, ["drums", "vocal"], "all");
      expect(result).toEqual([]);
    });

    it("excludes sounds without filePath", () => {
      // s5 has "drums" tag but no filePath
      const result = filterSoundsByTags(sounds, ["drums"], "all");
      expect(result.find((s) => s.id === "s5")).toBeUndefined();
    });
  });
});

describe("resolveLayerSounds", () => {
  const s1 = makeSound({ id: "s1", tags: ["drums"], sets: ["set-a"] });
  const s2 = makeSound({ id: "s2", tags: ["drums", "electronic"], sets: ["set-b"] });
  const s3 = makeSound({ id: "s3", tags: ["ambient"], sets: ["set-a"] });
  const s4 = makeSound({ id: "s4", filePath: undefined, tags: ["drums"], sets: ["set-a"] }); // no filePath

  const allSounds = [s1, s2, s3, s4];

  describe("assigned selection", () => {
    it("returns sounds matching the assigned instance soundIds", () => {
      const layer = makeAssignedLayer(["s1", "s3"]);
      expect(resolveLayerSounds(layer, allSounds)).toEqual([s1, s3]);
    });

    it("skips instances whose soundId is not in library", () => {
      const layer = makeAssignedLayer(["s1", "missing-id"]);
      expect(resolveLayerSounds(layer, allSounds)).toEqual([s1]);
    });

    it("includes sounds without filePath (does NOT filter by filePath)", () => {
      const layer = makeAssignedLayer(["s4"]);
      const result = resolveLayerSounds(layer, allSounds);
      expect(result).toEqual([s4]);
    });

    it("returns empty array when instances list is empty", () => {
      const layer = makeAssignedLayer([]);
      expect(resolveLayerSounds(layer, allSounds)).toEqual([]);
    });
  });

  describe("tag selection", () => {
    it("returns sounds with any matching tag (matchMode=any)", () => {
      const layer = makeTagLayer(["drums"], "any");
      // s1, s2, s4 all have 'drums' — including s4 which has no filePath
      expect(resolveLayerSounds(layer, allSounds).map((s) => s.id)).toEqual(["s1", "s2", "s4"]);
    });

    it("returns sounds matching all tags (matchMode=all)", () => {
      const layer = makeTagLayer(["drums", "electronic"], "all");
      expect(resolveLayerSounds(layer, allSounds).map((s) => s.id)).toEqual(["s2"]);
    });

    it("returns empty array when tagIds is empty", () => {
      const layer = makeTagLayer([], "any");
      expect(resolveLayerSounds(layer, allSounds)).toEqual([]);
    });

    it("does NOT filter by filePath — includes sounds without filePath", () => {
      const layer = makeTagLayer(["drums"], "any");
      const result = resolveLayerSounds(layer, allSounds);
      expect(result.find((s) => s.id === "s4")).toBeDefined();
    });
  });

  describe("set selection", () => {
    it("returns sounds belonging to the specified set", () => {
      const layer = makeSetLayer("set-a");
      // s1, s3, s4 are in set-a
      expect(resolveLayerSounds(layer, allSounds).map((s) => s.id)).toEqual(["s1", "s3", "s4"]);
    });

    it("returns empty array when no sounds belong to the set", () => {
      const layer = makeSetLayer("set-nonexistent");
      expect(resolveLayerSounds(layer, allSounds)).toEqual([]);
    });

    it("does NOT filter by filePath — includes sounds without filePath", () => {
      const layer = makeSetLayer("set-a");
      const result = resolveLayerSounds(layer, allSounds);
      expect(result.find((s) => s.id === "s4")).toBeDefined();
    });
  });
});
