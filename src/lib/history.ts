import { ProjectHistory, ProjectHistorySchema } from "./schemas";
import { appDataDir, join } from "@tauri-apps/api/path";
import { readTextFile, mkdir, exists, rename } from "@tauri-apps/plugin-fs";
import { atomicWriteJson, sweepOrphanedTmpFiles } from "./fsUtils";
import { APP_FOLDER, HISTORY_FILE_NAME } from "./constants";
import { ZodError } from "zod";

interface LoadHistoryOptions {
  onCorruption?: (message: string) => void;
}

export async function getHistoryFilePath(): Promise<string> {
  const dir = await appDataDir();
  return await join(dir, APP_FOLDER, HISTORY_FILE_NAME);
}

export async function ensureHistoryFile(): Promise<string> {
  const dir = await appDataDir();
  const folderPath = await join(dir, APP_FOLDER);
  const filePath = await join(folderPath, HISTORY_FILE_NAME);
  if (!(await exists(folderPath))) {
    await mkdir(folderPath, { recursive: true });
  }
  if (!(await exists(filePath))) {
    await atomicWriteJson(filePath, []);
  }
  return filePath;
}

export async function loadProjectHistory(options?: LoadHistoryOptions): Promise<ProjectHistory> {
  const filePath = await ensureHistoryFile();
  await sweepOrphanedTmpFiles(filePath);
  try {
    const text = await readTextFile(filePath);
    const parsed = JSON.parse(text);
    return ProjectHistorySchema.parse(parsed);
  } catch (err) {
    if (err instanceof SyntaxError || err instanceof ZodError) {
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
      // If the write fails (e.g., directory deleted, disk full), the error
      // propagates to the caller as an I/O failure, distinct from the original
      // corruption error — callers should handle rejections accordingly.
      await atomicWriteJson(filePath, []);
      options?.onCorruption?.(
        `${HISTORY_FILE_NAME} was corrupt and has been reset. Your recent projects list has been cleared.`
      );
      return [];
    }
    // Other errors (I/O failures, permission errors) → rethrow
    throw err;
  }
}

export async function saveProjectHistory(history: ProjectHistory): Promise<void> {
  const filePath = await ensureHistoryFile();
  await atomicWriteJson(filePath, history);
}
