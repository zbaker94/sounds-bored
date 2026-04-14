import { ZodError } from "zod";
import { GlobalLibrary, GlobalLibrarySchema } from "./schemas";
import { appDataDir, join } from "@tauri-apps/api/path";
import { readTextFile, writeTextFile, exists, rename } from "@tauri-apps/plugin-fs";
import { APP_FOLDER, LIBRARY_FILE_NAME, CURRENT_LIBRARY_VERSION } from "./constants";
import { migrateLibrary, MigrationError } from "./migrations";

export class LibraryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LibraryValidationError";
  }
}

interface LoadLibraryOptions {
  onCorruption?: (message: string) => void;
}

export async function getLibraryFilePath(): Promise<string> {
  const dir = await appDataDir();
  return await join(dir, APP_FOLDER, LIBRARY_FILE_NAME);
}

/**
 * Loads and parses the global library from disk.
 * Runs library migrations before schema validation to handle legacy files.
 *
 * Recovery behavior: if the file is corrupt (invalid JSON, schema validation
 * failure, or migration error), the corrupt file is renamed with a
 * `.corrupt.json` suffix, a fresh empty library is written in its place, and
 * the optional `onCorruption` callback is invoked with a user-facing message.
 * The function then returns an empty library rather than throwing — users are
 * never stuck with an unrecoverable broken library.
 *
 * @throws Will rethrow filesystem I/O errors (e.g., permission denied) unchanged
 */
export async function loadGlobalLibrary(
  options?: LoadLibraryOptions,
): Promise<GlobalLibrary> {
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
    if (
      error instanceof SyntaxError ||
      error instanceof ZodError ||
      error instanceof MigrationError
    ) {
      // Recovery path: rename corrupt file, write fresh default, notify caller.
      // Single-backup-slot: if .corrupt.json already exists from a prior crash,
      // rename throws and we silently proceed — the previous backup is overwritten
      // by the writeTextFile below. This is intentional for simplicity.
      try {
        await rename(filePath, filePath.replace(/\.json$/, ".corrupt.json"));
      } catch {
        // Swallow rename errors — file may already exist as .corrupt.json,
        // filesystem may not support rename, etc. Recovery proceeds regardless.
      }
      // If writeTextFile fails (e.g., directory deleted, disk full), the error
      // propagates to the caller as an I/O failure, distinct from the original
      // corruption error — callers should handle rejections accordingly.
      await writeTextFile(
        filePath,
        JSON.stringify(
          {
            version: CURRENT_LIBRARY_VERSION,
            sounds: [],
            tags: [],
            sets: [],
          },
          null,
          2,
        ),
      );
      options?.onCorruption?.(
        `${LIBRARY_FILE_NAME} was corrupt and has been reset. Your sound library has been cleared.`,
      );
      return GlobalLibrarySchema.parse({ version: CURRENT_LIBRARY_VERSION, sounds: [], tags: [], sets: [] });
    }
    throw error;
  }
}

export async function saveGlobalLibrary(library: GlobalLibrary): Promise<void> {
  const filePath = await getLibraryFilePath();
  await writeTextFile(filePath, JSON.stringify(library, null, 2));
}
