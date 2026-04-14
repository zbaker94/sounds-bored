import { open } from "@tauri-apps/plugin-dialog";
import { exists, readTextFile, writeTextFile, mkdir, readDir, copyFile, remove } from "@tauri-apps/plugin-fs";
import { join, appLocalDataDir } from "@tauri-apps/api/path";
import { ZodError } from "zod";
import { Project, ProjectSchema } from "./schemas";
import { APP_FOLDER, PROJECT_FILE_NAME, DEFAULT_PROJECT_VERSION, DEFAULT_PROJECT_DESCRIPTION, SOUNDS_SUBFOLDER } from "./constants";
import { migrateProject, MigrationError } from "./migrations";

export class ProjectNotFoundError extends Error {
  constructor() {
    super(`${PROJECT_FILE_NAME} not found in the selected folder`);
    this.name = "ProjectNotFoundError";
  }
}

export class ProjectValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectValidationError";
  }
}

/**
 * Opens a native folder picker dialog
 * @returns The selected folder path, or null if cancelled
 */
export async function selectProjectFolder(): Promise<string | null> {
  const selectedPath = await open({
    directory: true,
    multiple: false,
    title: "Select Project Folder",
  });

  // selectedPath can be a string, string[], or null
  if (Array.isArray(selectedPath)) {
    return selectedPath[0] || null;
  }

  return selectedPath;
}

/**
 * Validates that a project.json file exists in the given folder
 * @param folderPath - The folder path to check
 * @returns The path to the project.json file
 * @throws {ProjectNotFoundError} If project.json doesn't exist
 */
export async function validateProjectFolder(
  folderPath: string
): Promise<string> {
  const projectFilePath = await join(folderPath, PROJECT_FILE_NAME);
  const fileExists = await exists(projectFilePath);

  if (!fileExists) {
    throw new ProjectNotFoundError();
  }

  return projectFilePath;
}

/**
 * Loads and parses the project.json file
 * @param projectFilePath - The path to the project.json file
 * @returns The parsed project data
 * @throws {ProjectValidationError} If the project.json is invalid
 */
export async function loadProjectFile(
  projectFilePath: string
): Promise<Project> {
  try {
    const fileContent = await readTextFile(projectFilePath);
    const raw = JSON.parse(fileContent);
    const migrated = migrateProject(raw);
    return ProjectSchema.parse(migrated);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ProjectValidationError(`Invalid JSON in ${PROJECT_FILE_NAME}`);
    }
    if (error instanceof ZodError) {
      throw new ProjectValidationError(
        `${PROJECT_FILE_NAME} is missing required fields`
      );
    }
    if (error instanceof MigrationError) {
      throw new ProjectValidationError(error.message);
    }
    throw error;
  }
}

/**
 * Loads a project from a specific folder path
 * @param folderPath - The folder path to load from
 * @returns An object containing the project data and folder path
 * @throws {ProjectNotFoundError} If no project.json found
 * @throws {ProjectValidationError} If project.json is invalid
 */
export async function loadProjectFromPath(folderPath: string): Promise<{
  project: Project;
  folderPath: string;
}> {
  const projectFilePath = await validateProjectFolder(folderPath);
  const project = await loadProjectFile(projectFilePath);

  return {
    project,
    folderPath,
  };
}

/**
 * Complete flow to select and load a project
 * @returns An object containing the project data and folder path
 * @throws {ProjectNotFoundError} If no project.json found
 * @throws {ProjectValidationError} If project.json is invalid
 */
export async function selectAndLoadProject(): Promise<{
  project: Project;
  folderPath: string;
} | null> {
  const folderPath = await selectProjectFolder();

  if (!folderPath) {
    return null; // User cancelled
  }

  return loadProjectFromPath(folderPath);
}

/**
 * Generates a random project name
 * @returns A random project name like "Project_1234567890"
 */
export function generateRandomProjectName(): string {
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `Untitled_${randomId}_${timestamp}`;
}

/**
 * Creates a new project folder in the app's local data directory
 * @param projectName - The name of the project
 * @returns The path to the created project folder
 */
export async function createProjectFolder(projectName: string): Promise<string> {
  const appDataDir = await appLocalDataDir();
  const timestamp = Date.now();
  const sanitizedName = projectName.replace(/[^a-zA-Z0-9-_]/g, "_");
  const folderName = `temp_${sanitizedName}_${timestamp}`;
  const projectPath = await join(appDataDir, APP_FOLDER, folderName);

  await mkdir(projectPath, { recursive: true });
  await mkdir(await join(projectPath, SOUNDS_SUBFOLDER), { recursive: true });

  return projectPath;
}

/**
 * Creates a project.json file in the specified folder
 * @param folderPath - The folder path where project.json will be created
 * @param projectName - The name of the project
 */
export async function createProjectFile(
  folderPath: string,
  projectName: string
): Promise<Project> {
  const projectFilePath = await join(folderPath, PROJECT_FILE_NAME);

  const projectData: Project = {
    name: projectName,
    version: DEFAULT_PROJECT_VERSION,
    description: DEFAULT_PROJECT_DESCRIPTION,
    lastSaved: new Date().toISOString(),
    scenes: [],
    favoritedSetIds: [],
  };

  await writeTextFile(projectFilePath, JSON.stringify(projectData, null, 2));
  return projectData;
}

