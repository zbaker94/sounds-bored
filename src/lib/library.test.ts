import { describe, it, expect, beforeEach } from "vitest";
import { loadGlobalLibrary, saveGlobalLibrary, getLibraryFilePath } from "./library";
import { mockFs, mockPath, createMockFileSystem } from "@/test/tauri-mocks";
import { CURRENT_LIBRARY_VERSION } from "./constants";
import { createMockGlobalLibrary } from "@/test/factories";
import { GlobalLibrary } from "./schemas";

describe("getLibraryFilePath", () => {
  it("should return the path under appDataDir/SoundsBored/library.json", async () => {
    mockPath.appDataDir.mockResolvedValue("/app-data");
    const path = await getLibraryFilePath();
    expect(path).toBe("/app-data/SoundsBored/library.json");
  });
});

describe("loadGlobalLibrary", () => {
  beforeEach(() => {
    mockPath.appDataDir.mockResolvedValue("/app-data");
  });

  it("should return an empty library when file does not exist", async () => {
    createMockFileSystem({});  // no files

    const result = await loadGlobalLibrary();
    expect(result.sounds).toEqual([]);
    expect(result.tags).toEqual([]);
    expect(result.sets).toEqual([]);
    expect(result.version).toBe(CURRENT_LIBRARY_VERSION);
  });

  it("should parse and return the library when file exists", async () => {
    const lib = createMockGlobalLibrary({
      tags: [{ id: "t1", name: "Drums" }],
    });
    createMockFileSystem({
      "/app-data/SoundsBored/library.json": JSON.stringify(lib),
    });

    const result = await loadGlobalLibrary();
    expect(result.tags).toHaveLength(1);
    expect(result.tags[0].name).toBe("Drums");
  });

  it("should throw a ZodError when the file contains an invalid structure", async () => {
    createMockFileSystem({
      "/app-data/SoundsBored/library.json": JSON.stringify({ invalid: true }),
    });

    await expect(loadGlobalLibrary()).rejects.toThrow();
  });
});

describe("saveGlobalLibrary", () => {
  it("should write the library as JSON to the correct path", async () => {
    mockPath.appDataDir.mockResolvedValue("/app-data");
    const files = createMockFileSystem({});
    const lib = createMockGlobalLibrary({
      sounds: [{ id: "s1", name: "Kick", tags: [], sets: [] }],
    });

    await saveGlobalLibrary(lib);

    const written = files["/app-data/SoundsBored/library.json"];
    expect(written).toBeDefined();
    const parsed: GlobalLibrary = JSON.parse(written);
    expect(parsed.sounds).toHaveLength(1);
    expect(parsed.sounds[0].name).toBe("Kick");
  });
});
