import { describe, it, expect } from "vitest";
import {
  ProjectHistoryEntrySchema,
  ProjectHistorySchema,
  ProjectSchema,
  LayerSelectionSchema,
  LayerSchema,
  SoundInstanceSchema,
  PlaybackModeSchema,
  RetriggerModeSchema,
  SoundSchema,
  GlobalFolderSchema,
  AppSettingsSchema,
  GlobalLibrarySchema,
  hasFilePath,
  LayerConfigFormSchema,
  PadConfigSchema,
  PadSchema,
  TagSchema,
  SetSchema,
  DownloadProgressEventSchema,
  DownloadJobSchema,
  type ProjectHistoryEntry,
  type ProjectHistory,
  type Project,
  type Sound,
  type AppSettings,
  type GlobalLibrary,
} from "@/lib/schemas";

describe("ProjectHistoryEntrySchema", () => {
  it("should validate a valid project history entry", () => {
    const validEntry = {
      name: "Test Project",
      path: "/test/path",
      date: "2026-03-13T10:00:00.000Z",
    };

    const result = ProjectHistoryEntrySchema.safeParse(validEntry);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validEntry);
    }
  });

  it("should reject entry without name", () => {
    const invalidEntry = {
      path: "/test/path",
      date: "2026-03-13T10:00:00.000Z",
    };

    const result = ProjectHistoryEntrySchema.safeParse(invalidEntry);
    expect(result.success).toBe(false);
  });

  it("should reject entry without path", () => {
    const invalidEntry = {
      name: "Test Project",
      date: "2026-03-13T10:00:00.000Z",
    };

    const result = ProjectHistoryEntrySchema.safeParse(invalidEntry);
    expect(result.success).toBe(false);
  });

  it("should reject entry without date", () => {
    const invalidEntry = {
      name: "Test Project",
      path: "/test/path",
    };

    const result = ProjectHistoryEntrySchema.safeParse(invalidEntry);
    expect(result.success).toBe(false);
  });

  it("should reject entry with wrong types", () => {
    const invalidEntry = {
      name: 123,
      path: true,
      date: {},
    };

    const result = ProjectHistoryEntrySchema.safeParse(invalidEntry);
    expect(result.success).toBe(false);
  });
});

describe("ProjectHistorySchema", () => {
  it("should validate an empty array", () => {
    const result = ProjectHistorySchema.safeParse([]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
  });

  it("should validate an array of valid entries", () => {
    const validHistory: ProjectHistory = [
      {
        name: "Project 1",
        path: "/path/1",
        date: "2026-03-13T10:00:00.000Z",
      },
      {
        name: "Project 2",
        path: "/path/2",
        date: "2026-03-13T11:00:00.000Z",
      },
    ];

    const result = ProjectHistorySchema.safeParse(validHistory);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0].name).toBe("Project 1");
      expect(result.data[1].name).toBe("Project 2");
    }
  });

  it("should reject non-array input", () => {
    const result = ProjectHistorySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("should reject array with invalid entries", () => {
    const invalidHistory = [
      {
        name: "Valid Project",
        path: "/path/1",
        date: "2026-03-13T10:00:00.000Z",
      },
      {
        name: "Invalid Project",
        // missing path
        date: "2026-03-13T11:00:00.000Z",
      },
    ];

    const result = ProjectHistorySchema.safeParse(invalidHistory);
    expect(result.success).toBe(false);
  });
});

describe("ProjectSchema", () => {
  it("should validate a project with only required fields", () => {
    const minimalProject = {
      name: "Test Project",
    };

    const result = ProjectSchema.safeParse(minimalProject);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Test Project");
      expect(result.data.version).toBeUndefined();
      expect(result.data.description).toBeUndefined();
      expect(result.data.lastSaved).toBeUndefined();
    }
  });

  it("should validate a project with all fields", () => {
    const fullProject = {
      name: "Full Project",
      version: "2.0.0",
      description: "A complete project",
      lastSaved: "2026-03-13T10:00:00.000Z",
      scenes: [],
      favoritedSetIds: [],
    };
    const result = ProjectSchema.safeParse(fullProject);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(fullProject);
    }
  });

  it("should reject project without name", () => {
    const invalidProject = {
      version: "1.0.0",
      description: "A project without name",
    };

    const result = ProjectSchema.safeParse(invalidProject);
    expect(result.success).toBe(false);
  });

  it("should reject project with wrong types", () => {
    const invalidProject = {
      name: 123,
      version: true,
      description: [],
      lastSaved: {},
    };

    const result = ProjectSchema.safeParse(invalidProject);
    expect(result.success).toBe(false);
  });

  it("should allow optional fields to be undefined", () => {
    const project = {
      name: "Partial Project",
      version: undefined,
      description: undefined,
      lastSaved: undefined,
    };

    const result = ProjectSchema.safeParse(project);
    expect(result.success).toBe(true);
  });

  it("should validate project with version only", () => {
    const project = {
      name: "Versioned Project",
      version: "3.1.4",
    };

    const result = ProjectSchema.safeParse(project);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe("3.1.4");
    }
  });

  it("should validate project with description only", () => {
    const project = {
      name: "Described Project",
      description: "This is a description",
    };

    const result = ProjectSchema.safeParse(project);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe("This is a description");
    }
  });

  it("should validate project with lastSaved only", () => {
    const project = {
      name: "Saved Project",
      lastSaved: "2026-03-13T12:34:56.789Z",
    };

    const result = ProjectSchema.safeParse(project);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lastSaved).toBe("2026-03-13T12:34:56.789Z");
    }
  });
});