/**
 * Creates a new project with a folder and project.json file
 * @param projectName - Optional name of the new project. If not provided, generates a random name
 * @returns An object containing the project data and folder path
 */
export async function createNewProject(projectName?: string): Promise<{
  project: Project;
  folderPath: string;
}> {
  const name = projectName || generateRandomProjectName();
  const folderPath = await createProjectFolder(name);
  const project = await createProjectFile(folderPath, name);

  return {
    project,
    folderPath,
  };
}

/**
 * Saves the current project data to project.json
 * Automatically updates the lastSaved timestamp
 * @param folderPath - The project folder path
 * @param project - The project data to save
 */
export async function saveProject(
  folderPath: string,
  project: Project
): Promise<Project> {
  const projectFilePath = await join(folderPath, PROJECT_FILE_NAME);
  const projectWithTimestamp: Project = {
    ...project,
    lastSaved: new Date().toISOString(),
  };
  await writeTextFile(projectFilePath, JSON.stringify(projectWithTimestamp, null, 2));
  return projectWithTimestamp;
}

/**
 * Recursively copies a directory
 * @param sourcePath - Source directory path
 * @param destPath - Destination directory path
 */
async function copyDirectory(sourcePath: string, destPath: string): Promise<void> {
  await mkdir(destPath, { recursive: true });

  const entries = await readDir(sourcePath);

  for (const entry of entries) {
    const sourceEntryPath = await join(sourcePath, entry.name);
    const destEntryPath = await join(destPath, entry.name);

    if (entry.isDirectory) {
      await copyDirectory(sourceEntryPath, destEntryPath);
    } else {
      await copyFile(sourceEntryPath, destEntryPath);
    }
  }
}

/**
 * Opens a save dialog to select a permanent location for the project
 * @param projectName - The name of the project
 * @param currentPath - The current temporary path of the project
 * @returns An object with the new folder path and updated project data, or null if cancelled
 */
export async function saveProjectAs(
  projectName: string,
  currentPath: string,
  project: Project
): Promise<{ newPath: string; project: Project } | null> {
  // Open folder picker for the parent directory
  const selectedPath = await open({
    directory: true,
    multiple: false,
    title: "Select Save Location",
  });

  if (!selectedPath || Array.isArray(selectedPath)) {
    return null; // User cancelled
  }

  // Create the project folder in the selected location
  const sanitizedName = projectName.replace(/[^a-zA-Z0-9-_]/g, "_");
  const newProjectPath = await join(selectedPath, sanitizedName);

  // Create-or-fail: mkdir with { recursive: false } atomically fails if the folder
  // already exists, eliminating the TOCTOU window that the previous exists()-then-copy
  // pattern had. The overall copy is still not transactional — see the rollback block below.
  try {
    await mkdir(newProjectPath, { recursive: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    // Match EEXIST across platforms:
    //   Unix/macOS:  "already exists" or "os error 17" (EEXIST = 17)
    //   Windows:     "os error 183" (ERROR_ALREADY_EXISTS) or "already exists" in English
    if (
      msg.includes("already exists") ||
      msg.includes("eexist") ||
      msg.includes("os error 17") ||
      msg.includes("os error 183")
    ) {
      throw new Error(`A folder named "${sanitizedName}" already exists in the selected location.`);
    }
    // Permission denied, disk full, etc. — surface the original error as-is.
    throw err;
  }

  // Copy and save inside a try/catch so we can roll back the empty directory we just
  // created if something goes wrong. Without rollback, a failed copy would leave a
  // stale empty folder that blocks future Save As attempts with the same name.
  // IMPORTANT: Keep discardTemporaryProject OUTSIDE this block — if the save succeeded
  // but cleanup throws, we must NOT roll back the successfully-written project.
  let savedProject: Awaited<ReturnType<typeof saveProject>>;
  try {
    // Copy the entire project folder to the new location. The destination directory
    // already exists (we just created it); copyDirectory's internal mkdir call uses
    // { recursive: true } and is a no-op on an existing directory.
    await copyDirectory(currentPath, newProjectPath);

    // Update the project.json with the new name and save timestamp
    savedProject = await saveProject(newProjectPath, { ...project, name: projectName });
  } catch (err) {
    // Best-effort cleanup of the directory we created. Ignore removal errors —
    // there's nothing useful to do if cleanup itself fails, and we must still
    // surface the original copy/save error to the caller.
    try { await remove(newProjectPath, { recursive: true }); } catch { /* ignore */ }
    throw err;
  }

  // Temp-folder cleanup is outside the rollback scope: by this point the new project
  // has been successfully written, so any failure here must not undo it.
  if (currentPath.includes("temp_")) {
    await discardTemporaryProject(currentPath);
  }

  return {
    newPath: newProjectPath,
    project: savedProject,
  };
}

/**
 * Safely removes a temporary project folder.
 * Only deletes folders whose path contains "temp_" as a safety guard against
 * accidentally deleting user project folders.
 * Swallows removal errors (logs a warning) — callers should not fail if cleanup fails.
 *
 * @throws {Error} If the path does not appear to be a temporary folder
 */
export async function discardTemporaryProject(folderPath: string): Promise<void> {
  if (!folderPath || !folderPath.includes("temp_")) {
    throw new Error(
      `Cannot discard folder — path does not appear to be a temporary project: "${folderPath}"`
    );
  }

  try {
    await remove(folderPath, { recursive: true });
  } catch {
    // Silently swallow — temp folder cleanup failure is non-critical
  }
}

