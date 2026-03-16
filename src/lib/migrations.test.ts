import { describe, it, expect, vi } from "vitest";
import { migrateProject, CURRENT_VERSION } from "./migrations";

describe("migrateProject", () => {
  it("should pass through a project already at CURRENT_VERSION unchanged", () => {
    const raw = { name: "My Project", version: CURRENT_VERSION };
    const result = migrateProject(raw);
    expect(result).toEqual({ name: "My Project", version: CURRENT_VERSION });
  });

  it("should handle a project with no version field", () => {
    const raw = { name: "Old Project" };
    const result = migrateProject(raw);
    expect(result.name).toBe("Old Project");
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
    expect(result.version).toBe("1.1.0");
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

describe("migrateProject — version warnings", () => {
  it("should warn when final version does not match CURRENT_VERSION", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = migrateProject({ name: "Future Project", version: "99.0.0" });
    expect(result.version).toBe("99.0.0");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("99.0.0"));
    warnSpy.mockRestore();
  });

  it("should not warn when version matches CURRENT_VERSION", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    migrateProject({ name: "Current Project", version: CURRENT_VERSION });
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("should warn when version is absent (defaults to 0.0.0)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    migrateProject({ name: "Old Project" });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("0.0.0"));
    warnSpy.mockRestore();
  });
});
