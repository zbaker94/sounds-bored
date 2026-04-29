import { ProjectHistory, ProjectHistorySchema } from "./schemas";
import { appDataDir, join } from "@tauri-apps/api/path";
import { mkdir, exists } from "@tauri-apps/plugin-fs";
import { atomicWriteJson, loadJsonWithRecovery, sweepOrphanedTmpFiles } from "./fsUtils";
import { APP_FOLDER, HISTORY_FILE_NAME } from "./constants";

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
  return loadJsonWithRecovery<ProjectHistory>({
    path: filePath,
    parse: (raw) => ProjectHistorySchema.parse(raw),
    defaults: [],
    onCorruption: options?.onCorruption,
    corruptMessage: `${HISTORY_FILE_NAME} was corrupt and has been reset. Your recent projects list has been cleared.`,
  });
}

export async function saveProjectHistory(history: ProjectHistory): Promise<void> {
  const filePath = await ensureHistoryFile();
  await atomicWriteJson(filePath, history);
}
