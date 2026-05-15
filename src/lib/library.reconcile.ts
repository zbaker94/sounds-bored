import { readDir, exists, stat } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { Sound, GlobalFolder, AppSettings } from "./schemas";
import { AUDIO_EXTENSIONS } from "./constants";
import { basename, nameFromFilename } from "@/lib/utils";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { useLibraryStore } from "@/state/libraryStore";
import { useAnalysisStore, type AnalysisEntry } from "@/state/analysisStore";
import { logError } from "@/lib/logger";

/**
 * Result of reconciling the global library against the file system.
 */
export interface ReconcileResult {
  /** The reconciled sounds array (existing + newly discovered). */
  sounds: Sound[];
  /** Whether any changes were made (new sounds added or fields backfilled). */
  changed: boolean;
  /** IDs of folders that could not be read (e.g. outside the app's fs scope). */
  inaccessibleFolderIds: string[];
}

/** Shared context passed to every enricher in a pipeline run. Intentionally open — extend as needed. */
export type EnricherContext = Record<string, unknown>;

/**
 * A composable enricher takes a Sound array and returns a new array with
 * enriched fields. Implementers MUST:
 * - Return the same array length in the same order as the input.
 * - Return the same Sound reference for sounds they did not modify (load-bearing
 *   for change detection in `reconcileGlobalLibrary`).
 * - Be idempotent — skip sounds that already have the target field populated.
 * - MAY return the input array reference itself when no sound was modified
 *   (optimization for fully-enriched libraries — callers must not assume a copy).
 * Enrichers have no dependency on Zustand stores, making them independently testable.
 */
export type SoundEnricher = (sounds: Sound[], context?: EnricherContext) => Promise<Sound[]>;

// Batch sizes for IPC-bound operations. Values differ because per-op cost differs:
// stat() and exists() are cheap filesystem calls; cover-art extraction runs a Rust decoder.
export const STAT_BATCH = 32;
export const COVER_ART_BATCH = 8;
export const SOUND_EXISTS_BATCH = 50;

/**
 * Process `items` in sequential batches of `batchSize`, applying `fn` to each
 * item. Preserves input order. Used to bound concurrent Tauri IPC calls.
 */
export async function batchMap<T, R>(items: T[], batchSize: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  if (batchSize < 1) throw new RangeError(`batchSize must be >= 1, got ${batchSize}`);
  const result: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = await Promise.all(items.slice(i, i + batchSize).map(fn));
    result.push(...batch);
  }
  return result;
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

/**
 * Enriches sounds with their file size. Idempotent: skips sounds that already
 * have `fileSizeBytes` set. Unchanged sounds keep their original reference.
 * Returns the input array itself when no enrichment is needed (callers must not
 * assume a copy); otherwise returns a new array. Processes in bounded batches
 * to limit concurrent IPC calls.
 */
export const statEnricher: SoundEnricher = (sounds, _context) => {
  if (!sounds.some((s) => s.filePath && s.fileSizeBytes == null)) return Promise.resolve(sounds);
  return batchMap(sounds, STAT_BATCH, async (sound) => {
    if (!sound.filePath || sound.fileSizeBytes != null) return sound;
    try {
      const info = await stat(sound.filePath);
      return { ...sound, fileSizeBytes: info.size };
    } catch {
      return sound;
    }
  });
};

/**
 * Enriches sounds with embedded cover art. Idempotent: skips sounds whose
 * `coverArtDataUrl` is already set (including the empty-string sentinel `""`
 * that means "checked, no art found" — prevents perpetual re-extraction).
 * Unchanged sounds keep their original reference. Returns the input array
 * itself when no enrichment is needed (callers must not assume a copy);
 * otherwise returns a new array. Processes in bounded batches to limit
 * concurrent IPC calls — cover-art extraction is the costliest enricher,
 * so it uses the smallest batch size.
 */
