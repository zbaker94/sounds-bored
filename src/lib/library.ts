import { GlobalLibrary, GlobalLibrarySchema } from "./schemas";
import { appDataDir, join } from "@tauri-apps/api/path";
import { exists } from "@tauri-apps/plugin-fs";
import { atomicWriteJson, loadJsonWithRecovery, sweepOrphanedTmpFiles } from "./fsUtils";
import { APP_FOLDER, LIBRARY_FILE_NAME, CURRENT_LIBRARY_VERSION } from "./constants";
import { migrateLibrary } from "./migrations";
import { useLibraryStore } from "@/state/libraryStore";

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

  return loadJsonWithRecovery({
    path: filePath,
    parse: (raw) => GlobalLibrarySchema.parse(migrateLibrary(raw as Record<string, unknown>)),
    defaults: GlobalLibrarySchema.parse({ version: CURRENT_LIBRARY_VERSION, sounds: [], tags: [], sets: [] }),
    onCorruption: options?.onCorruption,
    corruptMessage: `${LIBRARY_FILE_NAME} was corrupt and has been reset. Your sound library has been cleared.`,
  });
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
function getCurrentLibraryPayload(): GlobalLibrary {
  const { sounds, tags, sets } = useLibraryStore.getState();
  return { version: CURRENT_LIBRARY_VERSION, sounds, tags, sets };
}

/**
 * Saves the current libraryStore state to disk and clears the dirty flag.
 * Called directly by `useAutoSave` (fire-and-forget, no TanStack caching needed)
 * and delegated to by `useSaveGlobalLibrary.mutationFn` (for manual saves that
 * benefit from TanStack's loading/error state).
 *
 * @throws propagates any error from the underlying `saveGlobalLibrary` call;
 *         the dirty flag is NOT cleared on failure.
 */
export async function saveCurrentLibraryAndClearDirty(): Promise<void> {
  await saveGlobalLibrary(getCurrentLibraryPayload());
  useLibraryStore.getState().clearDirtyFlag();
}
