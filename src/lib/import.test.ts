import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockFs, mockPath } from "@/test/tauri-mocks";
import { copyFilesToFolder } from "@/lib/import";

// The global setup (src/test/setup.ts) already mocks @tauri-apps/plugin-fs and
// @tauri-apps/api/path via tauri-mocks.ts, so we don't need to re-mock them here.
// We do need to add basename to the path mock, as it isn't in the global mock.

vi.mock("@tauri-apps/api/path", async () => {
  const original = await vi.importActual<typeof import("@tauri-apps/api/path")>(
    "@tauri-apps/api/path"
  );
  return {
    ...original,
    join: vi.fn((...paths: string[]) => Promise.resolve(paths.join("/"))),
    basename: vi.fn((path: string) => {
      const parts = path.replace(/\\/g, "/").split("/");
      return Promise.resolve(parts[parts.length - 1]);
    }),
  };
});

describe("copyFilesToFolder", () => {
  const destFolder = "/project/sounds";

  beforeEach(() => {
    // Default: files don't exist at destination
    mockFs.exists.mockResolvedValue(false);
    // Default: copyFile succeeds
    mockFs.copyFile.mockResolvedValue(undefined);
  });

  it("filters out non-audio files — copyFile is never called", async () => {
    const sourcePaths = ["/downloads/readme.txt", "/downloads/image.png", "/downloads/data.json"];
    const result = await copyFilesToFolder(sourcePaths, destFolder);
    expect(mockFs.copyFile).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it("copies audio files to destFolderPath/<filename>", async () => {
    const sourcePaths = ["/downloads/kick.wav", "/downloads/snare.mp3"];
    const result = await copyFilesToFolder(sourcePaths, destFolder);
    expect(mockFs.copyFile).toHaveBeenCalledTimes(2);
    expect(mockFs.copyFile).toHaveBeenCalledWith(
      "/downloads/kick.wav",
      `${destFolder}/kick.wav`
    );
    expect(mockFs.copyFile).toHaveBeenCalledWith(
      "/downloads/snare.mp3",
      `${destFolder}/snare.mp3`
    );
    expect(result).toEqual([`${destFolder}/kick.wav`, `${destFolder}/snare.mp3`]);
  });

  it("skips files that already exist at the destination", async () => {
    mockFs.exists.mockImplementation((path: string) => {
      return Promise.resolve(path === `${destFolder}/kick.wav`);
    });
    const sourcePaths = ["/downloads/kick.wav", "/downloads/snare.mp3"];
    const result = await copyFilesToFolder(sourcePaths, destFolder);
    expect(mockFs.copyFile).toHaveBeenCalledTimes(1);
    expect(mockFs.copyFile).toHaveBeenCalledWith(
      "/downloads/snare.mp3",
      `${destFolder}/snare.mp3`
    );
    expect(result).toEqual([`${destFolder}/snare.mp3`]);
  });

  it("catches a failed copyFile — other files still processed, failed file not in return value", async () => {
    mockFs.copyFile.mockImplementation((src: string) => {
      if (src === "/downloads/kick.wav") {
        return Promise.reject(new Error("Permission denied"));
      }
      return Promise.resolve(undefined);
    });
    const sourcePaths = ["/downloads/kick.wav", "/downloads/snare.mp3", "/downloads/hat.ogg"];
    const result = await copyFilesToFolder(sourcePaths, destFolder);
    expect(mockFs.copyFile).toHaveBeenCalledTimes(3);
    expect(result).toEqual([`${destFolder}/snare.mp3`, `${destFolder}/hat.ogg`]);
  });

  it("returns only successfully copied dest paths", async () => {
    const sourcePaths = [
      "/downloads/kick.wav",
      "/downloads/notes.txt",     // filtered — not audio
      "/downloads/ambient.flac",
      "/downloads/loop.aiff",
      "/downloads/bass.m4a",
    ];
    const result = await copyFilesToFolder(sourcePaths, destFolder);
    expect(result).toEqual([
      `${destFolder}/kick.wav`,
      `${destFolder}/ambient.flac`,
      `${destFolder}/loop.aiff`,
      `${destFolder}/bass.m4a`,
    ]);
  });

  it("handles mixed audio extensions case-insensitively", async () => {
    const sourcePaths = ["/downloads/KICK.WAV", "/downloads/SNARE.MP3"];
    const result = await copyFilesToFolder(sourcePaths, destFolder);
    expect(mockFs.copyFile).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
  });

  it("returns empty array when sourcePaths is empty", async () => {
    const result = await copyFilesToFolder([], destFolder);
    expect(mockFs.copyFile).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});
