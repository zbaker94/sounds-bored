import { exists, copyFile } from "@tauri-apps/plugin-fs";
import { join, basename } from "@tauri-apps/api/path";
import { AUDIO_EXTENSIONS } from "@/lib/constants";

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
