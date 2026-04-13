import { readDir, exists, stat } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { Sound, GlobalFolder } from "./schemas";
import { AUDIO_EXTENSIONS } from "./constants";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { useLibraryStore } from "@/state/libraryStore";

/**
 * Result of reconciling the global library against the file system.
 */
export interface ReconcileResult {
  /** The reconciled sounds array (existing + newly discovered). */
  sounds: Sound[];
  /** Whether any changes were made (new sounds added or folderIds backfilled). */
  changed: boolean;
  /** IDs of folders that could not be read (e.g. outside the app's fs scope). */
  inaccessibleFolderIds: string[];
}

/**
 * Check if a filename has a supported audio extension.
 */
function isAudioFile(name: string): boolean {
  const lower = name.toLowerCase();
  return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Derive a display name from a filename by stripping the extension,
 * splitting on hyphens/underscores, and title-casing each word.
 * e.g. "my-audio_bgm_whatever.wav" → "My Audio Bgm Whatever"
 */
function nameFromFilename(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  const stem = lastDot > 0 ? filename.substring(0, lastDot) : filename;
  return stem
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Scan a single folder for audio files (non-recursive, top-level only).
 * Returns absolute file paths for each discovered audio file.
 * Returns null if the folder cannot be accessed (e.g. outside fs scope).
 */
async function scanFolderForAudioFiles(folderPath: string): Promise<string[] | null> {
  try {
    const folderExists = await exists(folderPath);
    if (!folderExists) return [];

    const entries = await readDir(folderPath);
    const audioPaths: string[] = [];

    for (const entry of entries) {
      if (entry.isFile && isAudioFile(entry.name)) {
        const fullPath = await join(folderPath, entry.name);
        audioPaths.push(fullPath);
      }
    }

    return audioPaths;
  } catch {
    // Folder is outside the app's fs scope or otherwise inaccessible.
    return null;
  }
}

/**
 * Reconcile the global sound library against audio files on disk.
 *
 * For each globalFolder:
 * - Scans the folder for audio files (top-level only)
 * - Creates new Sound entries for files not already in the library (matched by filePath)
 * - Sets `folderId` on new sounds to link them to their source folder
 * - Backfills `folderId` on existing sounds if previously undefined
 *
 * Missing files are left as-is — the audio engine (Phase 5) handles
 * missing files gracefully at load time.
 *
 * @param globalFolders - The configured global folders from AppSettings
 * @param existingSounds - The current sounds array from the library store
 * @returns ReconcileResult with the updated sounds array and a changed flag
 */
export async function reconcileGlobalLibrary(
  globalFolders: GlobalFolder[],
  existingSounds: Sound[],
): Promise<ReconcileResult> {
  // Build a lookup: filePath → Sound for quick matching
  const soundsByPath = new Map<string, Sound>();
  for (const s of existingSounds) {
    if (s.filePath) soundsByPath.set(s.filePath, s);
  }

  // Scan all folders: collect new sounds and build filePath → folderId map
  const newSounds: Sound[] = [];
  const pathToFolderId = new Map<string, string>();
  const inaccessibleFolderIds: string[] = [];

  for (const folder of globalFolders) {
    const audioPaths = await scanFolderForAudioFiles(folder.path);

    if (audioPaths === null) {
      // Folder could not be read — record it but continue with other folders.
      inaccessibleFolderIds.push(folder.id);
      continue;
    }

    for (const filePath of audioPaths) {
      pathToFolderId.set(filePath, folder.id);

      if (!soundsByPath.has(filePath)) {
        const filename = filePath.split(/[\\/]/).pop() ?? filePath;
        const sound: Sound = {
          id: crypto.randomUUID(),
          name: nameFromFilename(filename),
          filePath,
          folderId: folder.id,
          tags: [],
          sets: [],
        };
        newSounds.push(sound);
        soundsByPath.set(filePath, sound);
      }
    }
  }

  // Stat new sounds in parallel to populate fileSizeBytes
  await Promise.all(
    newSounds.map(async (sound) => {
      if (!sound.filePath) return;
      try {
        const info = await stat(sound.filePath);
        sound.fileSizeBytes = info.size;
      } catch {
        // stat failed — leave fileSizeBytes undefined
      }
    }),
  );

  // Backfill folderId and fileSizeBytes on existing sounds
  const reconciledExisting: Sound[] = [];
  let anyFieldUpdated = false;

  // Collect backfill stat promises for existing sounds missing fileSizeBytes
  interface BackfillEntry {
    index: number;
    filePath: string;
  }
  const backfillStatEntries: BackfillEntry[] = [];

  for (const sound of existingSounds) {
    let updated = { ...sound };
    let wasUpdated = false;

    if (sound.filePath && !sound.folderId) {
      const discoveredFolderId = pathToFolderId.get(sound.filePath);
      if (discoveredFolderId) {
        updated = { ...updated, folderId: discoveredFolderId };
        wasUpdated = true;
      }
    }

    reconciledExisting.push(updated);

    if (sound.filePath && sound.fileSizeBytes == null) {
      backfillStatEntries.push({
        index: reconciledExisting.length - 1,
        filePath: sound.filePath,
      });
    }

    if (wasUpdated) {
      anyFieldUpdated = true;
    }
  }

  // Batch stat calls for existing sounds missing fileSizeBytes
  if (backfillStatEntries.length > 0) {
    const statResults = await Promise.all(
      backfillStatEntries.map(async (entry) => {
        try {
          const info = await stat(entry.filePath);
          return { index: entry.index, size: info.size };
        } catch {
          return { index: entry.index, size: undefined };
        }
      }),
    );

    for (const result of statResults) {
      if (result.size != null) {
        reconciledExisting[result.index] = {
          ...reconciledExisting[result.index],
          fileSizeBytes: result.size,
        };
        anyFieldUpdated = true;
      }
    }
  }

  const changed = newSounds.length > 0 || anyFieldUpdated;

  return {
    sounds: [...reconciledExisting, ...newSounds],
    changed,
    inaccessibleFolderIds,
  };
}

// ─── Missing File / Folder Detection ─────────────────────────────────────────

export class MissingFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingFileError";
  }
}

