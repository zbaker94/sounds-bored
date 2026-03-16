import { GlobalLibrary, GlobalLibrarySchema } from "./schemas";
import { appDataDir, join } from "@tauri-apps/api/path";
import { readTextFile, writeTextFile, exists } from "@tauri-apps/plugin-fs";
import { APP_FOLDER, LIBRARY_FILE_NAME } from "./constants";

export async function getLibraryFilePath(): Promise<string> {
  const dir = await appDataDir();
  return await join(dir, APP_FOLDER, LIBRARY_FILE_NAME);
}

export async function loadGlobalLibrary(): Promise<GlobalLibrary> {
  const filePath = await getLibraryFilePath();

  if (!(await exists(filePath))) {
    return { version: "1.0.0", sounds: [], tags: [], sets: [] };
  }

  const text = await readTextFile(filePath);
  const parsed = JSON.parse(text);
  return GlobalLibrarySchema.parse(parsed);
}

export async function saveGlobalLibrary(library: GlobalLibrary): Promise<void> {
  const filePath = await getLibraryFilePath();
  await writeTextFile(filePath, JSON.stringify(library, null, 2));
}
