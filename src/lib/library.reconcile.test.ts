import { describe, it, expect, beforeEach, vi } from "vitest";
import { reconcileGlobalLibrary, checkMissingStatus, refreshMissingState, addGlobalFolderAndReconcile } from "./library.reconcile";
import { mockFs, mockPath, mockCore } from "@/test/tauri-mocks";
import { createMockGlobalFolder, createMockAppSettings, createMockSound } from "@/test/factories";
import { Sound } from "./schemas";
import { useAppSettingsStore, initialAppSettingsState } from "@/state/appSettingsStore";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";

// Extend mockFs with stat (not in the shared mock yet)
const mockStat = vi.fn();
(mockFs as Record<string, unknown>).stat = mockStat;

// Helper to create a Sound for testing
function createSound(overrides: Partial<Sound> & { id: string; name: string }): Sound {
  return {
    tags: [],
    sets: [],
    ...overrides,
  };
}

// Helper to mock readDir results
function mockReadDir(folderContents: Record<string, Array<{ name: string; isFile: boolean; isDirectory: boolean; isSymlink: boolean }>>) {
  mockFs.readDir.mockImplementation((path: string) => {
    const entries = folderContents[path];
    if (!entries) return Promise.reject(new Error(`Directory not found: ${path}`));
    return Promise.resolve(entries);
  });
}

// Helper to create a file entry for readDir
function fileEntry(name: string) {
  return { name, isFile: true, isDirectory: false, isSymlink: false };
}

function dirEntry(name: string) {
  return { name, isFile: false, isDirectory: true, isSymlink: false };
}

