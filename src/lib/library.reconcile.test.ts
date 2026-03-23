import { describe, it, expect, beforeEach } from "vitest";
import { reconcileGlobalLibrary } from "./library.reconcile";
import { mockFs, mockPath } from "@/test/tauri-mocks";
import { createMockGlobalFolder } from "@/test/factories";
import { Sound } from "./schemas";

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
    mockPath.join.mockImplementation((...paths: string[]) => Promise.resolve(paths.join("/")));

    // Default: all paths exist (folders and files)
    mockFs.exists.mockResolvedValue(true);
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
      });

      mockReadDir({ "/music": [fileEntry("kick.wav")] });

      const result = await reconcileGlobalLibrary([folder], [existingSound]);

      expect(result.changed).toBe(false);
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
