import { describe, it, expect, beforeEach } from "vitest";
import { migrateProject, CURRENT_VERSION } from "./migrations";
import { ProjectSchema } from "./schemas";
import {
  ProjectNotFoundError,
  ProjectValidationError,
  selectProjectFolder,
  validateProjectFolder,
  loadProjectFile,
  loadProjectFromPath,
  selectAndLoadProject,
  generateRandomProjectName,
  createProjectFolder,
  createProjectFile,
  createNewProject,
  saveProject,
  saveProjectAs,
  discardTemporaryProject,
  sanitizeProjectName,
  buildExportZipName,
} from "@/lib/project";
import {
  mockDialog,
  mockFs,
  mockPath,
  createMockFileSystem,
  resetTauriMocks,
} from "@/test/tauri-mocks";
import { createMockProject, createProjectJson, expectToReject } from "@/test/factories";
import { PROJECT_FILE_NAME, DEFAULT_PROJECT_VERSION, DEFAULT_PROJECT_DESCRIPTION } from "@/lib/constants";

describe("selectProjectFolder", () => {
  beforeEach(() => {
    resetTauriMocks();
  });

  it("should return selected folder path", async () => {
    mockDialog.open.mockResolvedValue("/selected/path");

    const result = await selectProjectFolder();

    expect(result).toBe("/selected/path");
    expect(mockDialog.open).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      title: "Select Project Folder",
    });
  });

  it("should return null when user cancels", async () => {
    mockDialog.open.mockResolvedValue(null);

    const result = await selectProjectFolder();

    expect(result).toBeNull();
  });

  it("should handle array return (take first element)", async () => {
    mockDialog.open.mockResolvedValue(["/first/path", "/second/path"]);

    const result = await selectProjectFolder();

    expect(result).toBe("/first/path");
  });

  it("should return null for empty array", async () => {
    mockDialog.open.mockResolvedValue([]);

    const result = await selectProjectFolder();

    expect(result).toBeNull();
  });
});

describe("validateProjectFolder", () => {
  beforeEach(() => {
    resetTauriMocks();
  });

  it("should return project file path when project.json exists", async () => {
    mockFs.exists.mockResolvedValue(true);

    const result = await validateProjectFolder("/test/path");

    expect(result).toBe("/test/path/project.json");
    expect(mockPath.join).toHaveBeenCalledWith("/test/path", PROJECT_FILE_NAME);
  });

  it("should throw ProjectNotFoundError when project.json does not exist", async () => {
    mockFs.exists.mockResolvedValue(false);

    const error = await expectToReject(
      validateProjectFolder("/test/path"),
      ProjectNotFoundError
    );

    expect(error.message).toContain("project.json not found");
  });
});