describe("ProjectSchema — domain model fields", () => {
  it("should default scenes and favoritedSetIds to empty arrays when missing", () => {
    const result = ProjectSchema.safeParse({ name: "Old Project" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scenes).toEqual([]);
      expect(result.data.favoritedSetIds).toEqual([]);
      expect((result.data as Record<string, unknown>).sounds).toBeUndefined();
      expect((result.data as Record<string, unknown>).tags).toBeUndefined();
      expect((result.data as Record<string, unknown>).sets).toBeUndefined();
    }
  });

  it("should reject LayerSelectionSchema with unknown type", () => {
    const result = LayerSelectionSchema.safeParse({ type: "unknown", foo: "bar" });
    expect(result.success).toBe(false);
  });

  it("should accept LayerSelectionSchema with assigned type", () => {
    const result = LayerSelectionSchema.safeParse({
      type: "assigned",
      instances: [{ id: "inst-1", soundId: "sound-1", volume: 100 }],
    });
    expect(result.success).toBe(true);
  });

  it("should accept LayerSelectionSchema with tag type", () => {
    const result = LayerSelectionSchema.safeParse({ type: "tag", tagIds: ["t1"], defaultVolume: 0.8 });
    expect(result.success).toBe(true);
  });

  it("should default matchMode to 'any' when not provided in tag selection", () => {
    const result = LayerSelectionSchema.safeParse({ type: "tag", tagIds: ["t1"], defaultVolume: 0.8 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveProperty("matchMode", "any");
    }
  });

  it("should accept explicit matchMode 'all' in tag selection", () => {
    const result = LayerSelectionSchema.safeParse({ type: "tag", tagIds: ["t1"], matchMode: "all", defaultVolume: 0.8 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveProperty("matchMode", "all");
    }
  });

  it("should reject invalid matchMode value in tag selection", () => {
    const result = LayerSelectionSchema.safeParse({ type: "tag", tagIds: ["t1"], matchMode: "none", defaultVolume: 0.8 });
    expect(result.success).toBe(false);
  });

  it("accepts assigned selection with empty instances array (permissive for persistence)", () => {
    const result = LayerSelectionSchema.safeParse({ type: "assigned", instances: [] });
    expect(result.success).toBe(true);
  });

  it("accepts tag selection with empty tagIds array (permissive for persistence)", () => {
    const result = LayerSelectionSchema.safeParse({ type: "tag", tagIds: [], defaultVolume: 100 });
    expect(result.success).toBe(true);
  });

  it("accepts set selection with empty setId string (permissive for persistence)", () => {
    const result = LayerSelectionSchema.safeParse({ type: "set", setId: "", defaultVolume: 100 });
    expect(result.success).toBe(true);
  });

  it("should reject invalid PlaybackMode value", () => {
    const result = PlaybackModeSchema.safeParse("invalid");
    expect(result.success).toBe(false);
  });

  it("should accept all valid RetriggerMode values", () => {
    for (const value of ["restart", "continue", "stop", "next"]) {
      expect(RetriggerModeSchema.safeParse(value).success).toBe(true);
    }
  });

  it("should round-trip a project with a full scene/pad/layer", () => {
    const raw = {
      name: "Full Project",
      scenes: [{
        id: "scene-1",
        name: "Scene 1",
        pads: [{
          id: "pad-1",
          name: "Kick",
          layers: [{
            id: "layer-1",
            selection: { type: "assigned", instances: [{ id: "si-1", soundId: "s-1", volume: 0.9 }] },
            arrangement: "simultaneous",
            playbackMode: "one-shot",
            retriggerMode: "restart",
            volume: 1.0,
          }],
          muteTargetPadIds: [],
        }],
      }],
    };
    const result = ProjectSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scenes[0].pads[0].layers[0].playbackMode).toBe("one-shot");
    }
  });
});

describe("SoundSchema — folderId", () => {
  const validSound = { id: "s1", name: "Kick", tags: [], sets: [] };

  it("should accept a sound without folderId", () => {
    expect(SoundSchema.safeParse(validSound).success).toBe(true);
  });

  it("should accept a sound with folderId", () => {
    expect(SoundSchema.safeParse({ ...validSound, folderId: "folder-1" }).success).toBe(true);
  });

  it("should accept a sound with folderId undefined", () => {
    expect(SoundSchema.safeParse({ ...validSound, folderId: undefined }).success).toBe(true);
  });
});

describe("SoundSchema — filePath validation", () => {
  const validSound = { id: "s1", name: "Kick", tags: [], sets: [] };

  it("should accept a sound with no filePath", () => {
    expect(SoundSchema.safeParse(validSound).success).toBe(true);
  });

  it("should accept an absolute Unix path", () => {
    expect(SoundSchema.safeParse({ ...validSound, filePath: "/home/user/music/kick.wav" }).success).toBe(true);
  });

  it("should accept an absolute Windows path", () => {
    expect(SoundSchema.safeParse({ ...validSound, filePath: "C:/Users/user/Music/kick.wav" }).success).toBe(true);
  });

  it("should reject a relative path (./sounds/kick.wav)", () => {
    const result = SoundSchema.safeParse({ ...validSound, filePath: "./sounds/kick.wav" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.message)).toContain("filePath must be an absolute path");
    }
  });

  it("should reject a bare filename (kick.wav)", () => {
    expect(SoundSchema.safeParse({ ...validSound, filePath: "kick.wav" }).success).toBe(false);
  });

  it("should reject a Windows relative path (sounds\\kick.wav)", () => {
    expect(SoundSchema.safeParse({ ...validSound, filePath: "sounds\\kick.wav" }).success).toBe(false);
  });

  it("should accept a Windows UNC path (\\\\server\\share\\kick.wav)", () => {
    expect(SoundSchema.safeParse({ ...validSound, filePath: "\\\\server\\share\\kick.wav" }).success).toBe(true);
  });

  it("should accept a filename containing consecutive dots not at a segment boundary (track..remastered.wav)", () => {
    expect(SoundSchema.safeParse({ ...validSound, filePath: "/music/track..remastered.wav" }).success).toBe(true);
  });

  it("should reject a path containing .. as a path segment (/music/../sounds/kick.wav)", () => {
    const result = SoundSchema.safeParse({ ...validSound, filePath: "/music/../sounds/kick.wav" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.message)).toContain(
        "filePath must not contain path traversal sequences (..)"
      );
    }
  });

  it("should reject a Unix path traversal attack (../../etc/passwd)", () => {
    expect(SoundSchema.safeParse({ ...validSound, filePath: "../../etc/passwd" }).success).toBe(false);
  });

  it("should reject a Windows backslash path traversal (..\\..\\ variant)", () => {
    expect(SoundSchema.safeParse({ ...validSound, filePath: "sounds\\..\\..\\secrets.txt" }).success).toBe(false);
  });

  it("should reject an empty string filePath", () => {
    expect(SoundSchema.safeParse({ ...validSound, filePath: "" }).success).toBe(false);
  });
});

