import { describe, it, expect, beforeEach } from "vitest";
import { loadAppSettings, saveAppSettings, getSettingsFilePath } from "./appSettings";
import { mockFs, mockPath, createMockFileSystem } from "@/test/tauri-mocks";
import { createMockAppSettings } from "@/test/factories";
import { AppSettings } from "./schemas";

describe("getSettingsFilePath", () => {
  it("should return the path under appDataDir/SoundsBored/settings.json", async () => {
    mockPath.appDataDir.mockResolvedValue("/app-data");
    const path = await getSettingsFilePath();
    expect(path).toBe("/app-data/SoundsBored/settings.json");
  });
});

describe("loadAppSettings", () => {
  beforeEach(() => {
    mockPath.appDataDir.mockResolvedValue("/app-data");
    mockPath.musicDir.mockResolvedValue("/music");
    mockFs.mkdir.mockResolvedValue(undefined);
  });

  it("should parse and return settings when the file exists", async () => {
    const settings = createMockAppSettings();
    createMockFileSystem({
      "/app-data/SoundsBored": null,
      "/app-data/SoundsBored/settings.json": JSON.stringify(settings),
    });

    const result = await loadAppSettings();
    expect(result.globalFolders).toHaveLength(settings.globalFolders.length);
    expect(result.downloadFolderId).toBe(settings.downloadFolderId);
    expect(result.importFolderId).toBe(settings.importFolderId);
  });

  it("should create default settings and write them when file is missing", async () => {
    createMockFileSystem({
      "/app-data/SoundsBored": null,
      // settings.json is intentionally absent
    });

    const result = await loadAppSettings();

    expect(result.globalFolders).toHaveLength(3);
    expect(result.version).toBe("1.0.0");
    expect(result.downloadFolderId).toBeTruthy();
    expect(result.importFolderId).toBeTruthy();
    expect(mockFs.writeTextFile).toHaveBeenCalledWith(
      "/app-data/SoundsBored/settings.json",
      expect.stringContaining("globalFolders")
    );
  });

  it("default settings should have downloads and imported subfolders under /music/SoundsBored", async () => {
    createMockFileSystem({ "/app-data/SoundsBored": null });

    const result = await loadAppSettings();

    const paths = result.globalFolders.map((f) => f.path);
    expect(paths).toContain("/music/SoundsBored");
    expect(paths).toContain("/music/SoundsBored/downloads");
    expect(paths).toContain("/music/SoundsBored/imported");
  });

  it("should proceed and return defaults even when folder creation fails", async () => {
    // /app-data/SoundsBored already exists, so mkdir for the app folder is never called.
    // createDefaultAppSettings calls mkdir three times (once per default music folder) — all fail.
    createMockFileSystem({ "/app-data/SoundsBored": null });
    mockFs.mkdir.mockRejectedValue(new Error("Permission denied"));

    // Should not throw — warnings are logged but defaults are still returned
    const result = await loadAppSettings();
    expect(result.globalFolders).toHaveLength(3);
  });

  it("should throw a ZodError if the file contains invalid JSON structure", async () => {
    createMockFileSystem({
      "/app-data/SoundsBored": null,
      "/app-data/SoundsBored/settings.json": JSON.stringify({ version: "1.0.0" }),  // missing required fields
    });

    await expect(loadAppSettings()).rejects.toThrow();
  });
});

describe("saveAppSettings", () => {
  it("should write settings as JSON to the correct path", async () => {
    mockPath.appDataDir.mockResolvedValue("/app-data");
    const files = createMockFileSystem({ "/app-data/SoundsBored": null });
    const settings = createMockAppSettings();

    await saveAppSettings(settings);

    const written = files["/app-data/SoundsBored/settings.json"];
    expect(written).toBeDefined();
    const parsed: AppSettings = JSON.parse(written);
    expect(parsed.downloadFolderId).toBe(settings.downloadFolderId);
    expect(parsed.globalFolders).toHaveLength(settings.globalFolders.length);
  });
});