describe("loadProjectFile", () => {
  beforeEach(() => {
    resetTauriMocks();
  });

  it("should load and parse valid project file", async () => {
    const projectData = createMockProject({ name: "My Project" });
    mockFs.readTextFile.mockResolvedValue(createProjectJson(projectData));

    const result = await loadProjectFile("/test/path/project.json");

    expect(result.name).toBe("My Project");
    expect(result.version).toBe(projectData.version);
  });

  it("should throw ProjectValidationError for invalid JSON", async () => {
    mockFs.readTextFile.mockResolvedValue("invalid json {");

    const error = await expectToReject(
      loadProjectFile("/test/path/project.json"),
      ProjectValidationError
    );

    expect(error.message).toContain("Invalid JSON");
  });

  it("should throw ProjectValidationError for missing required fields", async () => {
    mockFs.readTextFile.mockResolvedValue(
      JSON.stringify({ version: "1.0.0" }) // missing 'name'
    );

    const error = await expectToReject(
      loadProjectFile("/test/path/project.json"),
      ProjectValidationError
    );

    expect(error.message).toContain("missing required fields");
  });

  it("should handle project with only name field (migrates from 0.0.0 to current version)", async () => {
    mockFs.readTextFile.mockResolvedValue(JSON.stringify({ name: "Minimal Project" }));

    const result = await loadProjectFile("/test/path/project.json");

    expect(result.name).toBe("Minimal Project");
    // Unversioned projects are migrated through the 0.0.0 → CURRENT_VERSION chain
    expect(result.version).toBe(CURRENT_VERSION);
  });

  it("should throw ProjectValidationError for project with out-of-range volume", async () => {
    // A layer's volume is constrained to [0, 100] by LayerSchema.
    // volume: 200 must produce a ZodError wrapped as ProjectValidationError.
    const invalidProject = {
      name: "Bad Volume Project",
      version: CURRENT_VERSION,
      scenes: [
        {
          id: "scene-1",
          name: "Scene 1",
          pads: [
            {
              id: "pad-1",
              name: "Pad 1",
              muteTargetPadIds: [],
              layers: [
                {
                  id: "layer-1",
                  selection: { type: "assigned", instances: [] },
                  arrangement: "simultaneous",
                  cycleMode: false,
                  playbackMode: "one-shot",
                  retriggerMode: "restart",
                  volume: 200,
                },
              ],
            },
          ],
        },
      ],
      favoritedSetIds: [],
    };
    mockFs.readTextFile.mockResolvedValue(JSON.stringify(invalidProject));

    await expectToReject(
      loadProjectFile("/test/path/project.json"),
      ProjectValidationError,
    );
  });

  it("should throw ProjectValidationError for project with negative startOffsetMs in SoundInstance", async () => {
    // SoundInstance has no durationMs field, but startOffsetMs is constrained
    // to min(0). A negative startOffsetMs must produce a ZodError wrapped as
    // ProjectValidationError.
    const invalidProject = {
      name: "Bad Offset Project",
      version: CURRENT_VERSION,
      scenes: [
        {
          id: "scene-1",
          name: "Scene 1",
          pads: [
            {
              id: "pad-1",
              name: "Pad 1",
              muteTargetPadIds: [],
              layers: [
                {
                  id: "layer-1",
                  selection: {
                    type: "assigned",
                    instances: [
                      {
                        id: "inst-1",
                        soundId: "sound-1",
                        volume: 100,
                        startOffsetMs: -1,
                      },
                    ],
                  },
                  arrangement: "simultaneous",
                  cycleMode: false,
                  playbackMode: "one-shot",
                  retriggerMode: "restart",
                  volume: 100,
                },
              ],
            },
          ],
        },
      ],
      favoritedSetIds: [],
    };
    mockFs.readTextFile.mockResolvedValue(JSON.stringify(invalidProject));

    await expectToReject(
      loadProjectFile("/test/path/project.json"),
      ProjectValidationError,
    );
  });

  it("should default scenes and favoritedSetIds to empty arrays after migration", () => {
    // Simulate a 1.0.0 project being migrated — sounds/tags/sets are stripped,
    // favoritedSetIds is added, and the schema defaults scenes to [].
    const oldProject = { name: "Old Project", version: "1.0.0", sounds: [], tags: [], sets: [] };
    const migrated = migrateProject(oldProject);
    const result = ProjectSchema.safeParse(migrated);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scenes).toEqual([]);
      expect(result.data.favoritedSetIds).toEqual([]);
      expect((result.data as Record<string, unknown>).sounds).toBeUndefined();
    }
  });
});

describe("loadProjectFromPath", () => {
  beforeEach(() => {
    resetTauriMocks();
  });

  it("should load project from valid path", async () => {
    mockFs.exists.mockResolvedValue(true);
    mockFs.readTextFile.mockResolvedValue(
      createProjectJson({ name: "Test Project" })
    );

    const result = await loadProjectFromPath("/test/path");

    expect(result.project.name).toBe("Test Project");
    expect(result.folderPath).toBe("/test/path");
  });

  it("should throw when project.json not found", async () => {
    mockFs.exists.mockResolvedValue(false);

    await expectToReject(
      loadProjectFromPath("/test/path"),
      ProjectNotFoundError
    );
  });
});