describe("hasFilePath", () => {
  it("should return true when filePath is a non-empty string", () => {
    const sound: Sound = { id: "s1", name: "Kick", filePath: "/sounds/kick.wav", tags: [], sets: [] };
    expect(hasFilePath(sound)).toBe(true);
  });

  it("should return false when filePath is undefined", () => {
    const sound: Sound = { id: "s1", name: "Kick", tags: [], sets: [] };
    expect(hasFilePath(sound)).toBe(false);
  });

  it("should return false when filePath is empty string", () => {
    const sound: Sound = { id: "s1", name: "Kick", filePath: "", tags: [], sets: [] };
    expect(hasFilePath(sound)).toBe(false);
  });
});

describe("Type exports", () => {
  it("should infer correct types from schemas", () => {
    const entry: ProjectHistoryEntry = {
      name: "test",
      path: "/test",
      date: "2026-03-13T10:00:00.000Z",
    };
    const history: ProjectHistory = [entry];
    const project: Project = {
      name: "test",
      scenes: [],
      favoritedSetIds: [],
    };
    expect(entry).toBeDefined();
    expect(history).toBeDefined();
    expect(project).toBeDefined();
  });
});

describe("GlobalFolderSchema", () => {
  it("should accept a valid global folder", () => {
    const folder = {
      id: crypto.randomUUID(),
      path: "/music/SoundsBored",
      name: "SoundsBored",
    };
    expect(GlobalFolderSchema.safeParse(folder).success).toBe(true);
  });

  it("should reject a folder with empty path", () => {
    const folder = { id: crypto.randomUUID(), path: "", name: "Test" };
    expect(GlobalFolderSchema.safeParse(folder).success).toBe(false);
  });

  it("should reject a folder with empty name", () => {
    const folder = { id: crypto.randomUUID(), path: "/music/test", name: "" };
    expect(GlobalFolderSchema.safeParse(folder).success).toBe(false);
  });

  it("should reject a folder with invalid UUID id", () => {
    const folder = { id: "not-a-uuid", path: "/music/test", name: "Test" };
    expect(GlobalFolderSchema.safeParse(folder).success).toBe(false);
  });

  it("should accept a Windows absolute path", () => {
    const folder = { id: crypto.randomUUID(), path: "C:\\Users\\user\\Music", name: "Music" };
    expect(GlobalFolderSchema.safeParse(folder).success).toBe(true);
  });

  it("should accept a Windows UNC path", () => {
    const folder = { id: crypto.randomUUID(), path: "\\\\server\\share\\music", name: "Music" };
    expect(GlobalFolderSchema.safeParse(folder).success).toBe(true);
  });

  it("should reject a relative path", () => {
    const result = GlobalFolderSchema.safeParse({ id: crypto.randomUUID(), path: "music/samples", name: "Test" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.message)).toContain("path must be an absolute path");
    }
  });

  it("should reject a single-dot-prefixed path (./music)", () => {
    expect(GlobalFolderSchema.safeParse({ id: crypto.randomUUID(), path: "./music", name: "Test" }).success).toBe(false);
  });
});

describe("AppSettingsSchema", () => {
  const makeValidSettings = (): AppSettings => {
    const dlId = crypto.randomUUID();
    const impId = crypto.randomUUID();
    return {
      version: "1.0.0",
      globalFolders: [
        { id: dlId, path: "/music/downloads", name: "Downloads" },
        { id: impId, path: "/music/imported", name: "Imported" },
      ],
      downloadFolderId: dlId,
      importFolderId: impId,
      globalFadeDurationMs: 2000,
    };
  };

  it("should accept valid settings", () => {
    expect(AppSettingsSchema.safeParse(makeValidSettings()).success).toBe(true);
  });

  it("should default version to 1.0.0 when missing", () => {
    const settings = makeValidSettings();
    const { version: _v, ...withoutVersion } = settings;
    const result = AppSettingsSchema.safeParse(withoutVersion);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe("1.0.0");
    }
  });

  it("should reject when downloadFolderId is not a valid UUID", () => {
    const settings = { ...makeValidSettings(), downloadFolderId: "not-a-uuid" };
    expect(AppSettingsSchema.safeParse(settings).success).toBe(false);
  });

  it("should reject when globalFolders is missing", () => {
    const { globalFolders: _gf, ...withoutFolders } = makeValidSettings();
    expect(AppSettingsSchema.safeParse(withoutFolders).success).toBe(false);
  });
});

