import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getHistoryFilePath,
  ensureHistoryFile,
  loadProjectHistory,
  saveProjectHistory,
} from "@/lib/history";
import { mockFs, mockPath, resetTauriMocks, createMockFileSystem } from "@/test/tauri-mocks";
import { createMockHistoryEntry, createHistoryJson } from "@/test/factories";
import { APP_FOLDER, HISTORY_FILE_NAME } from "@/lib/constants";
import type { ProjectHistory } from "@/lib/schemas";

describe("getHistoryFilePath", () => {
  beforeEach(() => {
    resetTauriMocks();
  });

  it("should return correct history file path", async () => {
    const result = await getHistoryFilePath();

    expect(result).toBe("/app-data/SoundsBored/history.json");
    expect(mockPath.appDataDir).toHaveBeenCalled();
    expect(mockPath.join).toHaveBeenCalledWith("/app-data", APP_FOLDER, HISTORY_FILE_NAME);
  });
});

describe("ensureHistoryFile", () => {
  beforeEach(() => {
    resetTauriMocks();
  });

  it("should create folder and file if they don't exist", async () => {
    mockFs.exists.mockResolvedValue(false);

    const result = await ensureHistoryFile();

    expect(result).toBe("/app-data/SoundsBored/history.json");
    expect(mockFs.mkdir).toHaveBeenCalledWith(
      "/app-data/SoundsBored",
      { recursive: true }
    );
    expect(mockFs.writeTextFile).toHaveBeenCalledWith(
      "/app-data/SoundsBored/history.json.tmp",
      "[]"
    );
    expect(mockFs.rename).toHaveBeenCalledWith(
      "/app-data/SoundsBored/history.json.tmp",
      "/app-data/SoundsBored/history.json"
    );
  });

  it("should create only file if folder exists", async () => {
    mockFs.exists
      .mockResolvedValueOnce(true) // folder exists
      .mockResolvedValueOnce(false); // file doesn't exist

    const result = await ensureHistoryFile();

    expect(result).toBe("/app-data/SoundsBored/history.json");
    expect(mockFs.mkdir).not.toHaveBeenCalled();
    expect(mockFs.writeTextFile).toHaveBeenCalledWith(
      "/app-data/SoundsBored/history.json.tmp",
      "[]"
    );
    expect(mockFs.rename).toHaveBeenCalledWith(
      "/app-data/SoundsBored/history.json.tmp",
      "/app-data/SoundsBored/history.json"
    );
  });

  it("should not create anything if file already exists", async () => {
    mockFs.exists.mockResolvedValue(true);

    const result = await ensureHistoryFile();

    expect(result).toBe("/app-data/SoundsBored/history.json");
    expect(mockFs.mkdir).not.toHaveBeenCalled();
    expect(mockFs.writeTextFile).not.toHaveBeenCalled();
  });

  it("should return the history file path", async () => {
    mockFs.exists.mockResolvedValue(true);

    const result = await ensureHistoryFile();

    expect(result).toBe("/app-data/SoundsBored/history.json");
  });
});