describe("selectAndLoadProject", () => {
  beforeEach(() => {
    resetTauriMocks();
  });

  it("should select and load a project", async () => {
    mockDialog.open.mockResolvedValue("/selected/path");
    mockFs.exists.mockResolvedValue(true);
    mockFs.readTextFile.mockResolvedValue(
      createProjectJson({ name: "Selected Project" })
    );

    const result = await selectAndLoadProject();

    expect(result).not.toBeNull();
    expect(result?.project.name).toBe("Selected Project");
    expect(result?.folderPath).toBe("/selected/path");
  });

  it("should return null when user cancels selection", async () => {
    mockDialog.open.mockResolvedValue(null);

    const result = await selectAndLoadProject();

    expect(result).toBeNull();
  });

  it("should throw when selected folder has no project.json", async () => {
    mockDialog.open.mockResolvedValue("/selected/path");
    mockFs.exists.mockResolvedValue(false);

    await expectToReject(selectAndLoadProject(), ProjectNotFoundError);
  });
});

describe("generateRandomProjectName", () => {
  it("should generate a unique project name", () => {
    const name1 = generateRandomProjectName();
    const name2 = generateRandomProjectName();

    expect(name1).toMatch(/^Untitled_[A-Z0-9]+_\d+$/);
    expect(name2).toMatch(/^Untitled_[A-Z0-9]+_\d+$/);
    expect(name1).not.toBe(name2);
  });

  it("should include timestamp", () => {
    const before = Date.now();
    const name = generateRandomProjectName();
    const after = Date.now();

    const timestamp = parseInt(name.split("_").pop() || "0");
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });
});

describe("sanitizeProjectName", () => {
  it("returns the name unchanged when it only has valid ASCII chars", () => {
    expect(sanitizeProjectName("MyProject")).toBe("MyProject");
    expect(sanitizeProjectName("my-project_v2")).toBe("my-project_v2");
  });

  it("replaces spaces with underscores", () => {
    expect(sanitizeProjectName("My Project")).toBe("My_Project");
  });

  it("replaces special ASCII characters with underscores", () => {
    // @ ! # $ % → 4 replacement underscores (% is the last char)
    expect(sanitizeProjectName("My@Project!#$%")).toBe("My_Project____");
  });

  it("falls back to 'project' when result is all underscores (pure non-ASCII name)", () => {
    // CJK characters all map to underscores, triggering the fallback
    expect(sanitizeProjectName("我的项目")).toBe("project");
  });

  it("falls back to 'project' when result is empty (empty string input)", () => {
    expect(sanitizeProjectName("")).toBe("project");
  });

  it("falls back to 'project' for emoji-only names", () => {
    expect(sanitizeProjectName("🎵🎶🎸")).toBe("project");
  });

  it("does NOT fall back when at least one ASCII char is present", () => {
    // Mixed: the emoji (U+1F3B5, a UTF-16 surrogate pair = 2 code units) becomes "__"
    // but 'a' survives → result is "a__", not all underscores, so no fallback
    expect(sanitizeProjectName("a🎵")).toBe("a__");
  });

  it("preserves hyphens and underscores", () => {
    expect(sanitizeProjectName("my-project_name")).toBe("my-project_name");
  });

  it("falls back to 'project' for hyphen-only or mixed hyphen/underscore names", () => {
    // A name like "---" passes the character filter unchanged, but is still useless
    // as a folder name, so the broadened fallback covers it.
    expect(sanitizeProjectName("---")).toBe("project");
    expect(sanitizeProjectName("-_-")).toBe("project");
    expect(sanitizeProjectName("___")).toBe("project");
  });

  it("falls back to 'project' for whitespace-only input", () => {
    expect(sanitizeProjectName("   ")).toBe("project");
    expect(sanitizeProjectName("\n\t")).toBe("project");
  });

  it("returns 'project' unchanged when input is already 'project' (idempotent)", () => {
    expect(sanitizeProjectName("project")).toBe("project");
  });
});

