import { AppSettings, AppSettingsSchema, GlobalFolder } from "./schemas";
import { appDataDir, audioDir, join } from "@tauri-apps/api/path";
import { readTextFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import { atomicWriteJson } from "./fsUtils";
import { APP_FOLDER, SETTINGS_FILE_NAME } from "./constants";

export async function getSettingsFilePath(): Promise<string> {
  const dir = await appDataDir();
  return await join(dir, APP_FOLDER, SETTINGS_FILE_NAME);
}

async function createDefaultAppSettings(): Promise<AppSettings> {
  const music = await audioDir();
  const downloadsPath = await join(music, "SoundsBored", "downloads");
  const importedPath = await join(music, "SoundsBored", "imported");


  const importedFolder: GlobalFolder = {
    id: crypto.randomUUID(),
    path: importedPath,
    name: "Imported",
  };
  const downloadsFolder: GlobalFolder = {
    id: crypto.randomUUID(),
    path: downloadsPath,
    name: "Downloads",
  };

  for (const folder of [downloadsFolder, importedFolder]) {
    try {
      await mkdir(folder.path, { recursive: true });
    } catch {
      console.warn(`Could not create default folder on disk: ${folder.path}`);
    }
  }

  return AppSettingsSchema.parse({
    globalFolders: [downloadsFolder, importedFolder],
    downloadFolderId: downloadsFolder.id,
    importFolderId: importedFolder.id,
  });
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
    await atomicWriteJson(filePath, defaults);
    return defaults;
  }

  const text = await readTextFile(filePath);
  const parsed = JSON.parse(text);
  return AppSettingsSchema.parse(parsed);
}

export async function saveAppSettings(settings: AppSettings): Promise<void> {
  const filePath = await getSettingsFilePath();
  await atomicWriteJson(filePath, settings);
}
