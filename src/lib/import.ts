import { exists, copyFile } from "@tauri-apps/plugin-fs";
import { join, basename } from "@tauri-apps/api/path";
import { AUDIO_EXTENSIONS, SYSTEM_TAG_IMPORTED } from "@/lib/constants";
import { useLibraryStore } from "@/state/libraryStore";
import { Sound } from "@/lib/schemas";

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
    } catch (err) {
      console.warn(`Failed to copy file "${sourcePath}" to "${destPath}":`, err);
    }
  }

  return copied;
}

/**
 * Tag newly imported sounds with the "imported" tag.
 *
 * Compares the sounds that existed before import (`previousSounds`) against the
 * current store to find new entries, then ensures the "imported" tag exists and
 * assigns it to all newly added sounds.
 *
 * Call this after reconciliation has updated the library store with new sounds.
 */
export function tagImportedSounds(previousSounds: Sound[]): void {
  const { sounds, ensureTagExists, systemAssignTagsToSounds } =
    useLibraryStore.getState();

  const previousIds = new Set(previousSounds.map((s) => s.id));
  const newSoundIds = sounds
    .filter((s) => !previousIds.has(s.id))
    .map((s) => s.id);

  if (newSoundIds.length === 0) return;

  const importedTag = ensureTagExists(SYSTEM_TAG_IMPORTED, undefined, true);
  systemAssignTagsToSounds(newSoundIds, [importedTag.id]);
}