export const coverArtEnricher: SoundEnricher = (sounds, _context) => {
  if (!sounds.some((s) => s.filePath && s.coverArtDataUrl === undefined)) return Promise.resolve(sounds);
  return batchMap(sounds, COVER_ART_BATCH, async (sound) => {
    if (!sound.filePath || sound.coverArtDataUrl !== undefined) return sound;
    try {
      const dataUrl = await invoke<string | null>("extract_cover_art", { path: sound.filePath });
      return { ...sound, coverArtDataUrl: dataUrl ?? "" };
    } catch {
      return sound;
    }
  });
};

/**
 * Run `enrichers` sequentially over `sounds`, passing each output as input to
 * the next. Enrichers are applied in order — later enrichers see changes made
 * by earlier ones.
 */
export async function applyEnrichers(sounds: Sound[], enrichers: readonly SoundEnricher[], context: EnricherContext = {}): Promise<Sound[]> {
  let result = sounds;
  for (const enricher of enrichers) {
    result = await enricher(result, context);
  }
  return result;
}

const DEFAULT_ENRICHERS: readonly SoundEnricher[] = [statEnricher, coverArtEnricher];

/**
 * Reconcile the global sound library against audio files on disk.
 *
 * For each globalFolder:
 * - Scans the folder for audio files (top-level only)
 * - Creates new Sound entries for files not already in the library (matched by filePath)
 * - Sets `folderId` on new sounds to link them to their source folder
 * - Backfills `folderId` on existing sounds if previously undefined
 * - Applies all enrichers (stat, cover art) to both new and existing sounds
 *
 * Missing files are left as-is — the audio engine handles missing files
 * gracefully at load time.
 *
 * @param globalFolders - The configured global folders from AppSettings
 * @param existingSounds - The current sounds array from the library store
 * @returns ReconcileResult with the updated sounds array and a changed flag
 */
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

  // folderId is derived from the folder-scan side-effect (pathToFolderId), not
  // from a per-sound operation — it cannot be expressed as a SoundEnricher.
  let anyFolderIdUpdated = false;
  const reconciledExisting = existingSounds.map((sound) => {
    if (sound.filePath && !sound.folderId) {
      const discoveredFolderId = pathToFolderId.get(sound.filePath);
      if (discoveredFolderId) {
        anyFolderIdUpdated = true;
        return { ...sound, folderId: discoveredFolderId };
      }
    }
    return sound;
  });

  // Apply all enrichers to new and existing sounds. Enrichers are idempotent,
  // so existing sounds only receive updates for fields they are missing.
  const [enrichedNew, enrichedExisting] = await Promise.all([
    applyEnrichers(newSounds, DEFAULT_ENRICHERS),
    applyEnrichers(reconciledExisting, DEFAULT_ENRICHERS),
  ]);

  // Reference inequality is the change signal — enrichers contractually return
  // the same Sound ref when no-op (required by the SoundEnricher contract).
  // enrichedNew changes are NOT checked here: newSounds.length > 0 already covers that.
  const anyEnricherUpdated = enrichedExisting.some((s, i) => s !== reconciledExisting[i]);

  return {
    sounds: [...enrichedExisting, ...enrichedNew],
    changed: newSounds.length > 0 || anyFolderIdUpdated || anyEnricherUpdated,
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

  // Folders are few (<20 typical), so an unbounded Promise.all is fine here;
  // sounds are batched below. exists() can throw when the path is outside the
  // Tauri scope or the OS denies access — treat those as 'unknown' not 'present'.
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

  // Sound filePaths are batched to bound concurrent IPC calls. Same error policy:
  // errors become 'unknown', not 'present'.
  const soundsWithPath = sounds.filter((s) => !!s.filePath);
  const soundFileChecks: SoundCheckResult[] = await batchMap(
    soundsWithPath,
    SOUND_EXISTS_BATCH,
    async (s): Promise<SoundCheckResult> => {
      try {
        return {
          id: s.id,
          folderId: s.folderId,
          status: (await exists(s.filePath!)) ? "present" : "missing",
        };
      } catch {
        return { id: s.id, folderId: s.folderId, status: "unknown" };
      }
    },
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

// True between the IPC invoke call and the Rust `started` event arriving in JS.
// Prevents a concurrent appendToQueue kick from firing a second dispatch before
// currentSoundId is set (the started event is async, so currentSoundId is transiently
// null even while a Rust task is in flight).
let _dispatchInFlight = false;

/** Called by useAudioAnalysis when the started event arrives to clear the in-flight flag. */
export function clearDispatchInFlight(): void {
  _dispatchInFlight = false;
}

/**
 * Dispatch the next queued sound for analysis. Called once per completed file
 * to keep exactly one file in-flight in Rust at a time. Iterates until a
 * dispatch succeeds or the queue is empty.
 */
export async function dispatchNextFromQueue(): Promise<void> {
  while (true) {
    const next = useAnalysisStore.getState().advance();
    if (!next) return;
    _dispatchInFlight = true;
    try {
      await invoke<void>("start_audio_analysis", { entries: [next] });
      return; // success — wait for the started event (which clears _dispatchInFlight) then the complete event
    } catch (err) {
      _dispatchInFlight = false;
      logError("start_audio_analysis failed", { soundId: next.id, err: String(err) });
      useAnalysisStore.getState().recordError(next.id, "Failed to start analysis");
    }
  }
}

/**
 * Append `queue` to the active analysis run, or start a fresh run if idle/completed.
 * If status is "running", appends non-duplicate entries; the existing dispatch loop
 * picks them up naturally. The kick below handles the race where the last in-flight
 * item's complete event fired before this append — currentSoundId is null, pendingQueue
 * is non-empty, and nothing is driving dispatch. We also guard against _dispatchInFlight
 * to avoid double-invoking Rust in the window between invoke returning and the started
 * event setting currentSoundId.
 */
async function enqueueOrStart(queue: AnalysisEntry[]): Promise<void> {
  if (queue.length === 0) return;
  const snapshot = useAnalysisStore.getState();
  if (snapshot.status === "running") {
    snapshot.appendToQueue(queue);
    // Kick dispatch only when no Rust task is in-flight and the queue has items.
    const after = useAnalysisStore.getState();
    if (!after.currentSoundId && !_dispatchInFlight && after.pendingQueue.length > 0) {
      await dispatchNextFromQueue();
    }
    return;
  }
  snapshot.startAnalysis(queue);
  await dispatchNextFromQueue();
}

function buildAnalysisQueue(sounds: Sound[], filter: (s: Sound) => boolean): AnalysisEntry[] {
  return sounds
    .filter((s) => s.filePath && filter(s))
    .sort((a, b) => (a.fileSizeBytes ?? Infinity) - (b.fileSizeBytes ?? Infinity))
    .map((s) => ({ id: s.id, path: s.filePath! }));
}

/**
 * Queue loudness analysis for an explicit list of sounds. Sorted
 * smallest-first. Used for on-demand "Analyze selected" triggered by the user.
 *
 * If analysis is already running, appends non-duplicate entries to the live queue
 * instead of starting a new batch.
 */
export async function scheduleAnalysisForSounds(sounds: Sound[]): Promise<void> {
  await enqueueOrStart(buildAnalysisQueue(sounds, () => true));
}

/**
 * Queue loudness analysis for sounds that have a filePath but have not yet had
 * their loudness measured (loudnessLufs === undefined). Dispatches one file at
 * a time, smallest first, to bound memory usage. Fire-and-forget.
 *
 * Used exclusively for auto-analysis on boot and after folder reconcile.
 *
 * If analysis is already running, appends unanalyzed sounds that are not already
 * queued. No-op if all sounds are already analyzed or no sounds have a filePath.
 */
export async function scheduleAnalysisForUnanalyzed(sounds: Sound[]): Promise<void> {
  await enqueueOrStart(buildAnalysisQueue(sounds, (s) => s.loudnessLufs === undefined));
}

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
