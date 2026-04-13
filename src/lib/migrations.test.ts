import { describe, it, expect, vi } from "vitest";
import { migrateProject, CURRENT_VERSION, MigrationError } from "./migrations";

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
    expect(result.version).toBe("1.2.0");
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
    expect(result.version).toBe("1.2.0");
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
});