describe("reconcileGlobalLibrary", () => {
  beforeEach(() => {
    mockPath.join.mockImplementation((...paths: string[]) => Promise.resolve(paths.join("/")) as unknown as string);

    // Default: all paths exist (folders and files)
    mockFs.exists.mockResolvedValue(true);

    // Default: stat returns a size of 1024 bytes
    mockStat.mockReset();
    mockStat.mockResolvedValue({ size: 1024, isFile: true, isDirectory: false, isSymlink: false });

    // Default: cover art extraction returns null (no art found)
    mockCore.invoke.mockResolvedValue(null);
  });

  describe("discovering new sounds", () => {
    it("should create Sound entries for new audio files in a folder", async () => {
      const folder = createMockGlobalFolder({ path: "/music/samples" });
      mockReadDir({
        "/music/samples": [
          fileEntry("kick.wav"),
          fileEntry("snare.mp3"),
        ],
      });

      const result = await reconcileGlobalLibrary([folder], []);

      expect(result.changed).toBe(true);
      expect(result.sounds).toHaveLength(2);
      expect(result.sounds[0].name).toBe("Kick");
      expect(result.sounds[0].filePath).toBe("/music/samples/kick.wav");
      expect(result.sounds[0].folderId).toBe(folder.id);
      expect(result.sounds[0].tags).toEqual([]);
      expect(result.sounds[0].sets).toEqual([]);
      expect(result.sounds[1].name).toBe("Snare");
      expect(result.sounds[1].filePath).toBe("/music/samples/snare.mp3");
    });

    it("should ignore non-audio files", async () => {
      const folder = createMockGlobalFolder({ path: "/music/samples" });
      mockReadDir({
        "/music/samples": [
          fileEntry("kick.wav"),
          fileEntry("readme.txt"),
          fileEntry("cover.png"),
          fileEntry("notes.json"),
        ],
      });

      const result = await reconcileGlobalLibrary([folder], []);

      expect(result.sounds).toHaveLength(1);
      expect(result.sounds[0].name).toBe("Kick");
    });

    it("should ignore directories", async () => {
      const folder = createMockGlobalFolder({ path: "/music/samples" });
      mockReadDir({
        "/music/samples": [
          dirEntry("subfolder"),
          fileEntry("kick.wav"),
        ],
      });

      const result = await reconcileGlobalLibrary([folder], []);

      expect(result.sounds).toHaveLength(1);
      expect(result.sounds[0].name).toBe("Kick");
    });

    it("should support all audio extensions", async () => {
      const folder = createMockGlobalFolder({ path: "/music" });
      mockReadDir({
        "/music": [
          fileEntry("a.wav"),
          fileEntry("b.mp3"),
          fileEntry("c.ogg"),
          fileEntry("d.flac"),
          fileEntry("e.aiff"),
          fileEntry("f.m4a"),
        ],
      });

      const result = await reconcileGlobalLibrary([folder], []);

      expect(result.sounds).toHaveLength(6);
    });

    it("should handle case-insensitive extensions", async () => {
      const folder = createMockGlobalFolder({ path: "/music" });
      mockReadDir({
        "/music": [
          fileEntry("kick.WAV"),
          fileEntry("snare.Mp3"),
        ],
      });

      const result = await reconcileGlobalLibrary([folder], []);

      expect(result.sounds).toHaveLength(2);
    });

    it("should not create duplicates for files already in the library", async () => {
      const folder = createMockGlobalFolder({ path: "/music/samples" });
      const existingSound = createSound({
        id: "existing-1",
        name: "kick",
        filePath: "/music/samples/kick.wav",
        folderId: folder.id,
      });

      mockReadDir({
        "/music/samples": [
          fileEntry("kick.wav"),
          fileEntry("snare.mp3"),
        ],
      });

      const result = await reconcileGlobalLibrary([folder], [existingSound]);

      expect(result.sounds).toHaveLength(2);
      expect(result.sounds[0].id).toBe("existing-1");
      expect(result.sounds[1].name).toBe("Snare");
    });

    it("should create separate sounds for files with same name in different folders", async () => {
      const folder1 = createMockGlobalFolder({ id: "f1", path: "/music/a" });
      const folder2 = createMockGlobalFolder({ id: "f2", path: "/music/b" });

      mockReadDir({
        "/music/a": [fileEntry("kick.wav")],
        "/music/b": [fileEntry("kick.wav")],
      });

      const result = await reconcileGlobalLibrary([folder1, folder2], []);

      expect(result.sounds).toHaveLength(2);
      expect(result.sounds[0].filePath).toBe("/music/a/kick.wav");
      expect(result.sounds[1].filePath).toBe("/music/b/kick.wav");
    });
  });

  describe("scanning multiple folders", () => {
    it("should scan all global folders", async () => {
      const folder1 = createMockGlobalFolder({ path: "/music/drums" });
      const folder2 = createMockGlobalFolder({ path: "/music/synths" });

      mockReadDir({
        "/music/drums": [fileEntry("kick.wav")],
        "/music/synths": [fileEntry("pad.ogg")],
      });

      const result = await reconcileGlobalLibrary([folder1, folder2], []);

      expect(result.sounds).toHaveLength(2);
      expect(result.sounds[0].folderId).toBe(folder1.id);
      expect(result.sounds[1].folderId).toBe(folder2.id);
    });
  });

  describe("existing sounds are preserved", () => {
    it("should keep existing sounds whose files may be missing unchanged in the array", async () => {
      const existingSound = createSound({
        id: "s1",
        name: "deleted-sound",
        filePath: "/music/samples/deleted.wav",
      });

      const result = await reconcileGlobalLibrary([], [existingSound]);

      expect(result.sounds).toHaveLength(1);
      expect(result.sounds[0].id).toBe("s1");
      expect(result.sounds[0].name).toBe("deleted-sound");
      expect(result.sounds[0].filePath).toBe("/music/samples/deleted.wav");
    });

    it("should keep sounds without filePath as-is", async () => {
      const urlOnlySound = createSound({
        id: "s1",
        name: "web-sound",
        sourceUrl: "https://example.com/sound.mp3",
      });

      const result = await reconcileGlobalLibrary([], [urlOnlySound]);

      expect(result.sounds).toHaveLength(1);
      expect(result.sounds[0].id).toBe("s1");
    });
  });

  describe("folderId backfill", () => {
    it("should set folderId on existing sounds when discovered in a folder and folderId is undefined", async () => {
      const folder = createMockGlobalFolder({ id: "folder-1", path: "/music/samples" });
      const existingSound = createSound({
        id: "s1",
        name: "kick",
        filePath: "/music/samples/kick.wav",
      });

      mockReadDir({
        "/music/samples": [fileEntry("kick.wav")],
      });

      const result = await reconcileGlobalLibrary([folder], [existingSound]);

      expect(result.changed).toBe(true);
      expect(result.sounds).toHaveLength(1);
      expect(result.sounds[0].id).toBe("s1");
      expect(result.sounds[0].folderId).toBe("folder-1");
    });

    it("should not overwrite existing folderId", async () => {
      const folder = createMockGlobalFolder({ id: "folder-new", path: "/music/samples" });
      const existingSound = createSound({
        id: "s1",
        name: "kick",
        filePath: "/music/samples/kick.wav",
        folderId: "folder-original",
        fileSizeBytes: 1024,
        coverArtDataUrl: "",  // sentinel: already checked
      });

      mockReadDir({
        "/music/samples": [fileEntry("kick.wav")],
      });

      const result = await reconcileGlobalLibrary([folder], [existingSound]);

      expect(result.changed).toBe(false);
      expect(result.sounds[0].folderId).toBe("folder-original");
    });

    it("should return changed=true when folderId is backfilled", async () => {
      const folder = createMockGlobalFolder({ id: "folder-1", path: "/music" });
      const existingSound = createSound({
        id: "s1",
        name: "pad",
        filePath: "/music/pad.wav",
      });

      mockReadDir({ "/music": [fileEntry("pad.wav")] });

      const result = await reconcileGlobalLibrary([folder], [existingSound]);

      expect(result.changed).toBe(true);
    });
  });

  describe("handling non-existent folders", () => {
    it("should gracefully handle folders that do not exist", async () => {
      const folder = createMockGlobalFolder({ path: "/nonexistent/folder" });

      mockFs.exists.mockImplementation((path: string) => {
        if (path === "/nonexistent/folder") return Promise.resolve(false);
        return Promise.resolve(true);
      });

      const result = await reconcileGlobalLibrary([folder], []);

      expect(result.changed).toBe(false);
      expect(result.sounds).toEqual([]);
    });
  });

  describe("changed flag", () => {
    it("should return changed=false when nothing changed", async () => {
      const result = await reconcileGlobalLibrary([], []);

      expect(result.changed).toBe(false);
    });

    it("should return changed=true when new sounds are discovered", async () => {
      const folder = createMockGlobalFolder({ path: "/music" });
      mockReadDir({ "/music": [fileEntry("kick.wav")] });

      const result = await reconcileGlobalLibrary([folder], []);

      expect(result.changed).toBe(true);
    });

    it("should return changed=false when all files already exist in library", async () => {
      const folder = createMockGlobalFolder({ id: "f1", path: "/music" });
      const existingSound = createSound({
        id: "s1",
        name: "kick",
        filePath: "/music/kick.wav",
        folderId: "f1",
        fileSizeBytes: 1024,
        coverArtDataUrl: "",  // sentinel: already checked
      });

      mockReadDir({ "/music": [fileEntry("kick.wav")] });

      const result = await reconcileGlobalLibrary([folder], [existingSound]);

      expect(result.changed).toBe(false);
    });
  });

  describe("checkMissingStatus", () => {
    it("should flag sounds whose folder is missing", async () => {
      const folder = createMockGlobalFolder({ id: "f1", path: "/missing/folder" });
      const sound1 = createSound({ id: "s1", name: "kick", filePath: "/missing/folder/kick.wav", folderId: "f1" });
      const sound2 = createSound({ id: "s2", name: "snare", filePath: "/missing/folder/snare.wav", folderId: "f1" });
      const sound3 = createSound({ id: "s3", name: "hi-hat", filePath: "/other/hihat.wav" });

      mockFs.exists.mockImplementation((path: string) => {
        if (path === "/missing/folder") return Promise.resolve(false);
        return Promise.resolve(true);
      });

      const result = await checkMissingStatus([folder], [sound1, sound2, sound3]);

      expect(result.missingFolderIds).toContain("f1");
      expect(result.missingSoundIds).toContain("s1");
      expect(result.missingSoundIds).toContain("s2");
      expect(result.missingSoundIds).not.toContain("s3");
    });

    it("should flag a sound whose individual file is missing", async () => {
      const folder = createMockGlobalFolder({ id: "f1", path: "/music" });
      const presentSound = createSound({ id: "s1", name: "kick", filePath: "/music/kick.wav", folderId: "f1" });
      const missingSound = createSound({ id: "s2", name: "ghost", filePath: "/music/ghost.wav", folderId: "f1" });

      mockFs.exists.mockImplementation((path: string) => {
        if (path === "/music/ghost.wav") return Promise.resolve(false);
        return Promise.resolve(true);
      });

      const result = await checkMissingStatus([folder], [presentSound, missingSound]);

      expect(result.missingFolderIds.size).toBe(0);
      expect(result.missingSoundIds).toContain("s2");
      expect(result.missingSoundIds).not.toContain("s1");
    });

    it("should return empty sets when everything exists", async () => {
      const folder = createMockGlobalFolder({ id: "f1", path: "/music" });
      const sound = createSound({ id: "s1", name: "kick", filePath: "/music/kick.wav", folderId: "f1" });

      mockFs.exists.mockResolvedValue(true);

      const result = await checkMissingStatus([folder], [sound]);

      expect(result.missingFolderIds.size).toBe(0);
      expect(result.missingSoundIds.size).toBe(0);
    });

    it("should not flag a sound with no filePath and no folderId", async () => {
      const folder = createMockGlobalFolder({ id: "f1", path: "/missing/folder" });
      const orphanSound = createSound({ id: "s1", name: "web-sound" }); // no folderId

      mockFs.exists.mockResolvedValue(false);

      const result = await checkMissingStatus([folder], [orphanSound]);

      expect(result.missingFolderIds).toContain("f1");
      expect(result.missingSoundIds.size).toBe(0);
      expect(result.unknownSoundIds.size).toBe(0);
    });

    it("marks a folder as unknown (not missing) when exists() throws", async () => {
      const folder = createMockGlobalFolder({ id: "f1", path: "/restricted/folder" });
      const sound = createSound({ id: "s1", name: "kick", filePath: "/restricted/folder/kick.wav", folderId: "f1" });

      mockFs.exists.mockRejectedValue(new Error("Permission denied"));

      const result = await checkMissingStatus([folder], [sound]);

      // Must NOT be in missingSoundIds/missingFolderIds
      expect(result.missingFolderIds.size).toBe(0);
      expect(result.missingSoundIds.size).toBe(0);
      // Must be tracked as unknown
      expect(result.unknownFolderIds).toContain("f1");
      expect(result.unknownSoundIds).toContain("s1");
    });

    it("marks a sound as unknown (not missing) when only its file check throws", async () => {
      const folder = createMockGlobalFolder({ id: "f1", path: "/music" });
      const normalSound = createSound({ id: "s1", name: "kick", filePath: "/music/kick.wav", folderId: "f1" });
      const restrictedSound = createSound({ id: "s2", name: "restricted", filePath: "/music/restricted.wav", folderId: "f1" });

      mockFs.exists.mockImplementation((path: string) => {
        if (path === "/music/restricted.wav") return Promise.reject(new Error("out of scope"));
        return Promise.resolve(true);
      });

      const result = await checkMissingStatus([folder], [normalSound, restrictedSound]);

      expect(result.missingSoundIds.size).toBe(0);
      expect(result.unknownSoundIds).toContain("s2");
      expect(result.unknownSoundIds).not.toContain("s1");
    });

    it("marks a no-filePath sound as unknown when its folder check throws", async () => {
      const folder = createMockGlobalFolder({ id: "f1", path: "/restricted" });
      const noPathSound = createSound({ id: "s1", name: "web-sound", folderId: "f1" });

      mockFs.exists.mockRejectedValue(new Error("Permission denied"));

      const result = await checkMissingStatus([folder], [noPathSound]);

      // Folder is unknown, so the no-path sound is also unknown (not missing)
      expect(result.missingSoundIds.size).toBe(0);
      expect(result.unknownFolderIds).toContain("f1");
      expect(result.unknownSoundIds).toContain("s1");
    });

    it("returns empty unknown sets when all checks succeed", async () => {
      const folder = createMockGlobalFolder({ id: "f1", path: "/music" });
      const sound = createSound({ id: "s1", name: "kick", filePath: "/music/kick.wav", folderId: "f1" });

      mockFs.exists.mockResolvedValue(true);

      const result = await checkMissingStatus([folder], [sound]);

      expect(result.unknownSoundIds.size).toBe(0);
      expect(result.unknownFolderIds.size).toBe(0);
    });

    it("correctly partitions missing and unknown folders with their sounds", async () => {
      const missingFolder = createMockGlobalFolder({ id: "f-missing", path: "/gone" });
      const unknownFolder = createMockGlobalFolder({ id: "f-unknown", path: "/restricted" });
      const okFolder = createMockGlobalFolder({ id: "f-ok", path: "/music" });

      const soundInMissing = createSound({ id: "s-missing", name: "gone", filePath: "/gone/gone.wav", folderId: "f-missing" });
      const soundInUnknown = createSound({ id: "s-unknown", name: "restricted", filePath: "/restricted/r.wav", folderId: "f-unknown" });
      const soundInOk = createSound({ id: "s-ok", name: "present", filePath: "/music/kick.wav", folderId: "f-ok" });

      mockFs.exists.mockImplementation((path: string) => {
        if (path === "/gone") return Promise.resolve(false);
        if (path === "/restricted" || path === "/restricted/r.wav") return Promise.reject(new Error("denied"));
        return Promise.resolve(true);
      });

      const result = await checkMissingStatus(
        [missingFolder, unknownFolder, okFolder],
        [soundInMissing, soundInUnknown, soundInOk],
      );

      expect(result.missingFolderIds).toContain("f-missing");
      expect(result.unknownFolderIds).toContain("f-unknown");
      expect(result.missingSoundIds).toContain("s-missing");
      expect(result.unknownSoundIds).toContain("s-unknown");
      expect(result.missingSoundIds).not.toContain("s-ok");
      expect(result.unknownSoundIds).not.toContain("s-ok");
      expect(result.missingSoundIds).not.toContain("s-unknown");
      expect(result.unknownSoundIds).not.toContain("s-missing");
    });

    it("prioritises missing folder over unknown file check for the same sound", async () => {
      const folder = createMockGlobalFolder({ id: "f1", path: "/gone" });
      const sound = createSound({ id: "s1", name: "kick", filePath: "/gone/kick.wav", folderId: "f1" });

      // Folder is gone; per-file check also throws (e.g. OS removed inode before stat)
      mockFs.exists.mockImplementation((path: string) => {
        if (path === "/gone") return Promise.resolve(false);
        return Promise.reject(new Error("gone"));
      });

      const result = await checkMissingStatus([folder], [sound]);

      expect(result.missingSoundIds).toContain("s1");
      expect(result.unknownSoundIds).not.toContain("s1");
    });

    it("no-filePath sound in a missing folder is flagged as missing", async () => {
      const folder = createMockGlobalFolder({ id: "f1", path: "/missing/folder" });
      const noPathSound = createSound({ id: "s1", name: "web-sound", folderId: "f1" });

      mockFs.exists.mockResolvedValue(false);

      const result = await checkMissingStatus([folder], [noPathSound]);

      expect(result.missingFolderIds).toContain("f1");
      expect(result.missingSoundIds).toContain("s1");
      expect(result.unknownSoundIds.size).toBe(0);
    });
  });

  describe("fileSizeBytes population", () => {
    it("should populate fileSizeBytes on new sounds from stat", async () => {
      const folder = createMockGlobalFolder({ path: "/music/samples" });
      mockReadDir({
        "/music/samples": [
          fileEntry("kick.wav"),
          fileEntry("snare.mp3"),
        ],
      });

      mockStat.mockImplementation((path: string) => {
        if (path === "/music/samples/kick.wav") return Promise.resolve({ size: 2048 });
        if (path === "/music/samples/snare.mp3") return Promise.resolve({ size: 4096 });
        return Promise.resolve({ size: 1024 });
      });

      const result = await reconcileGlobalLibrary([folder], []);

      expect(result.sounds).toHaveLength(2);
      expect(result.sounds[0].fileSizeBytes).toBe(2048);
      expect(result.sounds[1].fileSizeBytes).toBe(4096);
    });

    it("should backfill fileSizeBytes on existing sounds missing it", async () => {
      const folder = createMockGlobalFolder({ id: "f1", path: "/music" });
      const existingSound = createSound({
        id: "s1",
        name: "kick",
        filePath: "/music/kick.wav",
        folderId: "f1",
      });

      mockReadDir({ "/music": [fileEntry("kick.wav")] });
      mockStat.mockResolvedValue({ size: 5000 });

      const result = await reconcileGlobalLibrary([folder], [existingSound]);

      expect(result.changed).toBe(true);
      expect(result.sounds[0].id).toBe("s1");
      expect(result.sounds[0].fileSizeBytes).toBe(5000);
    });

    it("should not overwrite existing fileSizeBytes on sounds that already have it", async () => {
      const folder = createMockGlobalFolder({ id: "f1", path: "/music" });
      const existingSound = createSound({
        id: "s1",
        name: "kick",
        filePath: "/music/kick.wav",
        folderId: "f1",
        fileSizeBytes: 9999,
      });

      mockReadDir({ "/music": [fileEntry("kick.wav")] });
      mockStat.mockResolvedValue({ size: 5000 });

      const result = await reconcileGlobalLibrary([folder], [existingSound]);

      expect(result.sounds[0].fileSizeBytes).toBe(9999);
      // stat should not have been called for this sound since it already has fileSizeBytes
    });

    it("should handle stat failure gracefully for new sounds", async () => {
      const folder = createMockGlobalFolder({ path: "/music" });
      mockReadDir({
        "/music": [
          fileEntry("kick.wav"),
          fileEntry("snare.mp3"),
        ],
      });

      mockStat.mockImplementation((path: string) => {
        if (path === "/music/kick.wav") return Promise.reject(new Error("Permission denied"));
        return Promise.resolve({ size: 4096 });
      });

      const result = await reconcileGlobalLibrary([folder], []);

      expect(result.sounds).toHaveLength(2);
      // kick.wav stat failed — no fileSizeBytes
      expect(result.sounds[0].fileSizeBytes).toBeUndefined();
      // snare.mp3 stat succeeded
      expect(result.sounds[1].fileSizeBytes).toBe(4096);
    });

    it("should handle stat failure gracefully for existing sounds backfill", async () => {
      const existingSound = createSound({
        id: "s1",
        name: "kick",
        filePath: "/music/kick.wav",
        folderId: "f1",
      });

      mockStat.mockRejectedValue(new Error("File not accessible"));

      const result = await reconcileGlobalLibrary([], [existingSound]);

      expect(result.sounds).toHaveLength(1);
      expect(result.sounds[0].id).toBe("s1");
      expect(result.sounds[0].fileSizeBytes).toBeUndefined();
    });

    it("should backfill fileSizeBytes on existing sounds even without folder scan", async () => {
      // Sound exists in library but no folders are configured — stat backfill should still run
      const existingSound = createSound({
        id: "s1",
        name: "kick",
        filePath: "/some/path/kick.wav",
      });

      mockStat.mockResolvedValue({ size: 3333 });

      const result = await reconcileGlobalLibrary([], [existingSound]);

      expect(result.changed).toBe(true);
      expect(result.sounds[0].fileSizeBytes).toBe(3333);
    });
  });

  describe("sound naming", () => {
    it("should normalize filename into a display name", async () => {
      const folder = createMockGlobalFolder({ path: "/music" });
      mockReadDir({
        "/music": [
          fileEntry("my-audio_bgm_whatever.wav"),
          fileEntry("ambient_rain.mp3"),
          fileEntry("kick.wav"),
        ],
      });

      const result = await reconcileGlobalLibrary([folder], []);

      expect(result.sounds[0].name).toBe("My Audio Bgm Whatever");
      expect(result.sounds[1].name).toBe("Ambient Rain");
      expect(result.sounds[2].name).toBe("Kick");
    });

    it("should handle filenames with multiple dots (dots are not delimiters)", async () => {
      const folder = createMockGlobalFolder({ path: "/music" });
      mockReadDir({
        "/music": [fileEntry("my.cool.sound.wav")],
      });

      const result = await reconcileGlobalLibrary([folder], []);

      expect(result.sounds[0].name).toBe("My.cool.sound");
    });
  });
});