describe("loadProjectHistory", () => {
  beforeEach(() => {
    resetTauriMocks();
  });

  it("should load empty history", async () => {
    mockFs.exists.mockResolvedValue(true);
    mockFs.readTextFile.mockResolvedValue("[]");

    const result = await loadProjectHistory();

    expect(result).toEqual([]);
  });

  it("should load valid history with one entry", async () => {
    const entry = createMockHistoryEntry({
      name: "Test Project",
      path: "/test/path",
    });
    mockFs.exists.mockResolvedValue(true);
    mockFs.readTextFile.mockResolvedValue(createHistoryJson([entry]));

    const result = await loadProjectHistory();

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Test Project");
    expect(result[0].path).toBe("/test/path");
  });

  it("should load valid history with multiple entries", async () => {
    const entries = [
      createMockHistoryEntry({ name: "Project 1", path: "/path/1" }),
      createMockHistoryEntry({ name: "Project 2", path: "/path/2" }),
      createMockHistoryEntry({ name: "Project 3", path: "/path/3" }),
    ];
    mockFs.exists.mockResolvedValue(true);
    mockFs.readTextFile.mockResolvedValue(createHistoryJson(entries));

    const result = await loadProjectHistory();

    expect(result).toHaveLength(3);
    expect(result[0].name).toBe("Project 1");
    expect(result[1].name).toBe("Project 2");
    expect(result[2].name).toBe("Project 3");
  });

  it("should create file if it doesn't exist before loading", async () => {
    mockFs.exists.mockResolvedValue(false);
    mockFs.readTextFile.mockResolvedValue("[]");

    const result = await loadProjectHistory();

    expect(mockFs.writeTextFile).toHaveBeenCalledWith(
      "/app-data/SoundsBored/history.json.tmp",
      "[]"
    );
    expect(result).toEqual([]);
  });

  it("recovers from invalid JSON — renames corrupt file, writes empty default, calls onCorruption", async () => {
    mockFs.exists.mockResolvedValue(true);
    mockFs.readTextFile.mockResolvedValue("invalid json {");
    mockFs.rename.mockResolvedValue(undefined);
    mockFs.writeTextFile.mockResolvedValue(undefined);
    const onCorruption = vi.fn();

    const result = await loadProjectHistory({ onCorruption });

    expect(result).toEqual([]);
    expect(mockFs.rename).toHaveBeenCalledWith(
      "/app-data/SoundsBored/history.json",
      "/app-data/SoundsBored/history.corrupt.json"
    );
    expect(mockFs.writeTextFile).toHaveBeenCalledWith(
      "/app-data/SoundsBored/history.json.tmp",
      "[]"
    );
    expect(mockFs.rename).toHaveBeenCalledWith(
      "/app-data/SoundsBored/history.json.tmp",
      "/app-data/SoundsBored/history.json"
    );
    expect(onCorruption).toHaveBeenCalledTimes(1);
    expect(onCorruption.mock.calls[0][0]).toContain("corrupt");
  });

  it("recovers from invalid schema — renames corrupt file and returns empty history", async () => {
    mockFs.exists.mockResolvedValue(true);
    mockFs.readTextFile.mockResolvedValue(
      JSON.stringify([{ name: "Missing path and date" }])
    );
    mockFs.rename.mockResolvedValue(undefined);
    mockFs.writeTextFile.mockResolvedValue(undefined);
    const onCorruption = vi.fn();

    const result = await loadProjectHistory({ onCorruption });

    expect(result).toEqual([]);
    expect(mockFs.rename).toHaveBeenCalledWith(
      "/app-data/SoundsBored/history.json",
      "/app-data/SoundsBored/history.corrupt.json"
    );
    expect(mockFs.writeTextFile).toHaveBeenCalledWith(
      "/app-data/SoundsBored/history.json.tmp",
      "[]"
    );
    expect(mockFs.rename).toHaveBeenCalledWith(
      "/app-data/SoundsBored/history.json.tmp",
      "/app-data/SoundsBored/history.json"
    );
    expect(onCorruption).toHaveBeenCalledTimes(1);
    expect(onCorruption.mock.calls[0][0]).toContain("corrupt");
  });

  it("recovers when JSON is not an array", async () => {
    mockFs.exists.mockResolvedValue(true);
    mockFs.readTextFile.mockResolvedValue(JSON.stringify({ not: "an array" }));
    mockFs.rename.mockResolvedValue(undefined);
    mockFs.writeTextFile.mockResolvedValue(undefined);
    const onCorruption = vi.fn();

    const result = await loadProjectHistory({ onCorruption });

    expect(result).toEqual([]);
    expect(mockFs.rename).toHaveBeenCalledWith(
      "/app-data/SoundsBored/history.json",
      "/app-data/SoundsBored/history.corrupt.json"
    );
    expect(mockFs.writeTextFile).toHaveBeenCalledWith(
      "/app-data/SoundsBored/history.json.tmp",
      "[]"
    );
    expect(mockFs.rename).toHaveBeenCalledWith(
      "/app-data/SoundsBored/history.json.tmp",
      "/app-data/SoundsBored/history.json"
    );
    expect(onCorruption).toHaveBeenCalledTimes(1);
    expect(onCorruption.mock.calls[0][0]).toContain("corrupt");
  });

  it("works without onCorruption callback — no crash when callback not provided", async () => {
    mockFs.exists.mockResolvedValue(true);
    mockFs.readTextFile.mockResolvedValue("invalid json {");
    mockFs.rename.mockResolvedValue(undefined);
    mockFs.writeTextFile.mockResolvedValue(undefined);

    const result = await loadProjectHistory();

    expect(result).toEqual([]);
    expect(mockFs.writeTextFile).toHaveBeenCalledWith(
      "/app-data/SoundsBored/history.json.tmp",
      "[]"
    );
  });

  it("rethrows non-corruption I/O errors", async () => {
    mockFs.exists.mockResolvedValue(true);
    mockFs.readTextFile.mockRejectedValue(new Error("EPERM: permission denied"));

    await expect(loadProjectHistory()).rejects.toThrow("EPERM: permission denied");
  });

  it("proceeds with recovery even if corruption-backup rename fails", async () => {
    mockFs.exists.mockResolvedValue(true);
    mockFs.readTextFile.mockResolvedValue("invalid json {");
    // First rename (backup to .corrupt.json) fails — second rename (atomic write) resolves
    mockFs.rename.mockRejectedValueOnce(new Error("EEXIST")).mockResolvedValue(undefined);
    mockFs.writeTextFile.mockResolvedValue(undefined);
    const onCorruption = vi.fn();

    const result = await loadProjectHistory({ onCorruption });

    expect(result).toEqual([]);
    expect(mockFs.writeTextFile).toHaveBeenCalledWith(
      "/app-data/SoundsBored/history.json.tmp",
      "[]"
    );
    expect(onCorruption).toHaveBeenCalledTimes(1);
  });
});

