import { describe, it, expect, vi } from "vitest";
import { migrateProject, migrateLibrary, CURRENT_VERSION, MigrationError } from "./migrations";
import { CURRENT_LIBRARY_VERSION, CURRENT_PROJECT_VERSION, DEFAULT_PROJECT_VERSION } from "./constants";

describe("version constant sync", () => {
  it("CURRENT_VERSION (migrations) equals CURRENT_PROJECT_VERSION (constants) — single source of truth", () => {
    expect(CURRENT_VERSION).toBe(CURRENT_PROJECT_VERSION);
  });

  it("DEFAULT_PROJECT_VERSION is an alias for CURRENT_PROJECT_VERSION", () => {
    expect(DEFAULT_PROJECT_VERSION).toBe(CURRENT_PROJECT_VERSION);
  });
});

describe("migrateProject", () => {
  it("should pass through a project already at CURRENT_VERSION unchanged", () => {
    const raw = { name: "My Project", version: CURRENT_VERSION };
    const result = migrateProject(raw);
    expect(result).toEqual({ name: "My Project", version: CURRENT_VERSION });
  });

  it("should migrate a project with no version field (0.0.0 seed) to CURRENT_VERSION", () => {
    const raw = { name: "Old Project" };
    const result = migrateProject(raw);
    expect(result.name).toBe("Old Project");
    expect(result.version).toBe(CURRENT_VERSION);
  });

  it("should not mutate the original object", () => {
    const raw = { name: "My Project", version: "1.0.0" };
    const original = { ...raw };
    migrateProject(raw);
    expect(raw).toEqual(original);
  });
});