describe("coverArtDataUrl extraction", () => {
  beforeEach(() => {
    mockPath.join.mockImplementation((...paths: string[]) => Promise.resolve(paths.join("/")) as unknown as string);
    mockFs.exists.mockResolvedValue(true);
    mockStat.mockResolvedValue({ size: 1024 });
    mockCore.invoke.mockResolvedValue(null);
  });

  it("populates coverArtDataUrl on new sounds when extraction succeeds", async () => {
    const folder = createMockGlobalFolder({ path: "/music" });
    mockReadDir({ "/music": [fileEntry("kick.mp3")] });
    mockCore.invoke.mockImplementation((cmd: string) => {
      if (cmd === "extract_cover_art") return Promise.resolve("data:image/jpeg;base64,abc123");
      return Promise.resolve(null);
    });

    const result = await reconcileGlobalLibrary([folder], []);

    expect(result.sounds[0].coverArtDataUrl).toBe("data:image/jpeg;base64,abc123");
  });

  it("sets empty string sentinel on new sounds when no art is embedded", async () => {
    const folder = createMockGlobalFolder({ path: "/music" });
    mockReadDir({ "/music": [fileEntry("kick.mp3")] });
    mockCore.invoke.mockResolvedValue(null);  // no art

    const result = await reconcileGlobalLibrary([folder], []);

    expect(result.sounds[0].coverArtDataUrl).toBe("");
  });

  it("leaves coverArtDataUrl undefined on new sounds when extraction throws", async () => {
    const folder = createMockGlobalFolder({ path: "/music" });
    mockReadDir({ "/music": [fileEntry("kick.mp3")] });
    mockCore.invoke.mockRejectedValue(new Error("extraction failed"));

    const result = await reconcileGlobalLibrary([folder], []);

    expect(result.sounds[0].coverArtDataUrl).toBeUndefined();
  });

  it("backfills coverArtDataUrl on existing sounds that have undefined", async () => {
    const existingSound = createSound({
      id: "s1",
      name: "kick",
      filePath: "/music/kick.mp3",
      folderId: "f1",
      fileSizeBytes: 1024,
    });
    mockCore.invoke.mockImplementation((cmd: string) => {
      if (cmd === "extract_cover_art") return Promise.resolve("data:image/png;base64,xyz");
      return Promise.resolve(null);
    });

    const result = await reconcileGlobalLibrary([], [existingSound]);

    expect(result.changed).toBe(true);
    expect(result.sounds[0].coverArtDataUrl).toBe("data:image/png;base64,xyz");
  });

  it("stores empty string sentinel on existing sounds when no art found", async () => {
    const existingSound = createSound({ id: "s1", name: "kick", filePath: "/music/kick.mp3", folderId: "f1", fileSizeBytes: 1024 });
    mockCore.invoke.mockResolvedValue(null);

    const result = await reconcileGlobalLibrary([], [existingSound]);

    expect(result.changed).toBe(true);
    expect(result.sounds[0].coverArtDataUrl).toBe("");
  });

  it("does not re-extract for sounds with empty string sentinel", async () => {
    const existingSound = createSound({
      id: "s1",
      name: "kick",
      filePath: "/music/kick.mp3",
      folderId: "f1",
      fileSizeBytes: 1024,
      coverArtDataUrl: "",  // already checked — no art
    });

    const result = await reconcileGlobalLibrary([], [existingSound]);

    expect(mockCore.invoke).not.toHaveBeenCalledWith("extract_cover_art", expect.anything());
    expect(result.sounds[0].coverArtDataUrl).toBe("");
  });

  it("does not re-extract for sounds that already have cover art", async () => {
    const existingSound = createSound({
      id: "s1",
      name: "kick",
      filePath: "/music/kick.mp3",
      folderId: "f1",
      fileSizeBytes: 1024,
      coverArtDataUrl: "data:image/jpeg;base64,existing",
    });

    const result = await reconcileGlobalLibrary([], [existingSound]);

    expect(mockCore.invoke).not.toHaveBeenCalledWith("extract_cover_art", expect.anything());
    expect(result.sounds[0].coverArtDataUrl).toBe("data:image/jpeg;base64,existing");
  });

  it("skips extraction for sounds without filePath", async () => {
    const noPathSound = createSound({ id: "s1", name: "web-sound", sourceUrl: "https://example.com/s.mp3" });

    const result = await reconcileGlobalLibrary([], [noPathSound]);

    expect(mockCore.invoke).not.toHaveBeenCalledWith("extract_cover_art", expect.anything());
    expect(result.sounds[0].coverArtDataUrl).toBeUndefined();
  });

  it("processes sounds in batches — all sounds get processed even with many entries", async () => {
    // Create 20 sounds to exercise the batch-size-8 loop
    const sounds = Array.from({ length: 20 }, (_, i) =>
      createSound({ id: `s${i}`, name: `sound-${i}`, filePath: `/music/sound-${i}.mp3`, folderId: "f1", fileSizeBytes: 1024 }),
    );
    mockCore.invoke.mockResolvedValue(null);  // no art for any

    const result = await reconcileGlobalLibrary([], sounds);

    expect(result.sounds).toHaveLength(20);
    // All 20 sounds should have been checked (sentinel stored)
    expect(result.sounds.every((s) => s.coverArtDataUrl === "")).toBe(true);
  });
});

