import { describe, it, expect, beforeEach } from "vitest";
import { filterSoundsByTags, resolveLayerSounds, _soundByIdCache } from "./resolveSounds";
import { createMockLayer } from "@/test/factories";
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

function makeAssignedLayer(soundIds: string[]) {
  return createMockLayer({
    selection: {
      type: "assigned",
      instances: soundIds.map((id, i) => ({ id: `inst-${i}`, soundId: id, volume: 100 })),
    },
  });
}

function makeTagLayer(tagIds: string[], matchMode: "any" | "all" = "any") {
  return createMockLayer({ selection: { type: "tag", tagIds, matchMode, defaultVolume: 100 } });
}

function makeSetLayer(setId: string) {
  return createMockLayer({ selection: { type: "set", setId, defaultVolume: 100 } });
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

    it("returns duplicate entries when the same soundId appears multiple times", () => {
      // Two instances referencing s1 → both are returned (preserves arrangement order)
      const layer = makeAssignedLayer(["s1", "s1"]);
      expect(resolveLayerSounds(layer, allSounds)).toEqual([s1, s1]);
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

// ---------------------------------------------------------------------------
// Caching behaviour — the soundById Map must NOT be rebuilt on repeated calls
// with the same sounds array reference (WeakMap cache).
// _soundByIdCache is exported for test introspection only.
// ---------------------------------------------------------------------------

describe("resolveLayerSounds — soundById Map caching", () => {
  // Fresh array per test — WeakMap entries from a previous test's array are
  // unreachable (the array goes out of scope) and won't pollute these assertions.
  let sounds: Sound[];

  beforeEach(() => {
    sounds = [
      makeSound({ id: "s1", tags: ["drums"] }),
      makeSound({ id: "s2", tags: ["ambient"] }),
    ];
  });

  it("populates the cache on the first assigned-selection call", () => {
    const layer = makeAssignedLayer(["s1"]);
    resolveLayerSounds(layer, sounds);
    expect(_soundByIdCache.has(sounds)).toBe(true);
  });

  it("reuses the cached Map on repeated calls with the same sounds array reference", () => {
    const layer = makeAssignedLayer(["s1"]);
    resolveLayerSounds(layer, sounds);
    const mapAfterFirst = _soundByIdCache.get(sounds);

    resolveLayerSounds(layer, sounds);
    resolveLayerSounds(layer, sounds);

    // Same Map instance — no rebuild
    expect(_soundByIdCache.get(sounds)).toBe(mapAfterFirst);
  });

  it("builds a new Map when the sounds array reference changes (Immer update)", () => {
    const layer = makeAssignedLayer(["s1"]);
    resolveLayerSounds(layer, sounds);
    const mapAfterFirst = _soundByIdCache.get(sounds);

    // Simulates a library update via Immer — new array reference
    const updatedSounds: Sound[] = [...sounds];
    resolveLayerSounds(layer, updatedSounds);

    expect(_soundByIdCache.has(updatedSounds)).toBe(true);
    // The new array's Map should be a different object
    expect(_soundByIdCache.get(updatedSounds)).not.toBe(mapAfterFirst);
  });

  it("does NOT add a cache entry for tag selection", () => {
    const tagSounds: Sound[] = [makeSound({ id: "t1", tags: ["drums"] })];
    const layer = makeTagLayer(["drums"], "any");
    resolveLayerSounds(layer, tagSounds);
    expect(_soundByIdCache.has(tagSounds)).toBe(false);
  });

  it("does NOT add a cache entry for set selection", () => {
    const setSounds: Sound[] = [makeSound({ id: "st1", sets: ["set-x"] })];
    const layer = makeSetLayer("set-x");
    resolveLayerSounds(layer, setSounds);
    expect(_soundByIdCache.has(setSounds)).toBe(false);
  });

  it("returns correct results after a cache hit (no stale data)", () => {
    // Warm the cache with s1 in the map
    const layer1 = makeAssignedLayer(["s1"]);
    resolveLayerSounds(layer1, sounds);

    // Second call with s2 assigned and same sounds array — must look up from cached Map
    const layer2 = makeAssignedLayer(["s2"]);
    const result = resolveLayerSounds(layer2, sounds);
    expect(result.map((s) => s.id)).toEqual(["s2"]);
  });

  it("populates an empty Map when sounds array is empty", () => {
    const empty: Sound[] = [];
    const layer = makeAssignedLayer([]);
    resolveLayerSounds(layer, empty);
    expect(_soundByIdCache.get(empty)?.size).toBe(0);
  });

  it("maintains independent cache entries for two different sounds array references", () => {
    const soundsA = [makeSound({ id: "a1" })];
    const soundsB = [makeSound({ id: "b1" })];
    const layerA = makeAssignedLayer(["a1"]);
    const layerB = makeAssignedLayer(["b1"]);

    resolveLayerSounds(layerA, soundsA);
    resolveLayerSounds(layerB, soundsB);

    expect(_soundByIdCache.get(soundsA)).not.toBe(_soundByIdCache.get(soundsB));
    expect(_soundByIdCache.get(soundsA)?.has("a1")).toBe(true);
    expect(_soundByIdCache.get(soundsB)?.has("b1")).toBe(true);
  });
});