describe("migrateProject — 1.0.0 → 1.1.0", () => {
  it("should strip sounds, tags, sets and add favoritedSetIds", () => {
    const raw = {
      name: "My Project",
      version: "1.0.0",
      scenes: [],
      sounds: [],
      tags: [],
      sets: [],
    };
    const result = migrateProject(raw);
    expect(result.version).toBe("1.4.0");
    expect(result.favoritedSetIds).toEqual([]);
    expect(result.sounds).toBeUndefined();
    expect(result.tags).toBeUndefined();
    expect(result.sets).toBeUndefined();
  });

  it("should preserve scenes and other fields during migration", () => {
    const raw = {
      name: "My Project",
      version: "1.0.0",
      description: "A project",
      scenes: [{ id: "s1", name: "Scene 1", pads: [] }],
      sounds: [],
      tags: [],
      sets: [],
    };
    const result = migrateProject(raw);
    expect(result.name).toBe("My Project");
    expect(result.description).toBe("A project");
    expect(result.scenes).toEqual([{ id: "s1", name: "Scene 1", pads: [] }]);
  });

  it("should warn when stripping non-empty sounds/tags/sets", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const raw = {
      name: "My Project",
      version: "1.0.0",
      sounds: [{ id: "s1", name: "Kick" }],
      tags: [],
      sets: [],
    };
    migrateProject(raw);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("1 sound"));
    warnSpy.mockRestore();
  });

  it("should not warn when sounds/tags/sets are empty arrays", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    migrateProject({ name: "My Project", version: "1.0.0", sounds: [], tags: [], sets: [] });
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("should not warn when sounds/tags/sets are absent", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    migrateProject({ name: "My Project", version: "1.0.0" });
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("migrateProject — 1.1.0 → 1.2.0", () => {
  it("converts tag selection tagId to tagIds array", () => {
    const raw = {
      name: "My Project",
      version: "1.1.0",
      scenes: [{
        id: "scene-1",
        name: "Scene 1",
        pads: [{
          id: "pad-1",
          name: "Kick",
          layers: [{
            id: "layer-1",
            selection: { type: "tag", tagId: "tag-abc", defaultVolume: 100 },
            arrangement: "simultaneous",
            playbackMode: "one-shot",
            retriggerMode: "restart",
            volume: 100,
          }],
          muteTargetPadIds: [],
        }],
      }],
    };
    const result = migrateProject(raw);
    expect(result.version).toBe("1.4.0");
    const layer = (result.scenes as Array<Record<string, unknown>>)[0];
    const pad = (layer.pads as Array<Record<string, unknown>>)[0];
    const sel = ((pad.layers as Array<Record<string, unknown>>)[0]).selection as Record<string, unknown>;
    expect(sel.tagIds).toEqual(["tag-abc"]);
    expect(sel.tagId).toBeUndefined();
  });

  it("converts empty tagId to empty tagIds array", () => {
    const raw = {
      name: "My Project",
      version: "1.1.0",
      scenes: [{
        id: "scene-1",
        name: "Scene 1",
        pads: [{
          id: "pad-1",
          name: "Pad",
          layers: [{
            id: "layer-1",
            selection: { type: "tag", tagId: "", defaultVolume: 100 },
            arrangement: "simultaneous",
            playbackMode: "one-shot",
            retriggerMode: "restart",
            volume: 100,
          }],
          muteTargetPadIds: [],
        }],
      }],
    };
    const result = migrateProject(raw);
    const layer = (result.scenes as Array<Record<string, unknown>>)[0];
    const pad = (layer.pads as Array<Record<string, unknown>>)[0];
    const sel = ((pad.layers as Array<Record<string, unknown>>)[0]).selection as Record<string, unknown>;
    expect(sel.tagIds).toEqual([]);
  });

  it("leaves non-tag selections untouched", () => {
    const raw = {
      name: "My Project",
      version: "1.1.0",
      scenes: [{
        id: "scene-1",
        name: "Scene 1",
        pads: [{
          id: "pad-1",
          name: "Pad",
          layers: [{
            id: "layer-1",
            selection: { type: "assigned", instances: [] },
            arrangement: "simultaneous",
            playbackMode: "one-shot",
            retriggerMode: "restart",
            volume: 100,
          }],
          muteTargetPadIds: [],
        }],
      }],
    };
    const result = migrateProject(raw);
    const layer = (result.scenes as Array<Record<string, unknown>>)[0];
    const pad = (layer.pads as Array<Record<string, unknown>>)[0];
    const sel = ((pad.layers as Array<Record<string, unknown>>)[0]).selection as Record<string, unknown>;
    expect(sel.type).toBe("assigned");
    expect(sel.tagIds).toBeUndefined();
  });
});

describe("migrateProject — 1.1.0 → 1.2.0 malformed-input guards", () => {
  it("skips non-object entries in scenes array without crashing", () => {
    const raw = {
      name: "X",
      version: "1.1.0",
      // null, number, string, array, and valid object mixed together
      scenes: [null, 42, "bad", [1, 2, 3], { id: "s1", pads: [] }],
    };
    const result = migrateProject(raw);
    const scenes = result.scenes as unknown[];
    // All 5 entries preserved; primitives/arrays pass through unchanged
    expect(scenes).toHaveLength(5);
    expect(scenes[0]).toBeNull();
    expect(scenes[1]).toBe(42);
    expect(scenes[2]).toBe("bad");
    expect(Array.isArray(scenes[3])).toBe(true);
    expect((scenes[4] as Record<string, unknown>).id).toBe("s1");
  });

  it("skips non-object entries in pads array without crashing", () => {
    const raw = {
      name: "X",
      version: "1.1.0",
      scenes: [{
        id: "s1",
        pads: [null, 42, "bad", [1, 2], { id: "p1", layers: [] }],
      }],
    };
    const result = migrateProject(raw);
    const scenes = result.scenes as Array<Record<string, unknown>>;
    const pads = scenes[0].pads as unknown[];
    expect(pads).toHaveLength(5);
    expect(pads[0]).toBeNull();
    expect((pads[4] as Record<string, unknown>).id).toBe("p1");
  });

  it("skips non-object entries in layers array without crashing", () => {
    const raw = {
      name: "X",
      version: "1.1.0",
      scenes: [{
        id: "s1",
        pads: [{
          id: "p1",
          layers: [null, 42, "bad", [1, 2], { id: "l1", selection: { type: "tag", tagId: "t1" } }],
        }],
      }],
    };
    const result = migrateProject(raw);
    const scenes = result.scenes as Array<Record<string, unknown>>;
    const pads = scenes[0].pads as Array<Record<string, unknown>>;
    const layers = pads[0].layers as unknown[];
    // Primitives pass through; valid layer is migrated
    expect(layers).toHaveLength(5);
    expect(layers[0]).toBeNull();
    const validLayer = layers[4] as Record<string, unknown>;
    const sel = validLayer.selection as Record<string, unknown>;
    expect(sel.tagIds).toEqual(["t1"]);
    expect(sel.tagId).toBeUndefined();
  });

  it("leaves layer untouched when selection is null", () => {
    const raw = {
      name: "X",
      version: "1.1.0",
      scenes: [{
        id: "s1",
        pads: [{
          id: "p1",
          layers: [{ id: "l1", selection: null }],
        }],
      }],
    };
    const result = migrateProject(raw);
    const scenes = result.scenes as Array<Record<string, unknown>>;
    const layers = (scenes[0].pads as Array<Record<string, unknown>>)[0].layers as Array<Record<string, unknown>>;
    // selection: null must not be modified
    expect(layers[0].selection).toBeNull();
  });

  it("leaves layer untouched when selection.tagId is a non-string type", () => {
    const raw = {
      name: "X",
      version: "1.1.0",
      scenes: [{
        id: "s1",
        pads: [{
          id: "p1",
          layers: [{ id: "l1", selection: { type: "tag", tagId: 42 } }],
        }],
      }],
    };
    // tagId is not a string and tagIds is not an array → migration should leave it alone
    const result = migrateProject(raw);
    const scenes = result.scenes as Array<Record<string, unknown>>;
    const pads = (scenes[0].pads as Array<Record<string, unknown>>);
    const layers = (pads[0].layers as Array<Record<string, unknown>>);
    const sel = layers[0].selection as Record<string, unknown>;
    // Should not have been converted (tagId non-string, tagIds absent → no-op)
    expect(sel.tagId).toBe(42);
    expect(sel.tagIds).toBeUndefined();
  });
});

describe("migrateProject — 1.3.0 → 1.4.0 (pad volume scale 0–1 → 0–100)", () => {
  function makePadProject(pad: Record<string, unknown>): Record<string, unknown> {
    return {
      name: "P",
      version: "1.3.0",
      scenes: [{ id: "s1", name: "Scene", pads: [{ id: "p1", name: "Pad", layers: [], muteTargetPadIds: [], ...pad }] }],
    };
  }

  function getPad(result: Record<string, unknown>): Record<string, unknown> {
    const scenes = result.scenes as Array<Record<string, unknown>>;
    const pads = scenes[0].pads as Array<Record<string, unknown>>;
    return pads[0];
  }

  it("rescales pad.volume 0.5 → 50", () => {
    const result = migrateProject(makePadProject({ volume: 0.5 }));
    expect(getPad(result).volume).toBe(50);
  });

  it("rescales pad.volume 1 → 100", () => {
    const result = migrateProject(makePadProject({ volume: 1 }));
    expect(getPad(result).volume).toBe(100);
  });

  it("rescales pad.volume 0 → 0", () => {
    const result = migrateProject(makePadProject({ volume: 0 }));
    expect(getPad(result).volume).toBe(0);
  });

  it("leaves pad.volume undefined when absent", () => {
    const result = migrateProject(makePadProject({}));
    expect(getPad(result).volume).toBeUndefined();
  });

  it("rescales pad.fadeTargetVol 0.2 → 20", () => {
    const result = migrateProject(makePadProject({ fadeTargetVol: 0.2 }));
    expect(getPad(result).fadeTargetVol).toBe(20);
  });

  it("leaves pad.fadeTargetVol undefined when absent", () => {
    const result = migrateProject(makePadProject({}));
    expect(getPad(result).fadeTargetVol).toBeUndefined();
  });

  it("bumps version to 1.4.0", () => {
    const result = migrateProject(makePadProject({ volume: 0.5 }));
    expect(result.version).toBe("1.4.0");
  });
});

describe("migrateProject — future-version guard", () => {
  it("throws MigrationError when project version is newer than CURRENT_VERSION", () => {
    expect(() => migrateProject({ name: "Future Project", version: "99.0.0" })).toThrow(MigrationError);
    expect(() => migrateProject({ name: "Future Project", version: "99.0.0" })).toThrow(
      /newer version/i,
    );
  });

  it("throws MigrationError with version number in the message", () => {
    expect(() => migrateProject({ name: "Future Project", version: "2.0.0" })).toThrow("2.0.0");
  });

  it("throws MigrationError for one patch ahead of CURRENT_VERSION", () => {
    const [maj, min, pat] = CURRENT_VERSION.split(".").map(Number);
    const oneAhead = `${maj}.${min}.${pat + 1}`;
    expect(() => migrateProject({ name: "X", version: oneAhead })).toThrow(MigrationError);
  });

  it("does not throw for a project at CURRENT_VERSION", () => {
    expect(() => migrateProject({ name: "Current Project", version: CURRENT_VERSION })).not.toThrow();
  });

  it("does not throw for a project at a previous known version", () => {
    expect(() => migrateProject({ name: "Old Project", version: "1.0.0" })).not.toThrow();
  });

  it("does not throw for a project with no version field (uses 0.0.0 seed)", () => {
    expect(() => migrateProject({ name: "Old Project" })).not.toThrow();
  });

  it("migrates a project with explicit version '0.0.0' to CURRENT_VERSION", () => {
    const result = migrateProject({ name: "X", version: "0.0.0" });
    expect(result.version).toBe(CURRENT_VERSION);
  });

  it("throws MigrationError for a version not in the migration chain (unknown past version)", () => {
    expect(() => migrateProject({ name: "X", version: "1.0.5" })).toThrow(MigrationError);
    expect(() => migrateProject({ name: "X", version: "0.5.0" })).toThrow(MigrationError);
  });

  it("throws MigrationError for malformed version strings", () => {
    expect(() => migrateProject({ name: "X", version: "1.2" })).toThrow(MigrationError);
    expect(() => migrateProject({ name: "X", version: "v1.0.0" })).toThrow(MigrationError);
    expect(() => migrateProject({ name: "X", version: "1.2.0-beta" })).toThrow(MigrationError);
    expect(() => migrateProject({ name: "X", version: "" })).toThrow(MigrationError);
  });

  it("treats non-string version fields as missing and applies seed migration (numeric version)", () => {
    // A numeric version in disk data must not cause compareVersions() to crash
    // on Number.prototype.split — it should fall back to UNVERSIONED_DEFAULT.
    const result = migrateProject({ name: "X", version: 1 });
    expect(result.version).toBe(CURRENT_VERSION);
  });

  it("treats non-string version fields as missing and applies seed migration (object version)", () => {
    const result = migrateProject({ name: "X", version: { major: 1 } });
    expect(result.version).toBe(CURRENT_VERSION);
  });

  it("treats non-string version fields as missing and applies seed migration (null version)", () => {
    const result = migrateProject({ name: "X", version: null });
    expect(result.version).toBe(CURRENT_VERSION);
  });

  it("treats non-string version fields as missing and applies seed migration (array version)", () => {
    const result = migrateProject({ name: "X", version: [1, 0, 0] });
    expect(result.version).toBe(CURRENT_VERSION);
  });

  it("treats NaN version as missing (does not hit future-version guard)", () => {
    const result = migrateProject({ name: "X", version: NaN });
    expect(result.version).toBe(CURRENT_VERSION);
  });

  it("treats boolean version as missing (does not hit future-version guard)", () => {
    const result = migrateProject({ name: "X", version: true });
    expect(result.version).toBe(CURRENT_VERSION);
  });
});

describe("migrateLibrary", () => {
  it("should pass through a library already at CURRENT_LIBRARY_VERSION unchanged", () => {
    const raw = {
      version: CURRENT_LIBRARY_VERSION,
      sounds: [{ id: "s1", name: "Kick" }],
      tags: [],
      sets: [],
    };
    const result = migrateLibrary(raw);
    expect(result).toEqual({
      version: CURRENT_LIBRARY_VERSION,
      sounds: [{ id: "s1", name: "Kick" }],
      tags: [],
      sets: [],
    });
  });

  it("should migrate an unversioned library (0.0.0 seed) to CURRENT_LIBRARY_VERSION", () => {
    const raw = { sounds: [], tags: [], sets: [] };
    const result = migrateLibrary(raw);
    expect(result.version).toBe(CURRENT_LIBRARY_VERSION);
  });

  it("should not mutate the original object", () => {
    const raw = {
      version: "0.0.0",
      sounds: [{ id: "s1", name: "Kick" }],
      tags: [],
      sets: [],
    };
    const original = structuredClone(raw);
    migrateLibrary(raw);
    expect(raw).toEqual(original);
  });

  it("does not mutate sound objects when stripping invalid fields", () => {
    const sound = { id: "s1", name: "Bad", durationMs: -5, fileSizeBytes: Infinity };
    const raw = { version: "0.0.0", sounds: [sound, sound], tags: [], sets: [] };
    const soundBefore = { ...sound };
    migrateLibrary(raw);
    expect(sound).toEqual(soundBefore);
  });

  it("deduplicates sound IDs, keeping the first occurrence", () => {
    const raw = {
      version: "0.0.0",
      sounds: [
        { id: "s1", name: "First" },
        { id: "s1", name: "Duplicate" },
        { id: "s2", name: "Second" },
      ],
      tags: [],
      sets: [],
    };
    const result = migrateLibrary(raw);
    const sounds = result.sounds as Array<Record<string, unknown>>;
    expect(sounds).toHaveLength(2);
    expect(sounds[0]).toMatchObject({ id: "s1", name: "First" });
    expect(sounds[1]).toMatchObject({ id: "s2", name: "Second" });
  });

  it("deduplicates tag IDs, keeping the first occurrence", () => {
    const raw = {
      version: "0.0.0",
      sounds: [],
      tags: [
        { id: "t1", name: "first-tag" },
        { id: "t1", name: "duplicate-tag" },
        { id: "t2", name: "second-tag" },
      ],
      sets: [],
    };
    const result = migrateLibrary(raw);
    const tags = result.tags as Array<Record<string, unknown>>;
    expect(tags).toHaveLength(2);
    expect(tags[0]).toMatchObject({ id: "t1", name: "first-tag" });
    expect(tags[1]).toMatchObject({ id: "t2", name: "second-tag" });
  });

  it("deduplicates set IDs, keeping the first occurrence", () => {
    const raw = {
      version: "0.0.0",
      sounds: [],
      tags: [],
      sets: [
        { id: "set1", name: "First Set" },
        { id: "set1", name: "Duplicate Set" },
        { id: "set2", name: "Second Set" },
      ],
    };
    const result = migrateLibrary(raw);
    const sets = result.sets as Array<Record<string, unknown>>;
    expect(sets).toHaveLength(2);
    expect(sets[0]).toMatchObject({ id: "set1", name: "First Set" });
    expect(sets[1]).toMatchObject({ id: "set2", name: "Second Set" });
  });

  it("strips negative durationMs from sounds", () => {
    const raw = {
      version: "0.0.0",
      sounds: [{ id: "s1", name: "Kick", durationMs: -5 }],
      tags: [],
      sets: [],
    };
    const result = migrateLibrary(raw);
    const sounds = result.sounds as Array<Record<string, unknown>>;
    expect(sounds[0].durationMs).toBeUndefined();
    expect(sounds[0].id).toBe("s1");
  });

  it("strips non-finite durationMs from sounds", () => {
    const raw = {
      version: "0.0.0",
      sounds: [
        { id: "s1", name: "A", durationMs: Infinity },
        { id: "s2", name: "B", durationMs: -Infinity },
        { id: "s3", name: "C", durationMs: NaN },
      ],
      tags: [],
      sets: [],
    };
    const result = migrateLibrary(raw);
    const sounds = result.sounds as Array<Record<string, unknown>>;
    expect(sounds[0].durationMs).toBeUndefined();
    expect(sounds[1].durationMs).toBeUndefined();
    expect(sounds[2].durationMs).toBeUndefined();
  });

  it("leaves valid durationMs untouched", () => {
    const raw = {
      version: "0.0.0",
      sounds: [
        { id: "s1", name: "A", durationMs: 1000 },
        { id: "s2", name: "B", durationMs: 0 },
      ],
      tags: [],
      sets: [],
    };
    const result = migrateLibrary(raw);
    const sounds = result.sounds as Array<Record<string, unknown>>;
    expect(sounds[0].durationMs).toBe(1000);
    expect(sounds[1].durationMs).toBe(0);
  });

  it("strips invalid fileSizeBytes from sounds", () => {
    const raw = {
      version: "0.0.0",
      sounds: [
        { id: "s1", name: "A", fileSizeBytes: -1 },
        { id: "s2", name: "B", fileSizeBytes: Infinity },
        { id: "s3", name: "C", fileSizeBytes: 2048 },
      ],
      tags: [],
      sets: [],
    };
    const result = migrateLibrary(raw);
    const sounds = result.sounds as Array<Record<string, unknown>>;
    expect(sounds[0].fileSizeBytes).toBeUndefined();
    expect(sounds[1].fileSizeBytes).toBeUndefined();
    expect(sounds[2].fileSizeBytes).toBe(2048);
  });

  it("handles missing sounds/tags/sets arrays gracefully", () => {
    const raw = { version: "0.0.0" };
    const result = migrateLibrary(raw);
    expect(result.version).toBe(CURRENT_LIBRARY_VERSION);
    expect(result.sounds).toBeUndefined();
    expect(result.tags).toBeUndefined();
    expect(result.sets).toBeUndefined();
  });

  it("handles non-array sounds/tags/sets fields without crashing", () => {
    const raw = {
      version: "0.0.0",
      sounds: "not-an-array",
      tags: null,
      sets: 42,
    };
    const result = migrateLibrary(raw);
    expect(result.version).toBe(CURRENT_LIBRARY_VERSION);
    // Non-array values are left alone; Zod will reject them downstream.
    expect(result.sounds).toBe("not-an-array");
    expect(result.tags).toBeNull();
    expect(result.sets).toBe(42);
  });

  it("drops tags with missing name field", () => {
    const raw = {
      version: "0.0.0",
      sounds: [],
      tags: [
        { id: "t1" },             // no name field at all
        { id: "t2", name: "ok" },
      ],
      sets: [],
    };
    const result = migrateLibrary(raw);
    const tags = result.tags as Array<Record<string, unknown>>;
    expect(tags).toHaveLength(1);
    expect(tags[0].id).toBe("t2");
  });

  it("drops tags with empty name and truncates names over 100 chars", () => {
    const longName = "a".repeat(150);
    const raw = {
      version: "0.0.0",
      sounds: [],
      tags: [
        { id: "t1", name: "" },
        { id: "t2", name: "   " },
        { id: "t3", name: 42 },
        { id: "t4", name: longName },
        { id: "t5", name: "ok" },
      ],
      sets: [],
    };
    const result = migrateLibrary(raw);
    const tags = result.tags as Array<Record<string, unknown>>;
    expect(tags).toHaveLength(2);
    expect(tags[0].id).toBe("t4");
    expect((tags[0].name as string).length).toBe(100);
    expect(tags[1]).toMatchObject({ id: "t5", name: "ok" });
  });

  it("skips non-object entries in sounds array without crashing", () => {
    const raw = {
      version: "0.0.0",
      sounds: [
        null,
        42,
        "bad",
        { id: "s1", name: "Kick", durationMs: -1 },
      ],
    };
    expect(() => migrateLibrary(raw)).not.toThrow();
    const result = migrateLibrary(raw);
    const sounds = result.sounds as unknown[];
    // Primitives pass through; the valid sound has its invalid durationMs stripped
    expect(sounds).toHaveLength(4);
    const validSound = sounds[3] as Record<string, unknown>;
    expect(validSound.durationMs).toBeUndefined();
  });

  it("skips non-object entries in tags array without crashing", () => {
    const raw = {
      version: "0.0.0",
      tags: [null, 42, "bad", { id: "t1", name: "valid" }],
    };
    expect(() => migrateLibrary(raw)).not.toThrow();
    const result = migrateLibrary(raw);
    const tags = result.tags as unknown[];
    // Non-objects pass the filter (they lack a name field check that would catch them)
    // but the valid tag is kept
    expect((tags as Array<Record<string, unknown>>).some((t) => t?.id === "t1")).toBe(true);
  });

  it("skips non-object entries in sets array without crashing", () => {
    const raw = {
      version: "0.0.0",
      sets: [null, 42, "bad", { id: "set1", name: "FX" }],
    };
    expect(() => migrateLibrary(raw)).not.toThrow();
    const result = migrateLibrary(raw);
    const sets = result.sets as unknown[];
    expect(sets).toHaveLength(4);
  });

  it("throws MigrationError when library version is newer than CURRENT_LIBRARY_VERSION", () => {
    expect(() => migrateLibrary({ version: "99.0.0" })).toThrow(MigrationError);
    expect(() => migrateLibrary({ version: "99.0.0" })).toThrow(/newer version/i);
    expect(() => migrateLibrary({ version: "99.0.0" })).toThrow("99.0.0");
  });

  it("throws MigrationError for a version not in the migration chain (unknown past version)", () => {
    expect(() => migrateLibrary({ version: "0.5.0" })).toThrow(MigrationError);
    expect(() => migrateLibrary({ version: "0.5.0" })).toThrow(/No migration path/i);
  });

  it("throws MigrationError for malformed version strings", () => {
    expect(() => migrateLibrary({ version: "not.a.version" })).toThrow(MigrationError);
    expect(() => migrateLibrary({ version: "1.2" })).toThrow(MigrationError);
    expect(() => migrateLibrary({ version: "v1.0.0" })).toThrow(MigrationError);
    expect(() => migrateLibrary({ version: "" })).toThrow(MigrationError);
  });

  it("treats non-string version fields as missing and applies seed migration (numeric version)", () => {
    // A numeric version in disk data must not cause compareVersions() to crash
    // on Number.prototype.split — it should fall back to UNVERSIONED_DEFAULT.
    const result = migrateLibrary({ version: 1 });
    expect(result.version).toBe(CURRENT_LIBRARY_VERSION);
  });

  it("treats non-string version fields as missing and applies seed migration (object version)", () => {
    const result = migrateLibrary({ version: { major: 1 } });
    expect(result.version).toBe(CURRENT_LIBRARY_VERSION);
  });

  it("treats non-string version fields as missing and applies seed migration (null version)", () => {
    const result = migrateLibrary({ version: null });
    expect(result.version).toBe(CURRENT_LIBRARY_VERSION);
  });

  it("treats non-string version fields as missing and applies seed migration (array version)", () => {
    const result = migrateLibrary({ version: [1, 0, 0] });
    expect(result.version).toBe(CURRENT_LIBRARY_VERSION);
  });

  it("treats NaN version as missing (does not hit future-version guard)", () => {
    const result = migrateLibrary({ version: NaN });
    expect(result.version).toBe(CURRENT_LIBRARY_VERSION);
  });

  it("treats boolean version as missing (does not hit future-version guard)", () => {
    const result = migrateLibrary({ version: true });
    expect(result.version).toBe(CURRENT_LIBRARY_VERSION);
  });
});
