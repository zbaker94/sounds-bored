import { ZodError } from "zod";
import { GlobalLibrary, GlobalLibrarySchema } from "./schemas";
import { appDataDir, join } from "@tauri-apps/api/path";
import { readTextFile, writeTextFile, exists } from "@tauri-apps/plugin-fs";
import { APP_FOLDER, LIBRARY_FILE_NAME } from "./constants";
import { migrateLibrary, MigrationError } from "./migrations";

export class LibraryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LibraryValidationError";
  }
}

export async function getLibraryFilePath(): Promise<string> {
  const dir = await appDataDir();
  return await join(dir, APP_FOLDER, LIBRARY_FILE_NAME);
}

/**
 * Loads and parses the global library from disk.
 * Runs library migrations before schema validation to handle legacy files.
 * @throws {LibraryValidationError} for JSON parse errors, schema validation failures, and migration errors
 * @throws Will rethrow filesystem I/O errors (e.g., permission denied) unchanged
 */
export async function loadGlobalLibrary(): Promise<GlobalLibrary> {
  const filePath = await getLibraryFilePath();

  if (!(await exists(filePath))) {
    return GlobalLibrarySchema.parse({ sounds: [], tags: [], sets: [] });
  }

  try {
    const text = await readTextFile(filePath);
    const parsed = JSON.parse(text);
    const migrated = migrateLibrary(parsed);
    return GlobalLibrarySchema.parse(migrated);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new LibraryValidationError(`Invalid JSON in ${LIBRARY_FILE_NAME}`);
    }
    if (error instanceof ZodError) {
      throw new LibraryValidationError(
        `${LIBRARY_FILE_NAME} contains invalid data`
      );
    }
    if (error instanceof MigrationError) {
      throw new LibraryValidationError(error.message);
    }
    throw error;
  }
}

export async function saveGlobalLibrary(library: GlobalLibrary): Promise<void> {
  const filePath = await getLibraryFilePath();
  await writeTextFile(filePath, JSON.stringify(library, null, 2));
}