describe("buildExportZipName", () => {
  it("returns '<sanitized>-export.zip' for a normal ASCII name", () => {
    expect(buildExportZipName("MyProject")).toBe("MyProject-export.zip");
  });

  it("sanitizes the name before building the zip filename", () => {
    expect(buildExportZipName("My Project")).toBe("My_Project-export.zip");
  });

  it("falls back to 'project-export.zip' for all-non-ASCII project names", () => {
    expect(buildExportZipName("我的项目")).toBe("project-export.zip");
    expect(buildExportZipName("🎵🎶")).toBe("project-export.zip");
  });

  it("falls back to 'project-export.zip' for empty or hyphen/underscore-only names", () => {
    expect(buildExportZipName("")).toBe("project-export.zip");
    expect(buildExportZipName("---")).toBe("project-export.zip");
  });
});

describe("createProjectFolder", () => {
  beforeEach(() => {
    resetTauriMocks();
  });

  it("should create project folder in app data directory", async () => {
    await createProjectFolder("MyProject");

    expect(mockPath.appLocalDataDir).toHaveBeenCalled();
    expect(mockFs.mkdir).toHaveBeenCalledTimes(2);

    const mkdirCall = mockFs.mkdir.mock.calls[0];
    expect(mkdirCall[0]).toContain("temp_MyProject_");
    expect(mkdirCall[1]).toEqual({ recursive: true });
  });

  it("should create a sounds/ subfolder inside the project folder", async () => {
    await createProjectFolder("MyProject");

    expect(mockFs.mkdir).toHaveBeenCalledTimes(2);
    const soundsCall = mockFs.mkdir.mock.calls[1];
    expect(soundsCall[0]).toContain("sounds");
    expect(soundsCall[1]).toEqual({ recursive: true });
  });

  it("should sanitize project name", async () => {
    await createProjectFolder("My@Project!#$%");

    const mkdirCall = mockFs.mkdir.mock.calls[0];
    expect(mkdirCall[0]).toContain("temp_My_Project_____");
  });

  it("should fall back to 'project' in folder name when project name is all non-ASCII", async () => {
    await createProjectFolder("我的项目");

    const mkdirCall = mockFs.mkdir.mock.calls[0];
    expect(mkdirCall[0]).toContain("temp_project_");
  });

  it("should include timestamp in folder name", async () => {
    const before = Date.now();
    await createProjectFolder("Test");
    const after = Date.now();

    const folderPath = mockFs.mkdir.mock.calls[0][0];
    const timestamp = parseInt(folderPath.split("_").pop() || "0");

    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });
});

describe("createProjectFile", () => {
  beforeEach(() => {
    resetTauriMocks();
  });

  it("should create project.json with correct structure", async () => {
    await createProjectFile("/test/path", "My Project");

    expect(mockFs.writeTextFile).toHaveBeenCalledWith(
      "/test/path/project.json",
      expect.stringContaining('"name": "My Project"')
    );

    const writtenContent = mockFs.writeTextFile.mock.calls[0][1];
    const parsed = JSON.parse(writtenContent);

    expect(parsed.name).toBe("My Project");
    expect(parsed.version).toBe(DEFAULT_PROJECT_VERSION);
    expect(parsed.description).toBe(DEFAULT_PROJECT_DESCRIPTION);
    expect(parsed.lastSaved).toBeDefined();
  });

  it("should include lastSaved timestamp", async () => {
    const before = Date.now();
    await createProjectFile("/test/path", "Test");
    const after = Date.now();

    const writtenContent = mockFs.writeTextFile.mock.calls[0][1];
    const parsed = JSON.parse(writtenContent);
    const saved = new Date(parsed.lastSaved).getTime();

    expect(saved).toBeGreaterThanOrEqual(before);
    expect(saved).toBeLessThanOrEqual(after);
  });
});