describe("GlobalLibrarySchema", () => {
  it("should accept an empty library", () => {
    const lib = { version: "1.0.0", sounds: [], tags: [], sets: [] };
    expect(GlobalLibrarySchema.safeParse(lib).success).toBe(true);
  });

  it("should default version to 1.0.0 when missing", () => {
    const lib = { sounds: [], tags: [], sets: [] };
    const result = GlobalLibrarySchema.safeParse(lib);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe("1.0.0");
    }
  });

  it("should accept a library with sounds, tags, and sets", () => {
    const lib: GlobalLibrary = {
      version: "1.0.0",
      sounds: [{ id: "s1", name: "Kick", filePath: "/music/kick.wav", tags: [], sets: [] }],
      tags: [{ id: "t1", name: "Drums" }],
      sets: [{ id: "set1", name: "My Set" }],
    };
    expect(GlobalLibrarySchema.safeParse(lib).success).toBe(true);
  });

  it("should accept a library with sounds that have folderId", () => {
    const lib: GlobalLibrary = {
      version: "1.0.0",
      sounds: [{ id: "s1", name: "Kick", filePath: "/music/kick.wav", folderId: "folder-1", tags: [], sets: [] }],
      tags: [],
      sets: [],
    };
    expect(GlobalLibrarySchema.safeParse(lib).success).toBe(true);
  });

  it("rejects a library with duplicate sound IDs and includes the offending ID and path in the error", () => {
    const lib = {
      version: "1.0.0",
      sounds: [
        { id: "s1", name: "Kick", tags: [], sets: [] },
        { id: "s1", name: "Snare", tags: [], sets: [] },
      ],
      tags: [],
      sets: [],
    };
    const result = GlobalLibrarySchema.safeParse(lib);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue.message).toContain('"s1"');
      expect(issue.path).toEqual(["sounds", 1, "id"]);
    }
  });

  it("rejects a library with duplicate tag IDs", () => {
    const lib = {
      version: "1.0.0",
      sounds: [],
      tags: [
        { id: "t1", name: "Drums" },
        { id: "t1", name: "Percussion" },
      ],
      sets: [],
    };
    const result = GlobalLibrarySchema.safeParse(lib);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["tags", 1, "id"]);
    }
  });

  it("rejects a library with duplicate set IDs", () => {
    const lib = {
      version: "1.0.0",
      sounds: [],
      tags: [],
      sets: [
        { id: "set1", name: "Set A" },
        { id: "set1", name: "Set B" },
      ],
    };
    const result = GlobalLibrarySchema.safeParse(lib);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["sets", 1, "id"]);
    }
  });

  it("reports issues for multiple collections in a single library (all superRefine checks run)", () => {
    const lib = {
      version: "1.0.0",
      sounds: [
        { id: "s1", name: "A", tags: [], sets: [] },
        { id: "s1", name: "B", tags: [], sets: [] },
      ],
      tags: [
        { id: "t1", name: "X" },
        { id: "t1", name: "Y" },
      ],
      sets: [],
    };
    const result = GlobalLibrarySchema.safeParse(lib);
    expect(result.success).toBe(false);
    if (!result.success) {
      // Both the sounds and tags duplicate checks must fire
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain("sounds");
      expect(paths).toContain("tags");
    }
  });

  it("accepts a library where all sound/tag/set IDs are unique", () => {
    const lib = {
      version: "1.0.0",
      sounds: [
        { id: "s1", name: "Kick", tags: [], sets: [] },
        { id: "s2", name: "Snare", tags: [], sets: [] },
      ],
      tags: [
        { id: "t1", name: "Drums" },
        { id: "t2", name: "Percussion" },
      ],
      sets: [
        { id: "set1", name: "Set A" },
        { id: "set2", name: "Set B" },
      ],
    };
    expect(GlobalLibrarySchema.safeParse(lib).success).toBe(true);
  });
});

describe("SoundSchema numeric field validation (#189)", () => {
  it("rejects negative durationMs", () => {
    expect(SoundSchema.safeParse({ id: "s1", name: "Test", tags: [], sets: [], durationMs: -1 }).success).toBe(false);
  });

  it("rejects NaN durationMs (rejected by base z.number() before .finite())", () => {
    expect(SoundSchema.safeParse({ id: "s1", name: "Test", tags: [], sets: [], durationMs: NaN }).success).toBe(false);
  });

  it("rejects Infinity durationMs (.finite() guards live-stream HTMLAudioElement.duration)", () => {
    expect(SoundSchema.safeParse({ id: "s1", name: "Test", tags: [], sets: [], durationMs: Infinity }).success).toBe(false);
    expect(SoundSchema.safeParse({ id: "s1", name: "Test", tags: [], sets: [], durationMs: -Infinity }).success).toBe(false);
  });

  it("accepts 0 and positive durationMs", () => {
    expect(SoundSchema.safeParse({ id: "s1", name: "Test", tags: [], sets: [], durationMs: 0 }).success).toBe(true);
    expect(SoundSchema.safeParse({ id: "s1", name: "Test", tags: [], sets: [], durationMs: 3000 }).success).toBe(true);
  });

  it("rejects negative fileSizeBytes", () => {
    expect(SoundSchema.safeParse({ id: "s1", name: "Test", tags: [], sets: [], fileSizeBytes: -1 }).success).toBe(false);
  });

  it("rejects NaN and Infinity fileSizeBytes", () => {
    expect(SoundSchema.safeParse({ id: "s1", name: "Test", tags: [], sets: [], fileSizeBytes: NaN }).success).toBe(false);
    expect(SoundSchema.safeParse({ id: "s1", name: "Test", tags: [], sets: [], fileSizeBytes: Infinity }).success).toBe(false);
  });

  it("accepts 0 and positive fileSizeBytes", () => {
    expect(SoundSchema.safeParse({ id: "s1", name: "Test", tags: [], sets: [], fileSizeBytes: 0 }).success).toBe(true);
    expect(SoundSchema.safeParse({ id: "s1", name: "Test", tags: [], sets: [], fileSizeBytes: 1024 }).success).toBe(true);
  });

  it("rejects negative startOffsetMs in SoundInstanceSchema", () => {
    expect(SoundInstanceSchema.safeParse({ id: "si1", soundId: "s1", volume: 100, startOffsetMs: -1 }).success).toBe(false);
  });

  it("rejects Infinity startOffsetMs in SoundInstanceSchema", () => {
    expect(SoundInstanceSchema.safeParse({ id: "si1", soundId: "s1", volume: 100, startOffsetMs: Infinity }).success).toBe(false);
  });

  it("accepts 0 and positive startOffsetMs in SoundInstanceSchema", () => {
    expect(SoundInstanceSchema.safeParse({ id: "si1", soundId: "s1", volume: 100, startOffsetMs: 0 }).success).toBe(true);
    expect(SoundInstanceSchema.safeParse({ id: "si1", soundId: "s1", volume: 100, startOffsetMs: 500 }).success).toBe(true);
  });
});

