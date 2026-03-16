import { AppSettings, AppSettingsSchema, GlobalFolder } from "./schemas";
import { appDataDir, join, musicDir } from "@tauri-apps/api/path";
import { readTextFile, writeTextFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import { APP_FOLDER, SETTINGS_FILE_NAME } from "./constants";

export async function getSettingsFilePath(): Promise<string> {
  const dir = await appDataDir();
  return await join(dir, APP_FOLDER, SETTINGS_FILE_NAME);
}

async function createDefaultAppSettings(): Promise<AppSettings> {
  const music = await musicDir();
  const rootPath = await join(music, "SoundsBored");
  const downloadsPath = await join(music, "SoundsBored", "downloads");
  const importedPath = await join(music, "SoundsBored", "imported");

  const rootFolder: GlobalFolder = {
    id: crypto.randomUUID(),
    path: rootPath,
    name: "SoundsBored",
  };
  const downloadsFolder: GlobalFolder = {
    id: crypto.randomUUID(),
    path: downloadsPath,
    name: "Downloads",
  };
  const importedFolder: GlobalFolder = {
    id: crypto.randomUUID(),
    path: importedPath,
    name: "Imported",
  };

  for (const folder of [rootFolder, downloadsFolder, importedFolder]) {
    try {
      await mkdir(folder.path, { recursive: true });
    } catch {
      console.warn(`Could not create default folder on disk: ${folder.path}`);
    }
  }

  return {
    version: "1.0.0",
    globalFolders: [rootFolder, downloadsFolder, importedFolder],
    downloadFolderId: downloadsFolder.id,
    importFolderId: importedFolder.id,
  };
}

export async function loadAppSettings(): Promise<AppSettings> {
  const dir = await appDataDir();
  const folderPath = await join(dir, APP_FOLDER);
  const filePath = await join(folderPath, SETTINGS_FILE_NAME);

  if (!(await exists(folderPath))) {
    await mkdir(folderPath, { recursive: true });
  }

  if (!(await exists(filePath))) {
    const defaults = await createDefaultAppSettings();
    await writeTextFile(filePath, JSON.stringify(defaults, null, 2));
    return defaults;
  }

  const text = await readTextFile(filePath);
  const parsed = JSON.parse(text);
  return AppSettingsSchema.parse(parsed);
}

export async function saveAppSettings(settings: AppSettings): Promise<void> {
  const filePath = await getSettingsFilePath();
  await writeTextFile(filePath, JSON.stringify(settings, null, 2));
}