describe("saveProjectHistory", () => {
  beforeEach(() => {
    resetTauriMocks();
  });

  it("should save empty history", async () => {
    mockFs.exists.mockResolvedValue(true);

    await saveProjectHistory([]);

    expect(mockFs.writeTextFile).toHaveBeenCalledWith(
      "/app-data/SoundsBored/history.json.tmp",
      "[]"
    );
    expect(mockFs.rename).toHaveBeenCalledWith(
      "/app-data/SoundsBored/history.json.tmp",
      "/app-data/SoundsBored/history.json"
    );
  });

  it("should save history with one entry", async () => {
    mockFs.exists.mockResolvedValue(true);
    const history: ProjectHistory = [
      createMockHistoryEntry({
        name: "Test Project",
        path: "/test/path",
        date: "2026-03-13T10:00:00.000Z",
      }),
    ];

    await saveProjectHistory(history);

    expect(mockFs.writeTextFile).toHaveBeenCalled();
    const writtenContent = mockFs.writeTextFile.mock.calls[0][1];
    const parsed = JSON.parse(writtenContent);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("Test Project");
    expect(parsed[0].path).toBe("/test/path");
  });

  it("should save history with multiple entries", async () => {
    mockFs.exists.mockResolvedValue(true);
    const history: ProjectHistory = [
      createMockHistoryEntry({ name: "Project 1", path: "/path/1" }),
      createMockHistoryEntry({ name: "Project 2", path: "/path/2" }),
      createMockHistoryEntry({ name: "Project 3", path: "/path/3" }),
    ];

    await saveProjectHistory(history);

    const writtenContent = mockFs.writeTextFile.mock.calls[0][1];
    const parsed = JSON.parse(writtenContent);

    expect(parsed).toHaveLength(3);
    expect(parsed[0].name).toBe("Project 1");
    expect(parsed[1].name).toBe("Project 2");
    expect(parsed[2].name).toBe("Project 3");
  });

  it("should format JSON with indentation", async () => {
    mockFs.exists.mockResolvedValue(true);
    const history: ProjectHistory = [
      createMockHistoryEntry({ name: "Test" }),
    ];

    await saveProjectHistory(history);

    const writtenContent = mockFs.writeTextFile.mock.calls[0][1];

    // Check that it's formatted with indentation (not minified)
    expect(writtenContent).toContain("\n");
    expect(writtenContent).toContain("  ");
  });

  it("should create history file if it doesn't exist", async () => {
    mockFs.exists.mockResolvedValue(false);
    const history: ProjectHistory = [];

    await saveProjectHistory(history);

    expect(mockFs.writeTextFile).toHaveBeenCalledTimes(2); // once for ensure, once for save
  });

  it("should preserve all entry fields", async () => {
    mockFs.exists.mockResolvedValue(true);
    const history: ProjectHistory = [
      {
        name: "Full Entry",
        path: "/full/path/to/project",
        date: "2026-03-13T12:34:56.789Z",
      },
    ];

    await saveProjectHistory(history);

    const writtenContent = mockFs.writeTextFile.mock.calls[0][1];
    const parsed = JSON.parse(writtenContent);

    expect(parsed[0]).toEqual({
      name: "Full Entry",
      path: "/full/path/to/project",
      date: "2026-03-13T12:34:56.789Z",
    });
  });
});

describe("history integration", () => {
  beforeEach(() => {
    resetTauriMocks();
  });

  it("should roundtrip save and load", async () => {
    createMockFileSystem({});
    const history: ProjectHistory = [
      createMockHistoryEntry({ name: "Project 1" }),
      createMockHistoryEntry({ name: "Project 2" }),
    ];

    await saveProjectHistory(history);
    const loaded = await loadProjectHistory();

    expect(loaded).toHaveLength(2);
    expect(loaded[0].name).toBe("Project 1");
    expect(loaded[1].name).toBe("Project 2");
  });

  it("should handle multiple saves correctly", async () => {
    createMockFileSystem({});

    await saveProjectHistory([createMockHistoryEntry({ name: "First" })]);
    await saveProjectHistory([
      createMockHistoryEntry({ name: "First" }),
      createMockHistoryEntry({ name: "Second" }),
    ]);

    const loaded = await loadProjectHistory();

    expect(loaded).toHaveLength(2);
    expect(loaded[0].name).toBe("First");
    expect(loaded[1].name).toBe("Second");
  });
});