describe("LayerSchema.volume validation (#189)", () => {
  const baseLayer = {
    id: "l1",
    selection: { type: "assigned" as const, instances: [] },
    arrangement: "simultaneous" as const,
    cycleMode: false,
    playbackMode: "one-shot" as const,
    retriggerMode: "restart" as const,
  };

  it("accepts volume at boundaries 0 and 100", () => {
    expect(LayerSchema.safeParse({ ...baseLayer, volume: 0 }).success).toBe(true);
    expect(LayerSchema.safeParse({ ...baseLayer, volume: 100 }).success).toBe(true);
  });

  it("rejects volume below 0", () => {
    expect(LayerSchema.safeParse({ ...baseLayer, volume: -1 }).success).toBe(false);
  });

  it("rejects volume above 100", () => {
    expect(LayerSchema.safeParse({ ...baseLayer, volume: 101 }).success).toBe(false);
  });
});

describe("SoundInstanceSchema.volume validation (#189)", () => {
  const baseInstance = { id: "si1", soundId: "s1" };

  it("accepts volume at boundaries 0 and 100", () => {
    expect(SoundInstanceSchema.safeParse({ ...baseInstance, volume: 0 }).success).toBe(true);
    expect(SoundInstanceSchema.safeParse({ ...baseInstance, volume: 100 }).success).toBe(true);
  });

  it("rejects volume below 0", () => {
    expect(SoundInstanceSchema.safeParse({ ...baseInstance, volume: -1 }).success).toBe(false);
  });

  it("rejects volume above 100", () => {
    expect(SoundInstanceSchema.safeParse({ ...baseInstance, volume: 101 }).success).toBe(false);
  });
});

