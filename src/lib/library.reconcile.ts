import { readDir, exists, stat } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { Sound, GlobalFolder, AppSettings } from "./schemas";
import { AUDIO_EXTENSIONS } from "./constants";
import { basename, nameFromFilename } from "@/lib/utils";
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
interface BackfillEntry { index: number; filePath: string; }

async function scanFoldersForNewSounds(
  globalFolders: GlobalFolder[],
  soundsByPath: Map<string, Sound>,
): Promise<{ newSounds: Sound[]; pathToFolderId: Map<string, string>; inaccessibleFolderIds: string[] }> {
  const newSounds: Sound[] = [];
  const pathToFolderId = new Map<string, string>();
  const inaccessibleFolderIds: string[] = [];

  for (const folder of globalFolders) {
    const audioPaths = await scanFolderForAudioFiles(folder.path);
    if (audioPaths === null) { inaccessibleFolderIds.push(folder.id); continue; }
    for (const filePath of audioPaths) {
      pathToFolderId.set(filePath, folder.id);
      if (!soundsByPath.has(filePath)) {
        const sound: Sound = {
          id: crypto.randomUUID(),
          name: nameFromFilename(basename(filePath, filePath)),
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
  return { newSounds, pathToFolderId, inaccessibleFolderIds };
}

async function statSounds(sounds: Sound[]): Promise<void> {
  await Promise.all(sounds.map(async (sound) => {
    if (!sound.filePath) return;
    try {
      const info = await stat(sound.filePath);
      sound.fileSizeBytes = info.size;
    } catch {
      // stat failed — leave fileSizeBytes undefined
    }
  }));
}

async function extractCoverArts(sounds: Sound[]): Promise<void> {
  const BATCH = 8;
  for (let i = 0; i < sounds.length; i += BATCH) {
    await Promise.all(sounds.slice(i, i + BATCH).map(async (sound) => {
      if (!sound.filePath || sound.coverArtDataUrl !== undefined) return;
      try {
        const dataUrl = await invoke<string | null>("extract_cover_art", { path: sound.filePath });
        sound.coverArtDataUrl = dataUrl ?? "";  // "" = checked, no art found (prevents perpetual re-extraction)
      } catch {
        // extraction failed — leave coverArtDataUrl undefined to retry next boot
      }
    }));
  }
}

async function applyStatBackfill(
  sounds: Sound[],
  entries: BackfillEntry[],
): Promise<boolean> {
  if (entries.length === 0) return false;
  const results = await Promise.all(entries.map(async (e) => {
    try { const info = await stat(e.filePath); return { index: e.index, size: info.size }; }
    catch { return { index: e.index, size: undefined }; }
  }));
  let anyUpdated = false;
  for (const r of results) {
    if (r.size != null) {
      sounds[r.index] = { ...sounds[r.index], fileSizeBytes: r.size };
      anyUpdated = true;
    }
  }
  return anyUpdated;
}

async function applyCoverArtBackfill(
  sounds: Sound[],
  entries: BackfillEntry[],
): Promise<boolean> {
  if (entries.length === 0) return false;
  const BATCH = 8;
  let anyUpdated = false;
  for (let i = 0; i < entries.length; i += BATCH) {
    const results = await Promise.all(entries.slice(i, i + BATCH).map(async (e) => {
      try {
        const dataUrl = await invoke<string | null>("extract_cover_art", { path: e.filePath });
        return { index: e.index, dataUrl: dataUrl ?? "" };  // "" = checked, no art found
      } catch {
        return { index: e.index, dataUrl: null };  // null = error, retry next boot
      }
    }));
    for (const r of results) {
      if (r.dataUrl !== null) {
        sounds[r.index] = { ...sounds[r.index], coverArtDataUrl: r.dataUrl };
        anyUpdated = true;
      }
    }
  }
  return anyUpdated;
}

async function backfillExistingSounds(
  existingSounds: Sound[],
  pathToFolderId: Map<string, string>,
): Promise<{ reconciledSounds: Sound[]; anyFieldUpdated: boolean }> {
  const reconciledExisting: Sound[] = [];
  let anyFieldUpdated = false;
  const backfillStatEntries: BackfillEntry[] = [];
  const backfillCoverArtEntries: BackfillEntry[] = [];

  for (const sound of existingSounds) {
    let updated = { ...sound };
    if (sound.filePath && !sound.folderId) {
      const discoveredFolderId = pathToFolderId.get(sound.filePath);
      if (discoveredFolderId) { updated = { ...updated, folderId: discoveredFolderId }; anyFieldUpdated = true; }
    }
    reconciledExisting.push(updated);
    if (sound.filePath && sound.fileSizeBytes == null) {
      backfillStatEntries.push({ index: reconciledExisting.length - 1, filePath: sound.filePath });
    }
    if (sound.filePath && sound.coverArtDataUrl === undefined) {
      backfillCoverArtEntries.push({ index: reconciledExisting.length - 1, filePath: sound.filePath });
    }
  }

  const [statUpdated, coverArtUpdated] = await Promise.all([
    applyStatBackfill(reconciledExisting, backfillStatEntries),
    applyCoverArtBackfill(reconciledExisting, backfillCoverArtEntries),
  ]);
  if (statUpdated || coverArtUpdated) anyFieldUpdated = true;
  return { reconciledSounds: reconciledExisting, anyFieldUpdated };
}

export async function reconcileGlobalLibrary(
  globalFolders: GlobalFolder[],
  existingSounds: Sound[],
): Promise<ReconcileResult> {
  const soundsByPath = new Map<string, Sound>();
  for (const s of existingSounds) {
    if (s.filePath) soundsByPath.set(s.filePath, s);
  }

  const { newSounds, pathToFolderId, inaccessibleFolderIds } =
    await scanFoldersForNewSounds(globalFolders, soundsByPath);

  await statSounds(newSounds);
  await extractCoverArts(newSounds);

  const { reconciledSounds, anyFieldUpdated } =
    await backfillExistingSounds(existingSounds, pathToFolderId);

  return {
    sounds: [...reconciledSounds, ...newSounds],
    changed: newSounds.length > 0 || anyFieldUpdated,
    inaccessibleFolderIds,
  };
}

// Settings are committed before reconcile; a reconcile failure leaves settings updated but the in-memory library stale until the next boot reconcile.
export async function addGlobalFolderAndReconcile(
  newFolder: GlobalFolder,
  settings: AppSettings,
  sounds: Sound[],
  saveSettings: (s: AppSettings) => Promise<unknown>,
  setSounds: (newSounds: Sound[]) => void,
): Promise<{ updatedSettings: AppSettings; changed: boolean }> {
  const updatedSettings: AppSettings = {
    ...settings,
    globalFolders: [...settings.globalFolders, newFolder],
  };
  await saveSettings(updatedSettings);
  const result = await reconcileGlobalLibrary(updatedSettings.globalFolders, sounds);
  if (result.changed) {
    setSounds(result.sounds);
  }
  return { updatedSettings, changed: result.changed };
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
  /** IDs whose existence could not be determined (e.g. permission denied, out-of-scope). */
  unknownSoundIds: Set<string>;
  unknownFolderIds: Set<string>;
}

/**
 * Check which global folders and sounds are missing from disk.
 *
 * A folder is missing if its path does not exist.
 * A sound is missing if its individual file is absent OR its folder is confirmed missing.
 * Sounds with no filePath inherit their folder's status (missing/unknown).
 *
 * Folders or files whose existence cannot be determined (permission denied,
 * out-of-scope) are tracked in `unknownFolderIds`/`unknownSoundIds` instead of
 * being silently treated as present.
 */
export async function checkMissingStatus(
  globalFolders: GlobalFolder[],
  sounds: Sound[],
): Promise<MissingStatusResult> {
  type FolderCheckResult = { id: string; status: "missing" | "present" | "unknown" };
  type SoundCheckResult = { id: string; folderId: string | undefined; status: "missing" | "present" | "unknown" };

  // Check all folder paths in parallel.
  // exists() can throw when the path is outside the Tauri scope or the OS
  // denies access — treat those as 'unknown' rather than silently 'present'.
  const folderChecks: FolderCheckResult[] = await Promise.all(
    globalFolders.map(async (f): Promise<FolderCheckResult> => {
      try {
        return { id: f.id, status: (await exists(f.path)) ? "present" : "missing" };
      } catch {
        return { id: f.id, status: "unknown" };
      }
    }),
  );

  const missingFolderIds = new Set(
    folderChecks.filter((f) => f.status === "missing").map((f) => f.id),
  );
  const unknownFolderIds = new Set(
    folderChecks.filter((f) => f.status === "unknown").map((f) => f.id),
  );

  // Check all sound filePaths in parallel.
  // Same policy: errors become 'unknown', not 'present'.
  const soundsWithPath = sounds.filter((s) => !!s.filePath);
  const soundFileChecks: SoundCheckResult[] = await Promise.all(
    soundsWithPath.map(async (s): Promise<SoundCheckResult> => {
      try {
        return {
          id: s.id,
          folderId: s.folderId,
          status: (await exists(s.filePath!)) ? "present" : "missing",
        };
      } catch {
        return { id: s.id, folderId: s.folderId, status: "unknown" };
      }
    }),
  );

  const missingSoundIds = new Set<string>();
  const unknownSoundIds = new Set<string>();
  for (const check of soundFileChecks) {
    // A confirmed-missing parent folder takes precedence over an unknown file check.
    if (check.folderId && missingFolderIds.has(check.folderId)) {
      missingSoundIds.add(check.id);
    } else if (check.status === "unknown") {
      unknownSoundIds.add(check.id);
    } else if (check.status === "missing") {
      missingSoundIds.add(check.id);
    }
  }
  // Sounds with no filePath inherit their folder's status.
  for (const sound of sounds.filter((s) => !s.filePath)) {
    if (!sound.folderId) continue;
    if (missingFolderIds.has(sound.folderId)) {
      missingSoundIds.add(sound.id);
    } else if (unknownFolderIds.has(sound.folderId)) {
      unknownSoundIds.add(sound.id);
    }
  }

  return { missingSoundIds, missingFolderIds, unknownSoundIds, unknownFolderIds };
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
  useLibraryStore
    .getState()
    .setMissingState(
      result.missingSoundIds,
      result.missingFolderIds,
      result.unknownSoundIds,
      result.unknownFolderIds,
    );
}
