import { ProjectHistory, ProjectHistorySchema } from "./schemas";
import { appDataDir, join } from "@tauri-apps/api/path";
import { readTextFile, writeTextFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import { APP_FOLDER, HISTORY_FILE_NAME } from "./constants";

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
    await writeTextFile(filePath, "[]");
  }
  return filePath;
}

export async function loadProjectHistory(): Promise<ProjectHistory> {
  const filePath = await ensureHistoryFile();
  const text = await readTextFile(filePath);
  const parsed = JSON.parse(text);
  return ProjectHistorySchema.parse(parsed);
}

export async function saveProjectHistory(history: ProjectHistory): Promise<void> {
  const filePath = await ensureHistoryFile();
  await writeTextFile(filePath, JSON.stringify(history, null, 2));
}
