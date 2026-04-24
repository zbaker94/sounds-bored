import { ZodError } from "zod";
import { GlobalLibrary, GlobalLibrarySchema } from "./schemas";
import { appDataDir, join } from "@tauri-apps/api/path";
import { readTextFile, exists } from "@tauri-apps/plugin-fs";
import { atomicWriteJson, backupCorruptFile, sweepOrphanedTmpFiles } from "./fsUtils";
import { APP_FOLDER, LIBRARY_FILE_NAME, CURRENT_LIBRARY_VERSION } from "./constants";
import { migrateLibrary, MigrationError } from "./migrations";
import { useLibraryStore } from "@/state/libraryStore";

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
  await sweepOrphanedTmpFiles(filePath);

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
      await backupCorruptFile(filePath);
      // If the write fails (e.g., directory deleted, disk full), the error
      // propagates to the caller as an I/O failure, distinct from the original
      // corruption error — callers should handle rejections accordingly.
      await atomicWriteJson(filePath, {
        version: CURRENT_LIBRARY_VERSION,
        sounds: [],
        tags: [],
        sets: [],
      });
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
  await atomicWriteJson(filePath, library);
}

/**
 * Builds a save payload from the current libraryStore state.
 * Use this instead of manually spreading `sounds`, `tags`, `sets` and hardcoding
 * `CURRENT_LIBRARY_VERSION` at every call site.
 */
export function getCurrentLibraryPayload(): GlobalLibrary {
  const { sounds, tags, sets } = useLibraryStore.getState();
  return { version: CURRENT_LIBRARY_VERSION, sounds, tags, sets };
}

/**
 * Saves the current libraryStore state to disk and clears the dirty flag.
 * Internal primitive used by `useSaveGlobalLibrary.mutationFn`. Direct callers
 * should prefer `useSaveCurrentLibrary` (the TanStack mutation) so all save
 * pathways share the same `onSuccess`/`onError` pipeline.
 *
 * @throws propagates any error from the underlying `saveGlobalLibrary` call;
 *         the dirty flag is NOT cleared on failure.
 */
export async function saveCurrentLibraryAndClearDirty(): Promise<void> {
  await saveGlobalLibrary(getCurrentLibraryPayload());
  useLibraryStore.getState().clearDirtyFlag();
}
