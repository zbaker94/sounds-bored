import { readDir, exists } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { Sound, GlobalFolder } from "./schemas";
import { AUDIO_EXTENSIONS } from "./constants";

/**
 * Result of reconciling the global library against the file system.
 */
export interface ReconcileResult {
  /** The reconciled sounds array (existing + newly discovered). */
  sounds: Sound[];
  /** Whether any changes were made (new sounds added or folderIds backfilled). */
  changed: boolean;
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
 */
async function scanFolderForAudioFiles(folderPath: string): Promise<string[]> {
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

  for (const folder of globalFolders) {
    const audioPaths = await scanFolderForAudioFiles(folder.path);

    for (const filePath of audioPaths) {
      pathToFolderId.set(filePath, folder.id);

      if (!soundsByPath.has(filePath)) {
        const filename = filePath.split(/[\\/]/).pop() ?? filePath;
        newSounds.push({
          id: crypto.randomUUID(),
          name: nameFromFilename(filename),
          filePath,
          folderId: folder.id,
          tags: [],
          sets: [],
        });
        soundsByPath.set(filePath, newSounds[newSounds.length - 1]);
      }
    }
  }

  // Backfill folderId on existing sounds discovered in a folder but lacking folderId
  const reconciledExisting: Sound[] = [];
  let anyFolderIdUpdated = false;

  for (const sound of existingSounds) {
    if (sound.filePath && !sound.folderId) {
      const discoveredFolderId = pathToFolderId.get(sound.filePath);
      if (discoveredFolderId) {
        reconciledExisting.push({ ...sound, folderId: discoveredFolderId });
        anyFolderIdUpdated = true;
        continue;
      }
    }
    reconciledExisting.push(sound);
  }

  const changed = newSounds.length > 0 || anyFolderIdUpdated;

  return {
    sounds: [...reconciledExisting, ...newSounds],
    changed,
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
 */
export async function checkMissingStatus(
  globalFolders: GlobalFolder[],
  sounds: Sound[],
): Promise<MissingStatusResult> {
  // Check all folder paths in parallel
  const folderChecks = await Promise.all(
    globalFolders.map(async (f) => ({ id: f.id, missing: !(await exists(f.path)) })),
  );
  const missingFolderIds = new Set(folderChecks.filter((f) => f.missing).map((f) => f.id));

  // Check all sound filePaths in parallel (only sounds that have a filePath)
  const soundsWithPath = sounds.filter((s) => !!s.filePath);
  const soundFileChecks = await Promise.all(
    soundsWithPath.map(async (s) => ({
      id: s.id,
      folderId: s.folderId,
      missing: !(await exists(s.filePath!)),
    })),
  );

  const missingSoundIds = new Set<string>();
  for (const check of soundFileChecks) {
    if (check.missing || (check.folderId && missingFolderIds.has(check.folderId))) {
      missingSoundIds.add(check.id);
    }
  }

  return { missingSoundIds, missingFolderIds };
}