export interface MissingStatusResult {
  missingSoundIds: Set<string>;
  missingFolderIds: Set<string>;
}

/**
 * Check which global folders and sounds are missing from disk.
 *
 * A folder is missing if its path does not exist.
 * A sound is missing if:
 *   - it has a filePath that does not exist on disk, OR
 *   - its folderId points to a missing folder (even if filePath isn't checked separately)
 * Sounds with no filePath are never flagged.
 *
 * Folders or files that cannot be checked due to scope restrictions are
 * silently skipped (not treated as missing).
 */
export async function checkMissingStatus(
  globalFolders: GlobalFolder[],
  sounds: Sound[],
): Promise<MissingStatusResult> {
  // Check all folder paths in parallel — skip any that throw (outside scope)
  const folderChecks = await Promise.all(
    globalFolders.map(async (f) => {
      try {
        return { id: f.id, missing: !(await exists(f.path)) };
      } catch {
        return { id: f.id, missing: false };
      }
    }),
  );
  const missingFolderIds = new Set(folderChecks.filter((f) => f.missing).map((f) => f.id));

  // Check all sound filePaths in parallel — skip any that throw (outside scope)
  const soundsWithPath = sounds.filter((s) => !!s.filePath);
  const soundFileChecks = await Promise.all(
    soundsWithPath.map(async (s) => {
      try {
        return { id: s.id, folderId: s.folderId, missing: !(await exists(s.filePath!)) };
      } catch {
        return { id: s.id, folderId: s.folderId, missing: false };
      }
    }),
  );

  const missingSoundIds = new Set<string>();
  for (const check of soundFileChecks) {
    if (check.missing || (check.folderId && missingFolderIds.has(check.folderId))) {
      missingSoundIds.add(check.id);
    }
  }

  return { missingSoundIds, missingFolderIds };
}

// ─── Store-coupled orchestrators ─────────────────────────────────────────────
// These functions read from / write to Zustand stores directly.
// Pure reconciliation and detection logic remains above.

/**
 * Convenience utility: run `checkMissingStatus` against current store state
 * and commit the result into the library store in one call.
 *
 * @param globalFolders - Optional override for the folder list. Pass this when
 *   settings were just saved to disk but the Zustand store hasn't yet received
 *   the updated data (e.g. immediately after `saveSettings`). Defaults to
 *   `useAppSettingsStore.getState().settings?.globalFolders`.
 */
export async function refreshMissingState(globalFolders?: GlobalFolder[]): Promise<void> {
  const settings = useAppSettingsStore.getState().settings;
  const folders = globalFolders ?? settings?.globalFolders;
  if (!folders) return;
  const { sounds } = useLibraryStore.getState();
  const result = await checkMissingStatus(folders, sounds);
  useLibraryStore.getState().setMissingState(result.missingSoundIds, result.missingFolderIds);
}
