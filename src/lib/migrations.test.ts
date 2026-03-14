import { describe, it, expect, vi } from "vitest";
import { migrateProject, CURRENT_VERSION } from "./migrations";

describe("migrateProject", () => {
  it("should return an unchanged object when no migrations are registered", () => {
    const raw = { name: "My Project", version: "1.0.0" };
    const result = migrateProject(raw);
    expect(result).toEqual({ name: "My Project", version: "1.0.0" });
  });

  it("should handle a project with no version field", () => {
    const raw = { name: "Old Project" };
    const result = migrateProject(raw);
    // No migrations to run for "0.0.0", so the object is returned as-is
    expect(result.name).toBe("Old Project");
  });

  it("should handle a project already at CURRENT_VERSION", () => {
    const raw = { name: "Current Project", version: CURRENT_VERSION };
    const result = migrateProject(raw);
    expect(result).toEqual(raw);
  });

  it("should not mutate the original object", () => {
    const raw = { name: "My Project", version: "1.0.0" };
    const original = { ...raw };
    migrateProject(raw);
    expect(raw).toEqual(original);
  });
});

describe("migrateProject — version warnings", () => {
  it("should warn when final version does not match CURRENT_VERSION", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = migrateProject({ name: "Future Project", version: "99.0.0" });

    expect(result.version).toBe("99.0.0");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("99.0.0")
    );

    warnSpy.mockRestore();
  });

  it("should not warn when version matches CURRENT_VERSION", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    migrateProject({ name: "Current Project", version: CURRENT_VERSION });

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("should warn when version is absent (defaults to 0.0.0 which != CURRENT_VERSION)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    migrateProject({ name: "Old Project" });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("0.0.0")
    );
    warnSpy.mockRestore();
  });
});