describe("addGlobalFolderAndReconcile", () => {
  beforeEach(() => {
    mockPath.join.mockImplementation((...paths: string[]) => Promise.resolve(paths.join("/")) as unknown as string);
    mockFs.exists.mockResolvedValue(true);
    mockStat.mockResolvedValue({ size: 1024 });
    mockCore.invoke.mockResolvedValue(null);
  });

  it("appends the folder to settings and calls saveSettings before reconciling", async () => {
    const settings = createMockAppSettings({ globalFolders: [] });
    const newFolder = createMockGlobalFolder({ id: "f-new", path: "/music/new", name: "new" });
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const setSounds = vi.fn();

    mockReadDir({ "/music/new": [] });

    const { updatedSettings } = await addGlobalFolderAndReconcile(
      newFolder, settings, [], saveSettings, setSounds,
    );

    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(saveSettings).toHaveBeenCalledWith(updatedSettings);
    expect(updatedSettings.globalFolders).toHaveLength(1);
    expect(updatedSettings.globalFolders[0]).toBe(newFolder);
  });

  it("calls setSounds with discovered files when reconcile reports changed", async () => {
    const settings = createMockAppSettings({ globalFolders: [] });
    const newFolder = createMockGlobalFolder({ id: "f-new", path: "/music/new", name: "new" });
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const setSounds = vi.fn();

    mockReadDir({ "/music/new": [fileEntry("kick.wav")] });

    const { changed } = await addGlobalFolderAndReconcile(
      newFolder, settings, [], saveSettings, setSounds,
    );

    expect(changed).toBe(true);
    expect(setSounds).toHaveBeenCalledTimes(1);
    const [newSounds] = setSounds.mock.calls[0] as [Sound[]];
    expect(newSounds).toHaveLength(1);
    expect(newSounds[0].folderId).toBe("f-new");
  });

  it("does not call setSounds when the folder contains no new audio files", async () => {
    const settings = createMockAppSettings({ globalFolders: [] });
    const newFolder = createMockGlobalFolder({ id: "f-new", path: "/music/new", name: "new" });
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const setSounds = vi.fn();

    mockReadDir({ "/music/new": [] });

    const { changed } = await addGlobalFolderAndReconcile(
      newFolder, settings, [], saveSettings, setSounds,
    );

    expect(changed).toBe(false);
    expect(setSounds).not.toHaveBeenCalled();
  });

  it("preserves existing folders in updatedSettings", async () => {
    const existingFolder = createMockGlobalFolder({ path: "/music/existing" });
    const settings = createMockAppSettings({ globalFolders: [existingFolder] });
    const newFolder = createMockGlobalFolder({ id: "f-new", path: "/music/new", name: "new" });
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const setSounds = vi.fn();

    mockReadDir({ "/music/existing": [], "/music/new": [] });

    const { updatedSettings } = await addGlobalFolderAndReconcile(
      newFolder, settings, [], saveSettings, setSounds,
    );

    expect(updatedSettings.globalFolders).toHaveLength(2);
    expect(updatedSettings.globalFolders[0]).toBe(existingFolder);
    expect(updatedSettings.globalFolders[1]).toBe(newFolder);
  });
});

