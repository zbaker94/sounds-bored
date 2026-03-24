import { describe, it, expect } from "vitest";
import {
  ProjectHistoryEntrySchema,
  ProjectHistorySchema,
  ProjectSchema,
  LayerSelectionSchema,
  PlaybackModeSchema,
  RetriggerModeSchema,
  SoundSchema,
  GlobalFolderSchema,
  AppSettingsSchema,
  GlobalLibrarySchema,
  hasFilePath,
  LayerConfigFormSchema,
  PadConfigSchema,
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
    const result = LayerSelectionSchema.safeParse({ type: "assigned", instances: [] });
    expect(result.success).toBe(true);
  });

  it("should accept LayerSelectionSchema with tag type", () => {
    const result = LayerSelectionSchema.safeParse({ type: "tag", tagId: "t1", defaultVolume: 0.8 });
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

  it("should accept a path containing ..", () => {
    // filePath is now just a non-empty string — path validation is filesystem-level
    expect(SoundSchema.safeParse({ ...validSound, filePath: "/music/../sounds/kick.wav" }).success).toBe(true);
  });

  it("should reject an empty string filePath", () => {
    expect(SoundSchema.safeParse({ ...validSound, filePath: "" }).success).toBe(false);
  });
});

describe("hasFilePath", () => {
  it("should return true when filePath is a non-empty string", () => {
    const sound: Sound = { id: "s1", name: "Kick", filePath: "sounds/kick.wav", tags: [], sets: [] };
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
});

describe("LayerConfigFormSchema", () => {
  it("accepts a valid assigned selection", () => {
    const result = LayerConfigFormSchema.safeParse({
      selection: { type: "assigned", instances: [] },
      arrangement: "simultaneous",
      playbackMode: "one-shot",
      retriggerMode: "restart",
      volume: 100,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid tag selection", () => {
    const result = LayerConfigFormSchema.safeParse({
      selection: { type: "tag", tagId: "tag-1", defaultVolume: 100 },
      arrangement: "sequential",
      playbackMode: "loop",
      retriggerMode: "continue",
      volume: 80,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid set selection", () => {
    const result = LayerConfigFormSchema.safeParse({
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
      selection: { type: "assigned", instances: [] },
      arrangement: "simultaneous",
      playbackMode: "one-shot",
      retriggerMode: "restart",
      volume: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects volume above 100", () => {
    const result = LayerConfigFormSchema.safeParse({
      selection: { type: "assigned", instances: [] },
      arrangement: "simultaneous",
      playbackMode: "one-shot",
      retriggerMode: "restart",
      volume: 101,
    });
    expect(result.success).toBe(false);
  });
});

describe("PadConfigSchema", () => {
  const validLayer = {
    selection: { type: "assigned", instances: [] },
    arrangement: "simultaneous",
    playbackMode: "one-shot",
    retriggerMode: "restart",
    volume: 100,
  };

  it("accepts a valid pad config", () => {
    const result = PadConfigSchema.safeParse({ name: "My Pad", layer: validLayer });
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