describe("createNewProject", () => {
  beforeEach(() => {
    resetTauriMocks();
  });

  it("should create new project with given name", async () => {
    createMockFileSystem({});

    const result = await createNewProject("My New Project");

    expect(result.project.name).toBe("My New Project");
    expect(result.project.version).toBe(DEFAULT_PROJECT_VERSION);
    expect(result.folderPath).toContain("temp_My_New_Project_");
    expect(mockFs.mkdir).toHaveBeenCalled();
    expect(mockFs.writeTextFile).toHaveBeenCalled();
  });

  it("should generate random name when not provided", async () => {
    createMockFileSystem({});

    const result = await createNewProject();

    expect(result.project.name).toMatch(/^Untitled_[A-Z0-9]+_\d+$/);
  });

  it("should return loadable project", async () => {
    createMockFileSystem({});

    const result = await createNewProject("Test Project");

    expect(result.project).toBeDefined();
    expect(result.project.name).toBe("Test Project");
    expect(result.folderPath).toBeDefined();
  });
});

describe("saveProject", () => {
  beforeEach(() => {
    resetTauriMocks();
  });

  it("should save project with updated timestamp", async () => {
    const project = createMockProject({ name: "Test", lastSaved: "2020-01-01T00:00:00.000Z" });

    const before = Date.now();
    await saveProject("/test/path", project);
    const after = Date.now();

    expect(mockFs.writeTextFile).toHaveBeenCalled();

    const writtenContent = mockFs.writeTextFile.mock.calls[0][1];
    const parsed = JSON.parse(writtenContent);
    const saved = new Date(parsed.lastSaved).getTime();

    expect(saved).toBeGreaterThanOrEqual(before);
    expect(saved).toBeLessThanOrEqual(after);
  });

  it("should preserve all project fields", async () => {
    const project = createMockProject({
      name: "Full Project",
      version: "2.0.0",
      description: "A complete project",
    });

    await saveProject("/test/path", project);

    const writtenContent = mockFs.writeTextFile.mock.calls[0][1];
    const parsed = JSON.parse(writtenContent);

    expect(parsed.name).toBe("Full Project");
    expect(parsed.version).toBe("2.0.0");
    expect(parsed.description).toBe("A complete project");
  });
});

