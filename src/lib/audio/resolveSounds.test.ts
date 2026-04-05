import { describe, it, expect } from "vitest";
import { filterSoundsByTags } from "./resolveSounds";
import type { Sound } from "@/lib/schemas";

function makeSound(overrides: Partial<Sound> & { id: string }): Sound {
  return {
    name: overrides.id,
    filePath: "/sounds/test.wav",
    tags: [],
    sets: [],
    ...overrides,
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
