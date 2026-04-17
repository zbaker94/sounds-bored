import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  loadGlobalLibrary,
  saveGlobalLibrary,
  getLibraryFilePath,
} from "./library";
import { mockPath, mockFs, createMockFileSystem } from "@/test/tauri-mocks";
import { CURRENT_LIBRARY_VERSION, LIBRARY_FILE_NAME } from "./constants";
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

  it("recovers from completely invalid JSON structure — renames file and returns empty library", async () => {
    createMockFileSystem({
      "/app-data/SoundsBored/library.json": JSON.stringify({ invalid: true }),
    });
    const onCorruption = vi.fn();

    const result = await loadGlobalLibrary({ onCorruption });

    expect(mockFs.rename).toHaveBeenCalledWith(
      "/app-data/SoundsBored/library.json",
      "/app-data/SoundsBored/library.corrupt.json",
    );
    expect(result.sounds).toEqual([]);
    expect(result.tags).toEqual([]);
    expect(result.sets).toEqual([]);
    expect(result.version).toBe(CURRENT_LIBRARY_VERSION);
    expect(onCorruption).toHaveBeenCalledWith(
      expect.stringContaining(LIBRARY_FILE_NAME),
    );
    expect(onCorruption).toHaveBeenCalledWith(
      expect.stringContaining("was corrupt and has been reset"),
    );
  });

  it("recovers from SyntaxError (malformed JSON text) — renames file and returns empty library", async () => {
    createMockFileSystem({
      "/app-data/SoundsBored/library.json": "{not valid json at all",
    });
    const onCorruption = vi.fn();

    const result = await loadGlobalLibrary({ onCorruption });

    expect(mockFs.rename).toHaveBeenCalledWith(
      "/app-data/SoundsBored/library.json",
      "/app-data/SoundsBored/library.corrupt.json",
    );
    expect(result.sounds).toEqual([]);
    expect(onCorruption).toHaveBeenCalledTimes(1);
  });

  it("successfully migrates and loads library with duplicate sound IDs", async () => {
    // Legacy library with duplicate sound IDs — migration deduplicates by id,
    // keeping the first occurrence, so schema parse succeeds.
    const raw = {
      sounds: [
        { id: "s1", name: "First", tags: [], sets: [] },
        { id: "s1", name: "Duplicate", tags: [], sets: [] },
        { id: "s2", name: "Other", tags: [], sets: [] },
      ],
      tags: [],
      sets: [],
    };
    createMockFileSystem({
      "/app-data/SoundsBored/library.json": JSON.stringify(raw),
    });

    const result = await loadGlobalLibrary();
    expect(result.sounds).toHaveLength(2);
    expect(result.sounds[0].id).toBe("s1");
    expect(result.sounds[0].name).toBe("First");
    expect(result.sounds[1].id).toBe("s2");
    expect(result.version).toBe(CURRENT_LIBRARY_VERSION);
  });

  it("successfully migrates and loads library with invalid durationMs", async () => {
    // Legacy library with a negative durationMs — migration strips the field
    // so the Zod .min(0) check passes on reload.
    const raw = {
      sounds: [
        { id: "s1", name: "Bad Duration", tags: [], sets: [], durationMs: -1 },
      ],
      tags: [],
      sets: [],
    };
    createMockFileSystem({
      "/app-data/SoundsBored/library.json": JSON.stringify(raw),
    });

    const result = await loadGlobalLibrary();
    expect(result.sounds).toHaveLength(1);
    expect(result.sounds[0].durationMs).toBeUndefined();
  });

  it("recovers from future library version (MigrationError) — renames file and returns empty library", async () => {
    createMockFileSystem({
      "/app-data/SoundsBored/library.json": JSON.stringify({
        version: "99.0.0",
        sounds: [],
        tags: [],
        sets: [],
      }),
    });
    const onCorruption = vi.fn();

    const result = await loadGlobalLibrary({ onCorruption });

    expect(mockFs.rename).toHaveBeenCalledWith(
      "/app-data/SoundsBored/library.json",
      "/app-data/SoundsBored/library.corrupt.json",
    );
    expect(result.sounds).toEqual([]);
    expect(onCorruption).toHaveBeenCalledTimes(1);
  });

  it("works without onCorruption callback — no crash", async () => {
    createMockFileSystem({
      "/app-data/SoundsBored/library.json": JSON.stringify({ invalid: true }),
    });

    const result = await loadGlobalLibrary();
    expect(result.sounds).toEqual([]);
    expect(result.tags).toEqual([]);
    expect(result.sets).toEqual([]);
  });

  it("proceeds with recovery even if corruption-backup rename fails", async () => {
    const files = createMockFileSystem({
      "/app-data/SoundsBored/library.json": JSON.stringify({ invalid: true }),
    });
    // First rename (backup to .corrupt.json) fails — second rename (atomic write) uses createMockFileSystem impl
    mockFs.rename.mockRejectedValueOnce(new Error("EEXIST"));
    const onCorruption = vi.fn();

    const result = await loadGlobalLibrary({ onCorruption });

    expect(result.sounds).toEqual([]);
    expect(onCorruption).toHaveBeenCalledTimes(1);
    // Fresh default written atomically
    const written = files["/app-data/SoundsBored/library.json"];
    expect(written).toBeDefined();
    const parsed = JSON.parse(written);
    expect(parsed.version).toBe(CURRENT_LIBRARY_VERSION);
    expect(parsed.sounds).toEqual([]);
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

  it("should write atomically via .tmp then rename", async () => {
    mockPath.appDataDir.mockResolvedValue("/app-data");
    createMockFileSystem({});
    const lib = createMockGlobalLibrary({});

    await saveGlobalLibrary(lib);

    expect(mockFs.writeTextFile).toHaveBeenCalledWith(
      expect.stringMatching(/^\/app-data\/SoundsBored\/library\.json\.[0-9a-f-]{36}\.tmp$/),
      expect.any(String)
    );
    expect(mockFs.rename).toHaveBeenCalledWith(
      expect.stringMatching(/^\/app-data\/SoundsBored\/library\.json\.[0-9a-f-]{36}\.tmp$/),
      "/app-data/SoundsBored/library.json"
    );
  });
});
