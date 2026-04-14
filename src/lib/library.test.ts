import { describe, it, expect, beforeEach } from "vitest";
import {
  loadGlobalLibrary,
  saveGlobalLibrary,
  getLibraryFilePath,
  LibraryValidationError,
} from "./library";
import { mockPath, createMockFileSystem } from "@/test/tauri-mocks";
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

  it("throws LibraryValidationError for completely invalid JSON structure", async () => {
    createMockFileSystem({
      "/app-data/SoundsBored/library.json": JSON.stringify({ invalid: true }),
    });

    await expect(loadGlobalLibrary()).rejects.toBeInstanceOf(
      LibraryValidationError,
    );
  });

  it("throws LibraryValidationError for SyntaxError (malformed JSON text)", async () => {
    createMockFileSystem({
      "/app-data/SoundsBored/library.json": "{not valid json at all",
    });

    const err = await loadGlobalLibrary().catch((e) => e);
    expect(err).toBeInstanceOf(LibraryValidationError);
    expect((err as LibraryValidationError).message).toContain("Invalid JSON");
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

  it("throws LibraryValidationError for future library version", async () => {
    createMockFileSystem({
      "/app-data/SoundsBored/library.json": JSON.stringify({
        version: "99.0.0",
        sounds: [],
        tags: [],
        sets: [],
      }),
    });

    const err = await loadGlobalLibrary().catch((e) => e);
    expect(err).toBeInstanceOf(LibraryValidationError);
    expect((err as LibraryValidationError).message).toContain("newer version");
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