describe("saveProjectAs", () => {
  beforeEach(() => {
    resetTauriMocks();
  });

  it("should save project to new location", async () => {
    mockDialog.open.mockResolvedValue("/new/location");
    mockFs.exists.mockResolvedValue(false);
    mockFs.readDir.mockResolvedValue([]);
    const project = createMockProject({ name: "Test Project" });

    const result = await saveProjectAs("New Name", "/app-local-data/SoundsBored/temp_Test_123", project);

    expect(result).not.toBeNull();
    expect(result?.newPath).toBe("/new/location/New_Name");
    expect(result?.project.name).toBe("New Name");
    expect(mockFs.remove).toHaveBeenCalledWith("/app-local-data/SoundsBored/temp_Test_123", { recursive: true });
  });

  it("should return null when user cancels", async () => {
    mockDialog.open.mockResolvedValue(null);
    const project = createMockProject();

    const result = await saveProjectAs("Test", "/app-local-data/SoundsBored/temp_Test_123", project);

    expect(result).toBeNull();
  });

  it("should throw when folder already exists", async () => {
    mockDialog.open.mockResolvedValue("/new/location");
    // Simulate atomic mkdir failing because the directory already exists
    // (Tauri's plugin-fs surfaces this as an Error with an "os error 17"-style message).
    mockFs.mkdir.mockRejectedValueOnce(new Error("File exists (os error 17)"));
    const project = createMockProject();

    await expect(saveProjectAs("Test", "/app-local-data/SoundsBored/temp_Test_123", project)).rejects.toThrow(
      "already exists"
    );
  });

  it("should re-throw non-EEXIST mkdir errors without masking them", async () => {
    mockDialog.open.mockResolvedValue("/new/location");
    // Simulate a permission-denied error — this must NOT be surfaced as "already exists".
    mockFs.mkdir.mockRejectedValue(new Error("Permission denied (os error 13)"));
    const project = createMockProject();

    const err = await saveProjectAs(
      "Test",
      "/app-local-data/SoundsBored/temp_Test_123",
      project
    ).catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("Permission denied");
    expect((err as Error).message).not.toContain("already exists");
  });

  it("should recognise the Windows EEXIST code (os error 183) as a name collision", async () => {
    mockDialog.open.mockResolvedValue("/new/location");
    // Windows surfaces ERROR_ALREADY_EXISTS as os error 183, not 17
    mockFs.mkdir.mockRejectedValueOnce(new Error("The file exists. (os error 183)"));
    const project = createMockProject();

    await expect(
      saveProjectAs("Test", "/app-local-data/SoundsBored/temp_Test_123", project)
    ).rejects.toThrow("already exists");
  });

  it("should remove the created directory when copyDirectory fails (no orphan left)", async () => {
    mockDialog.open.mockResolvedValue("/new/location");
    // mkdir succeeds (directory created), but copy fails mid-way
    mockFs.readDir.mockRejectedValueOnce(new Error("I/O error during copy"));
    const project = createMockProject();

    await expect(
      saveProjectAs("Test", "/app-local-data/SoundsBored/temp_Test_123", project)
    ).rejects.toThrow("I/O error during copy");

    // The empty directory we created must be removed so a retry with the same name
    // doesn't immediately hit the "already exists" path. Assert the exact destination
    // path (not the source) to ensure we're cleaning up newProjectPath, not currentPath.
    expect(mockFs.remove).toHaveBeenCalledWith(
      "/new/location/Test",
      expect.objectContaining({ recursive: true })
    );
    // The source temp folder must NOT have been removed by the rollback.
    expect(mockFs.remove).not.toHaveBeenCalledWith(
      expect.stringContaining("temp_Test_123"),
      expect.objectContaining({ recursive: true })
    );
  });

  it("should sanitize folder name", async () => {
    mockDialog.open.mockResolvedValue("/new/location");
    mockFs.exists.mockResolvedValue(false);
    mockFs.readDir.mockResolvedValue([]);
    const project = createMockProject();

    const result = await saveProjectAs("My@Project!#$%", "/app-local-data/SoundsBored/temp_Test_123", project);

    expect(result?.newPath).toBe("/new/location/My_Project____");
  });

  it("should fall back to 'project' folder name when project name is all non-ASCII", async () => {
    mockDialog.open.mockResolvedValue("/new/location");
    mockFs.exists.mockResolvedValue(false);
    mockFs.readDir.mockResolvedValue([]);
    const project = createMockProject();

    const result = await saveProjectAs("我的项目", "/app-local-data/SoundsBored/temp_Test_123", project);

    expect(result?.newPath).toBe("/new/location/project");
  });

  it("should replace spaces in project name with underscores", async () => {
    mockDialog.open.mockResolvedValue("/new/location");
    mockFs.exists.mockResolvedValue(false);
    mockFs.readDir.mockResolvedValue([]);
    const project = createMockProject();

    const result = await saveProjectAs(
      "My Project",
      "/app-local-data/SoundsBored/temp_Test_123",
      project
    );

    expect(result?.newPath).toContain("My_Project");
    expect(result?.newPath).not.toContain("My Project");
  });

  it("should update lastSaved timestamp", async () => {
    mockDialog.open.mockResolvedValue("/new/location");
    mockFs.exists.mockResolvedValue(false);
    mockFs.readDir.mockResolvedValue([]);
    const project = createMockProject({ lastSaved: "2020-01-01T00:00:00.000Z" });

    const before = Date.now();
    const result = await saveProjectAs("Test", "/app-local-data/SoundsBored/temp_Test_123", project);
    const after = Date.now();

    expect(result).not.toBeNull();
    const saved = new Date(result!.project.lastSaved!).getTime();
    expect(saved).toBeGreaterThanOrEqual(before);
    expect(saved).toBeLessThanOrEqual(after);
  });
});