describe("LayerConfigFormSchema", () => {
  it("accepts a valid assigned selection", () => {
    const result = LayerConfigFormSchema.safeParse({
      id: "layer-1",
      selection: { type: "assigned", instances: [{ id: "inst-1", soundId: "sound-1", volume: 100 }] },
      arrangement: "simultaneous",
      playbackMode: "one-shot",
      retriggerMode: "restart",
      volume: 100,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid tag selection", () => {
    const result = LayerConfigFormSchema.safeParse({
      id: "layer-2",
      selection: { type: "tag", tagIds: ["tag-1"], defaultVolume: 100 },
      arrangement: "sequential",
      playbackMode: "loop",
      retriggerMode: "continue",
      volume: 80,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid set selection", () => {
    const result = LayerConfigFormSchema.safeParse({
      id: "layer-3",
      selection: { type: "set", setId: "set-1", defaultVolume: 75 },
      arrangement: "shuffled",
      playbackMode: "hold",
      retriggerMode: "stop",
      volume: 50,
    });
    expect(result.success).toBe(true);
  });

  it("rejects volume below 0", () => {
    const result = LayerConfigFormSchema.safeParse({
      id: "layer-1",
      selection: { type: "assigned", instances: [{ id: "inst-1", soundId: "sound-1", volume: 100 }] },
      arrangement: "simultaneous",
      playbackMode: "one-shot",
      retriggerMode: "restart",
      volume: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects volume above 100", () => {
    const result = LayerConfigFormSchema.safeParse({
      id: "layer-1",
      selection: { type: "assigned", instances: [{ id: "inst-1", soundId: "sound-1", volume: 100 }] },
      arrangement: "simultaneous",
      playbackMode: "one-shot",
      retriggerMode: "restart",
      volume: 101,
    });
    expect(result.success).toBe(false);
  });

  it("rejects assigned selection with empty instances array", () => {
    const result = LayerConfigFormSchema.safeParse({
      id: "layer-1",
      selection: { type: "assigned", instances: [] },
      arrangement: "simultaneous",
      playbackMode: "one-shot",
      retriggerMode: "restart",
      volume: 100,
    });
    expect(result.success).toBe(false);
  });

  it("rejects tag selection with empty tagIds array", () => {
    const result = LayerConfigFormSchema.safeParse({
      id: "layer-2",
      selection: { type: "tag", tagIds: [], defaultVolume: 100 },
      arrangement: "sequential",
      playbackMode: "loop",
      retriggerMode: "continue",
      volume: 80,
    });
    expect(result.success).toBe(false);
  });

  it("rejects set selection with empty setId string", () => {
    const result = LayerConfigFormSchema.safeParse({
      id: "layer-3",
      selection: { type: "set", setId: "", defaultVolume: 75 },
      arrangement: "shuffled",
      playbackMode: "hold",
      retriggerMode: "stop",
      volume: 50,
    });
    expect(result.success).toBe(false);
  });

  it("inherits matchMode default of 'any' from base schema in tag selection", () => {
    const result = LayerConfigFormSchema.safeParse({
      id: "layer-2",
      selection: { type: "tag", tagIds: ["tag-1"], defaultVolume: 50 },
      arrangement: "simultaneous",
      playbackMode: "one-shot",
      retriggerMode: "restart",
      volume: 100,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.selection).toHaveProperty("matchMode", "any");
    }
  });

  it("accepts explicit matchMode 'all' in tag selection via form schema", () => {
    const result = LayerConfigFormSchema.safeParse({
      id: "layer-2",
      selection: { type: "tag", tagIds: ["tag-1"], matchMode: "all", defaultVolume: 50 },
      arrangement: "simultaneous",
      playbackMode: "one-shot",
      retriggerMode: "restart",
      volume: 100,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid matchMode value in tag selection via form schema", () => {
    const result = LayerConfigFormSchema.safeParse({
      id: "layer-2",
      selection: { type: "tag", tagIds: ["tag-1"], matchMode: "none", defaultVolume: 50 },
      arrangement: "simultaneous",
      playbackMode: "one-shot",
      retriggerMode: "restart",
      volume: 100,
    });
    expect(result.success).toBe(false);
  });

  it("rejects tag selection with defaultVolume out of range via form schema", () => {
    const result = LayerConfigFormSchema.safeParse({
      id: "layer-2",
      selection: { type: "tag", tagIds: ["tag-1"], defaultVolume: 101 },
      arrangement: "simultaneous",
      playbackMode: "one-shot",
      retriggerMode: "restart",
      volume: 100,
    });
    expect(result.success).toBe(false);
  });

  it("rejects set selection with defaultVolume out of range via form schema", () => {
    const result = LayerConfigFormSchema.safeParse({
      id: "layer-3",
      selection: { type: "set", setId: "set-1", defaultVolume: -1 },
      arrangement: "shuffled",
      playbackMode: "hold",
      retriggerMode: "stop",
      volume: 50,
    });
    expect(result.success).toBe(false);
  });

  it("accepts whitespace-only setId (min(1) checks length, not trimmed content)", () => {
    // setId values come from store selections (UUIDs), not user text input,
    // so whitespace-only is not a realistic concern — documenting current behavior.
    const result = LayerConfigFormSchema.safeParse({
      id: "layer-3",
      selection: { type: "set", setId: "   ", defaultVolume: 75 },
      arrangement: "shuffled",
      playbackMode: "hold",
      retriggerMode: "stop",
      volume: 50,
    });
    expect(result.success).toBe(true);
  });
});

describe("LayerSchema — cycleMode", () => {
  const validLayer = {
    id: "layer-1",
    selection: { type: "assigned", instances: [{ id: "inst-1", soundId: "sound-1", volume: 100 }] },
    arrangement: "sequential",
    playbackMode: "one-shot",
    retriggerMode: "restart",
    volume: 1.0,
  };

  it("should default cycleMode to false when not provided", () => {
    const result = LayerSchema.safeParse(validLayer);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cycleMode).toBe(false);
    }
  });

  it("should preserve cycleMode: true when provided", () => {
    const result = LayerSchema.safeParse({ ...validLayer, cycleMode: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cycleMode).toBe(true);
    }
  });
});

describe("LayerConfigFormSchema — cycleMode", () => {
  const validFormLayer = {
    id: "layer-1",
    selection: { type: "assigned", instances: [{ id: "inst-1", soundId: "sound-1", volume: 100 }] },
    arrangement: "sequential",
    playbackMode: "one-shot",
    retriggerMode: "restart",
    volume: 100,
  };

  it("should default cycleMode to false when not provided", () => {
    const result = LayerConfigFormSchema.safeParse(validFormLayer);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cycleMode).toBe(false);
    }
  });
});

describe("PadConfigSchema", () => {
  const validLayer = {
    id: "layer-1",
    selection: {
      type: "assigned",
      instances: [{ id: "inst-1", soundId: "sound-1", volume: 100 }],
    },
    arrangement: "simultaneous",
    playbackMode: "one-shot",
    retriggerMode: "restart",
    volume: 100,
  };

  it("accepts a valid pad config", () => {
    const result = PadConfigSchema.safeParse({ name: "My Pad", layers: [validLayer] });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = PadConfigSchema.safeParse({ name: "", layer: validLayer });
    expect(result.success).toBe(false);
  });

  it("rejects missing name", () => {
    const result = PadConfigSchema.safeParse({ layer: validLayer });
    expect(result.success).toBe(false);
  });
});

describe("PadSchema — color field", () => {
  const basePad = {
    id: "pad-1",
    name: "Kick",
    layers: [],
    muteTargetPadIds: [],
  };

  it("accepts a valid 6-digit hex color", () => {
    const result = PadSchema.safeParse({ ...basePad, color: "#a1b2c3" });
    expect(result.success).toBe(true);
  });

  it("accepts uppercase hex color", () => {
    const result = PadSchema.safeParse({ ...basePad, color: "#FF0000" });
    expect(result.success).toBe(true);
  });

  it("accepts a pad with no color", () => {
    const result = PadSchema.safeParse(basePad);
    expect(result.success).toBe(true);
  });

  it("rejects a 3-digit shorthand hex color", () => {
    const result = PadSchema.safeParse({ ...basePad, color: "#fff" });
    expect(result.success).toBe(false);
  });

  it("rejects a CSS named color", () => {
    const result = PadSchema.safeParse({ ...basePad, color: "red" });
    expect(result.success).toBe(false);
  });

  it("rejects an rgb() value", () => {
    const result = PadSchema.safeParse({ ...basePad, color: "rgb(255,0,0)" });
    expect(result.success).toBe(false);
  });

  it("rejects an 8-digit hex (with alpha)", () => {
    const result = PadSchema.safeParse({ ...basePad, color: "#FF0000FF" });
    expect(result.success).toBe(false);
  });

  it("rejects a hex color without # prefix", () => {
    const result = PadSchema.safeParse({ ...basePad, color: "FF0000" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty string color", () => {
    const result = PadSchema.safeParse({ ...basePad, color: "" });
    expect(result.success).toBe(false);
  });

  it("rejects null color", () => {
    const result = PadSchema.safeParse({ ...basePad, color: null });
    expect(result.success).toBe(false);
  });

  it("accepts mixed-case hex color", () => {
    const result = PadSchema.safeParse({ ...basePad, color: "#aAbBcC" });
    expect(result.success).toBe(true);
  });

  it("accepts #000000", () => {
    const result = PadSchema.safeParse({ ...basePad, color: "#000000" });
    expect(result.success).toBe(true);
  });
});

describe("PadSchema — color field round-trip via ProjectSchema", () => {
  it("round-trips a project with a pad color through ProjectSchema", () => {
    const raw = {
      name: "Color Project",
      scenes: [
        {
          id: "scene-1",
          name: "Scene 1",
          pads: [
            {
              id: "pad-1",
              name: "Kick",
              color: "#FF5500",
              layers: [],
              muteTargetPadIds: [],
            },
          ],
        },
      ],
    };
    const result = ProjectSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scenes[0].pads[0].color).toBe("#FF5500");
    }
  });

  it("round-trips a project with a pad that has no color", () => {
    const raw = {
      name: "No Color Project",
      scenes: [
        {
          id: "scene-1",
          name: "Scene 1",
          pads: [{ id: "pad-1", name: "Kick", layers: [], muteTargetPadIds: [] }],
        },
      ],
    };
    const result = ProjectSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scenes[0].pads[0].color).toBeUndefined();
    }
  });

  it("rejects a project with an invalid pad color through ProjectSchema", () => {
    const raw = {
      name: "Bad Color Project",
      scenes: [
        {
          id: "scene-1",
          name: "Scene 1",
          pads: [
            {
              id: "pad-1",
              name: "Kick",
              color: "red",
              layers: [],
              muteTargetPadIds: [],
            },
          ],
        },
      ],
    };
    const result = ProjectSchema.safeParse(raw);
    expect(result.success).toBe(false);
  });
});

describe("PadSchema — icon field", () => {
  const basePad = {
    id: "pad-1",
    name: "Kick",
    layers: [],
    muteTargetPadIds: [],
  };

  it("accepts a pad with no icon", () => {
    const result = PadSchema.safeParse(basePad);
    expect(result.success).toBe(true);
  });

  it("accepts a PascalCase icon identifier", () => {
    const result = PadSchema.safeParse({ ...basePad, icon: "Loading03Icon" });
    expect(result.success).toBe(true);
  });

  it("accepts an icon identifier starting with uppercase", () => {
    const result = PadSchema.safeParse({ ...basePad, icon: "Cancel01Icon" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty string icon", () => {
    const result = PadSchema.safeParse({ ...basePad, icon: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a whitespace-only icon", () => {
    const result = PadSchema.safeParse({ ...basePad, icon: "   " });
    expect(result.success).toBe(false);
  });

  it("rejects an icon starting with a digit", () => {
    const result = PadSchema.safeParse({ ...basePad, icon: "3dIcon" });
    expect(result.success).toBe(false);
  });

  it("rejects an icon with spaces", () => {
    const result = PadSchema.safeParse({ ...basePad, icon: "some icon" });
    expect(result.success).toBe(false);
  });

  it("rejects an icon exceeding 64 characters", () => {
    const result = PadSchema.safeParse({ ...basePad, icon: "A".repeat(65) });
    expect(result.success).toBe(false);
  });

  it("rejects null icon", () => {
    const result = PadSchema.safeParse({ ...basePad, icon: null });
    expect(result.success).toBe(false);
  });

  it("rejects a non-string icon", () => {
    const result = PadSchema.safeParse({ ...basePad, icon: 42 });
    expect(result.success).toBe(false);
  });
});

describe("DownloadProgressEventSchema — percent validation", () => {
  const baseEvent = {
    id: "job-1",
    status: "downloading",
  };

  it("accepts percent = 0", () => {
    expect(DownloadProgressEventSchema.safeParse({ ...baseEvent, percent: 0 }).success).toBe(true);
  });

  it("accepts percent = 42", () => {
    expect(DownloadProgressEventSchema.safeParse({ ...baseEvent, percent: 42 }).success).toBe(true);
  });

  it("accepts percent = 100", () => {
    expect(DownloadProgressEventSchema.safeParse({ ...baseEvent, percent: 100 }).success).toBe(true);
  });

  it("rejects percent = -1 (negative)", () => {
    expect(DownloadProgressEventSchema.safeParse({ ...baseEvent, percent: -1 }).success).toBe(false);
  });

  it("rejects percent = 100.1 (above 100)", () => {
    expect(DownloadProgressEventSchema.safeParse({ ...baseEvent, percent: 100.1 }).success).toBe(false);
  });

  it("rejects percent = 150 (out of range)", () => {
    expect(DownloadProgressEventSchema.safeParse({ ...baseEvent, percent: 150 }).success).toBe(false);
  });

  it("rejects percent = Infinity", () => {
    expect(DownloadProgressEventSchema.safeParse({ ...baseEvent, percent: Infinity }).success).toBe(false);
  });

  it("rejects percent = -Infinity", () => {
    expect(DownloadProgressEventSchema.safeParse({ ...baseEvent, percent: -Infinity }).success).toBe(false);
  });

  it("rejects percent = NaN", () => {
    expect(DownloadProgressEventSchema.safeParse({ ...baseEvent, percent: NaN }).success).toBe(false);
  });
});

describe("DownloadJobSchema — url validation", () => {
  const baseJob = {
    id: "job-1",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    outputName: "never-gonna-give-you-up",
    status: "queued",
    percent: 0,
    tags: [],
    sets: [],
  };

  it("accepts an https URL", () => {
    expect(DownloadJobSchema.safeParse(baseJob).success).toBe(true);
  });

  it("accepts an http URL", () => {
    expect(DownloadJobSchema.safeParse({ ...baseJob, url: "http://example.com/audio.mp3" }).success).toBe(true);
  });

  it("rejects an ftp URL", () => {
    const result = DownloadJobSchema.safeParse({ ...baseJob, url: "ftp://files.example.com/audio.wav" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.message)).toContain("URL must use http or https protocol");
    }
  });

  it("rejects a data URL", () => {
    expect(DownloadJobSchema.safeParse({ ...baseJob, url: "data:text/html,hello" }).success).toBe(false);
  });

  it("rejects a bare non-URL string", () => {
    expect(DownloadJobSchema.safeParse({ ...baseJob, url: "not-a-url" }).success).toBe(false);
  });
});

describe("DownloadJobSchema — outputPath validation", () => {
  const baseJob = {
    id: "job-1",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    outputName: "track",
    status: "completed",
    percent: 100,
    tags: [],
    sets: [],
  };

  it("accepts when outputPath is absent", () => {
    expect(DownloadJobSchema.safeParse(baseJob).success).toBe(true);
  });

  it("accepts an absolute Unix path", () => {
    expect(DownloadJobSchema.safeParse({ ...baseJob, outputPath: "/home/user/sounds/track.mp3" }).success).toBe(true);
  });

  it("accepts an absolute Windows path", () => {
    expect(DownloadJobSchema.safeParse({ ...baseJob, outputPath: "C:\\Users\\user\\sounds\\track.mp3" }).success).toBe(true);
  });

  it("rejects a traversal path", () => {
    const result = DownloadJobSchema.safeParse({ ...baseJob, outputPath: "/home/user/../../../etc/passwd" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.message)).toContain("outputPath must not contain path traversal sequences (..)");
    }
  });

  it("rejects a relative path", () => {
    const result = DownloadJobSchema.safeParse({ ...baseJob, outputPath: "sounds/track.mp3" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.message)).toContain("outputPath must be an absolute path");
    }
  });
});

describe("DownloadProgressEventSchema — outputPath validation", () => {
  const baseEvent = {
    id: "job-1",
    percent: 100,
    status: "completed",
  };

  it("accepts when outputPath is absent", () => {
    expect(DownloadProgressEventSchema.safeParse(baseEvent).success).toBe(true);
  });

  it("accepts an absolute Unix path", () => {
    expect(DownloadProgressEventSchema.safeParse({ ...baseEvent, outputPath: "/home/user/sounds/track.mp3" }).success).toBe(true);
  });

  it("accepts an absolute Windows path", () => {
    expect(DownloadProgressEventSchema.safeParse({ ...baseEvent, outputPath: "C:/Users/user/sounds/track.mp3" }).success).toBe(true);
  });

  it("rejects a traversal path", () => {
    const result = DownloadProgressEventSchema.safeParse({ ...baseEvent, outputPath: "/home/user/../../etc/passwd" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.message)).toContain("outputPath must not contain path traversal sequences (..)");
    }
  });

  it("rejects a relative path", () => {
    const result = DownloadProgressEventSchema.safeParse({ ...baseEvent, outputPath: "sounds/track.mp3" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.message)).toContain("outputPath must be an absolute path");
    }
  });
});

describe("TagSchema", () => {
  it("accepts a valid tag", () => {
    const result = TagSchema.safeParse({ id: "t1", name: "drums" });
    expect(result.success).toBe(true);
  });

  it("rejects a tag with an empty name", () => {
    const result = TagSchema.safeParse({ id: "t1", name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a tag name longer than 100 characters", () => {
    const result = TagSchema.safeParse({ id: "t1", name: "a".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("accepts a tag name of exactly 100 characters", () => {
    const result = TagSchema.safeParse({ id: "t1", name: "a".repeat(100) });
    expect(result.success).toBe(true);
  });

  it('rejects a tag whose id is the LibraryItemPicker sentinel "__create__"', () => {
    const result = TagSchema.safeParse({ id: "__create__", name: "drums" });
    expect(result.success).toBe(false);
  });

  it('rejects any tag id starting with "__"', () => {
    const result = TagSchema.safeParse({ id: "__reserved", name: "drums" });
    expect(result.success).toBe(false);
  });

  it("accepts a tag id that contains but does not start with double-underscore", () => {
    const result = TagSchema.safeParse({ id: "tag__1", name: "drums" });
    expect(result.success).toBe(true);
  });
});

describe("SetSchema", () => {
  it("accepts a valid set with id and name", () => {
    const result = SetSchema.safeParse({ id: "set-1", name: "My Set" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe("set-1");
      expect(result.data.name).toBe("My Set");
    }
  });

  it("rejects a set with an empty name", () => {
    const result = SetSchema.safeParse({ id: "set-1", name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a set name longer than 100 characters", () => {
    const result = SetSchema.safeParse({ id: "set-1", name: "a".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("accepts a set name of exactly 100 characters", () => {
    const result = SetSchema.safeParse({ id: "set-1", name: "a".repeat(100) });
    expect(result.success).toBe(true);
  });

  it("rejects a set without id", () => {
    const result = SetSchema.safeParse({ name: "My Set" });
    expect(result.success).toBe(false);
  });

  it("rejects a set without name", () => {
    const result = SetSchema.safeParse({ id: "set-1" });
    expect(result.success).toBe(false);
  });

  it("strips extra fields by default", () => {
    const result = SetSchema.safeParse({
      id: "set-1",
      name: "My Set",
      unexpected: "extra",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // Zod's default behavior strips unknown fields
      expect((result.data as Record<string, unknown>).unexpected).toBeUndefined();
      expect(result.data).toEqual({ id: "set-1", name: "My Set" });
    }
  });

  it("rejects a set with non-string id", () => {
    const result = SetSchema.safeParse({ id: 123, name: "My Set" });
    expect(result.success).toBe(false);
  });

  it("rejects a set with non-string name", () => {
    const result = SetSchema.safeParse({ id: "set-1", name: 42 });
    expect(result.success).toBe(false);
  });

  // Whitespace-only names pass .min(1) since Zod checks length not content —
  // same behavior as TagSchema (no .trim()). UI enforces meaningful names.
  it("accepts a whitespace-only name (matches TagSchema convention — no trim)", () => {
    const result = SetSchema.safeParse({ id: "set-1", name: " " });
    expect(result.success).toBe(true);
  });

  it('rejects a set whose id is the LibraryItemPicker sentinel "__create__"', () => {
    const result = SetSchema.safeParse({ id: "__create__", name: "My Set" });
    expect(result.success).toBe(false);
  });

  it('rejects any set id starting with "__"', () => {
    const result = SetSchema.safeParse({ id: "__reserved", name: "My Set" });
    expect(result.success).toBe(false);
  });

  it("accepts a set id that contains but does not start with double-underscore", () => {
    const result = SetSchema.safeParse({ id: "set__1", name: "My Set" });
    expect(result.success).toBe(true);
  });
});
