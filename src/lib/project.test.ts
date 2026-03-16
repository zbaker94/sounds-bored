import { describe, it, expect, beforeEach, vi } from "vitest";
import { migrateProject } from "./migrations";
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

  it("should handle project with only name field", async () => {
    mockFs.readTextFile.mockResolvedValue(JSON.stringify({ name: "Minimal Project" }));

    const result = await loadProjectFile("/test/path/project.json");

    expect(result.name).toBe("Minimal Project");
    expect(result.version).toBeUndefined();
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
    mockFs.exists.mockResolvedValue(true);
    const project = createMockProject();

    await expect(saveProjectAs("Test", "/app-local-data/SoundsBored/temp_Test_123", project)).rejects.toThrow(
      "already exists"
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

  it("should not throw if remove fails (swallows and warns)", async () => {
    mockFs.remove.mockRejectedValue(new Error("Permission denied"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      discardTemporaryProject("/app-local-data/SoundsBored/temp_Test_123")
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
