import { exists, copyFile } from "@tauri-apps/plugin-fs";
import { join, basename } from "@tauri-apps/api/path";
import { AUDIO_EXTENSIONS, SYSTEM_TAG_IMPORTED } from "@/lib/constants";
import type { Sound, Tag } from "@/lib/schemas";

/**
 * Copy audio files from sourcePaths into destFolderPath.
 * - Filters out non-audio files (by extension, case-insensitive)
 * - Skips files that already exist at the destination
 * - Catches per-file errors (logs warning, continues)
 * - Returns the destination paths that were successfully copied
 */
export async function copyFilesToFolder(
  sourcePaths: string[],
  destFolderPath: string
): Promise<string[]> {
  const copied: string[] = [];

  for (const sourcePath of sourcePaths) {
    const filename = await basename(sourcePath);
    const lowerFilename = filename.toLowerCase();

    const isAudio = AUDIO_EXTENSIONS.some((ext) => lowerFilename.endsWith(ext));
    if (!isAudio) {
      continue;
    }

    const destPath = await join(destFolderPath, filename);

    const alreadyExists = await exists(destPath);
    if (alreadyExists) {
      continue;
    }

    try {
      await copyFile(sourcePath, destPath);
      copied.push(destPath);
    } catch {
      // Skip files that fail to copy; caller inspects the returned list
    }
  }

  return copied;
}

/**
 * Tag newly imported sounds with the system "imported" tag.
 *
 * Pure function — accepts store state and actions as parameters so it
 * can be called from any context (hook, test) without store coupling.
 *
 * @param soundsBeforeImport - snapshot of sounds array taken before reconciliation
 * @param soundsAfterImport  - current sounds array after reconciliation
 * @param ensureTagExists    - from libraryStore
 * @param systemAssignTagsToSounds - from libraryStore (bypasses system-tag guard)
 */
export function tagImportedSounds(
  soundsBeforeImport: Sound[],
  soundsAfterImport: Sound[],
  ensureTagExists: (name: string, color?: string, isSystem?: boolean) => Tag,
  systemAssignTagsToSounds: (soundIds: string[], tagIds: string[]) => void,
): void {
  const previousIds = new Set(soundsBeforeImport.map((s) => s.id));
  const newSoundIds = soundsAfterImport
    .filter((s) => !previousIds.has(s.id))
    .map((s) => s.id);

  if (newSoundIds.length === 0) return;

  const importedTag = ensureTagExists(SYSTEM_TAG_IMPORTED, undefined, true);
  systemAssignTagsToSounds(newSoundIds, [importedTag.id]);
}