describe("discardTemporaryProject", () => {
  beforeEach(() => {
    resetTauriMocks();
  });

  it("should remove a folder whose path contains temp_", async () => {
    mockFs.remove.mockResolvedValue(undefined);

    await discardTemporaryProject("/app-local-data/SoundsBored/temp_MyProject_1234567890");

    expect(mockFs.remove).toHaveBeenCalledWith(
      "/app-local-data/SoundsBored/temp_MyProject_1234567890",
      { recursive: true }
    );
  });

  it("should throw if the path does not contain temp_", async () => {
    await expect(
      discardTemporaryProject("/users/zack/projects/MyProject")
    ).rejects.toThrow("Cannot discard");

    expect(mockFs.remove).not.toHaveBeenCalled();
  });

  it("should throw if the path is empty", async () => {
    await expect(
      discardTemporaryProject("")
    ).rejects.toThrow("Cannot discard");
  });

  it("should not throw if remove fails (swallows silently)", async () => {
    mockFs.remove.mockRejectedValue(new Error("Permission denied"));

    await expect(
      discardTemporaryProject("/app-local-data/SoundsBored/temp_Test_123")
    ).resolves.toBeUndefined();
  });

  it("should throw if 'temp_' appears only in a parent directory — not the folder name", async () => {
    // /Users/temp_user/MyProject passes the old includes("temp_") check but is NOT a temp folder
    await expect(
      discardTemporaryProject("/Users/temp_user/MyProject")
    ).rejects.toThrow("Cannot discard");

    expect(mockFs.remove).not.toHaveBeenCalled();
  });

  it("should throw if the folder name starts with 'temp_' but is outside the app temp root", async () => {
    // Folder name looks right but it's not in the app's data directory
    await expect(
      discardTemporaryProject("/some/other/path/temp_MyProject_123")
    ).rejects.toThrow("Cannot discard");

    expect(mockFs.remove).not.toHaveBeenCalled();
  });

  it("handles a valid temp path with a trailing separator", async () => {
    mockFs.remove.mockResolvedValue(undefined);
    // Trailing slash must not cause dirname to return the folder itself
    await discardTemporaryProject("/app-local-data/SoundsBored/temp_Test_123/");
    expect(mockFs.remove).toHaveBeenCalledWith(
      "/app-local-data/SoundsBored/temp_Test_123/",
      { recursive: true }
    );
  });

  it("handles a valid temp path with Windows-style backslash separators", async () => {
    mockFs.remove.mockResolvedValue(undefined);
    mockPath.appLocalDataDir.mockResolvedValueOnce("C:\\app-local-data");
    mockPath.join.mockImplementationOnce((...p: string[]) => p.join("\\"));
    await discardTemporaryProject("C:\\app-local-data\\SoundsBored\\temp_Test_123");
    expect(mockFs.remove).toHaveBeenCalledWith(
      "C:\\app-local-data\\SoundsBored\\temp_Test_123",
      { recursive: true }
    );
  });
});

describe("saveProjectAs — does not delete non-temp folders containing 'temp_' in path", () => {
  beforeEach(() => {
    resetTauriMocks();
  });

  it("should not delete a permanent folder whose path contains 'temp_' in a parent directory", async () => {
    // A user whose home path happens to contain "temp_" — must never be deleted
    const permanentPath = "/Users/temp_user/Projects/MySoundboard";
    mockDialog.open.mockResolvedValue("/new/location");
    mockFs.readDir.mockResolvedValue([]);
    const project = createMockProject({ name: "Test" });

    const result = await saveProjectAs("Test", permanentPath, project);

    expect(result).not.toBeNull();
    // remove() must never be called at all — no rollback needed on happy path
    // and the original permanent folder must not be touched
    expect(mockFs.remove).not.toHaveBeenCalled();
  });
});