describe("refreshMissingState", () => {
  beforeEach(() => {
    useAppSettingsStore.setState({ ...initialAppSettingsState });
    useLibraryStore.setState({ ...initialLibraryState });
    mockFs.exists.mockResolvedValue(true);
    mockCore.invoke.mockResolvedValue(null);
  });

  it("does nothing when no settings are loaded", async () => {
    const sentinel = new Set(["sentinel"]);
    useLibraryStore.setState({ missingSoundIds: sentinel, missingFolderIds: sentinel });
    await refreshMissingState();
    // Store was not mutated — setMissingState was not called
    expect(useLibraryStore.getState().missingSoundIds).toBe(sentinel);
    expect(useLibraryStore.getState().missingFolderIds).toBe(sentinel);
  });

  it("uses store settings and sounds to detect missing files", async () => {
    const folder = createMockGlobalFolder({ id: "f1", path: "/music" });
    const presentSound = createMockSound({ id: "s1", filePath: "/music/kick.wav", folderId: "f1" });
    const missingSound = createMockSound({ id: "s2", filePath: "/music/ghost.wav", folderId: "f1" });

    useAppSettingsStore.setState({
      settings: createMockAppSettings({ globalFolders: [folder] }),
    });
    useLibraryStore.setState({ sounds: [presentSound, missingSound] });

    mockFs.exists.mockImplementation((path: string) => {
      if (path === "/music/ghost.wav") return Promise.resolve(false);
      return Promise.resolve(true);
    });

    await refreshMissingState();

    const { missingSoundIds, missingFolderIds } = useLibraryStore.getState();
    expect(missingSoundIds).toContain("s2");
    expect(missingSoundIds).not.toContain("s1");
    expect(missingFolderIds.size).toBe(0);
  });

  it("uses globalFolders override instead of store settings when provided", async () => {
    const storeFolder = createMockGlobalFolder({ id: "store-f", path: "/store-music" });
    const overrideFolder = createMockGlobalFolder({ id: "override-f", path: "/new-music" });
    const sound = createMockSound({ id: "s1", filePath: "/new-music/kick.wav", folderId: "override-f" });

    useAppSettingsStore.setState({
      settings: createMockAppSettings({ globalFolders: [storeFolder] }),
    });
    useLibraryStore.setState({ sounds: [sound] });

    // /new-music exists; if we used store folder (/store-music), the check would differ
    mockFs.exists.mockImplementation((path: string) => {
      if (path === "/store-music") return Promise.resolve(false);
      return Promise.resolve(true);
    });

    await refreshMissingState([overrideFolder]);

    const { missingSoundIds, missingFolderIds } = useLibraryStore.getState();
    // With the override, /new-music is the folder — sound and folder both present
    expect(missingSoundIds.size).toBe(0);
    expect(missingFolderIds.size).toBe(0);
  });

  it("marks sounds as missing when their file does not exist", async () => {
    const folder = createMockGlobalFolder({ id: "f1", path: "/music" });
    const sound = createMockSound({ id: "s1", filePath: "/music/missing.wav", folderId: "f1" });

    useAppSettingsStore.setState({
      settings: createMockAppSettings({ globalFolders: [folder] }),
    });
    useLibraryStore.setState({ sounds: [sound] });

    mockFs.exists.mockResolvedValue(false);

    await refreshMissingState();

    const { missingSoundIds, missingFolderIds } = useLibraryStore.getState();
    expect(missingSoundIds).toContain("s1");
    expect(missingFolderIds).toContain("f1");
  });

  it("clears previously stale missing ids when files become present again", async () => {
    const folder = createMockGlobalFolder({ id: "f1", path: "/music" });
    const sound = createMockSound({ id: "s1", filePath: "/music/kick.wav", folderId: "f1" });

    useAppSettingsStore.setState({
      settings: createMockAppSettings({ globalFolders: [folder] }),
    });
    // Simulate stale missing state from a prior check
    useLibraryStore.setState({
      sounds: [sound],
      missingSoundIds: new Set(["s1"]),
      missingFolderIds: new Set(["f1"]),
    });

    // Now files are present
    mockFs.exists.mockResolvedValue(true);

    await refreshMissingState();

    const { missingSoundIds, missingFolderIds } = useLibraryStore.getState();
    expect(missingSoundIds.size).toBe(0);
    expect(missingFolderIds.size).toBe(0);
  });

  it("accepts an empty globalFolders override (all-folders-removed scenario)", async () => {
    const sound = createMockSound({ id: "s1", filePath: "/music/kick.wav", folderId: "f1" });

    useAppSettingsStore.setState({
      settings: createMockAppSettings({
        globalFolders: [createMockGlobalFolder({ id: "f1", path: "/music" })],
      }),
    });
    useLibraryStore.setState({ sounds: [sound] });

    // Pass empty override — simulates all folders having been removed
    await refreshMissingState([]);

    const { missingSoundIds, missingFolderIds } = useLibraryStore.getState();
    // No folders to check against, so nothing is flagged missing
    expect(missingFolderIds.size).toBe(0);
    expect(missingSoundIds.size).toBe(0);
  });
});
