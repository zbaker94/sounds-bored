import { invoke } from "@tauri-apps/api/core";
import { dirname } from "@tauri-apps/api/path";
import { open, type OpenDialogOptions } from "@tauri-apps/plugin-dialog";

export async function grantPathAccess(folderPath: string): Promise<void> {
  await invoke("grant_path_access", { path: folderPath });
}

function isRootPath(path: string): boolean {
  if (path === "/") return true;
  // Windows drive root: "C:", "C:\", "C:/"
  if (/^[A-Za-z]:[/\\]?$/.test(path)) return true;
  return false;
}

export async function grantParentAccess(filePath: string): Promise<void> {
  const parent = await dirname(filePath);
  if (isRootPath(parent)) return;
  await grantPathAccess(parent);
}

/** Options forwarded to the native folder picker dialog. */
export interface FolderPickerOptions {
  title?: string;
  defaultPath?: string;
}

/** Options forwarded to the native file picker dialog. */
export interface FilePickerOptions {
  title?: string;
  defaultPath?: string;
  filters?: OpenDialogOptions["filters"];
}

/**
 * Opens a native folder picker and, if the user selects a folder, grants
 * runtime fs-scope access to it before returning the path.
 * Returns null when the user cancels.
 */
export async function pickFolder(options?: FolderPickerOptions): Promise<string | null> {
  const selected = await open({ ...options, directory: true, multiple: false });
  const path = Array.isArray(selected) ? (selected[0] ?? null) : selected;
  if (path) await grantPathAccess(path);
  return path;
}

/**
 * Opens a native file picker and, if the user selects a file, grants runtime
 * fs-scope access to its parent directory before returning the path.
 * Returns null when the user cancels.
 */
export async function pickFile(options?: FilePickerOptions): Promise<string | null> {
  const selected = await open({ ...options, multiple: false });
  const path = Array.isArray(selected) ? (selected[0] ?? null) : selected;
  if (path) await grantParentAccess(path);
  return path;
}

/**
 * Grants runtime fs-scope access to the unique parent directories of the
 * given file paths. Skips root paths. Uses allSettled so a single bad path
 * does not prevent the remaining grants from running.
 */
export async function grantParentDirectories(filePaths: string[]): Promise<void> {
  const uniqueParents = new Set<string>();
  for (const p of filePaths) {
    const parent = await dirname(p);
    if (!isRootPath(parent)) uniqueParents.add(parent);
  }
  await Promise.allSettled([...uniqueParents].map((p) => grantPathAccess(p)));
}

/**
 * Opens a native multi-file picker and, if the user selects files, grants
 * runtime fs-scope access to their unique parent directories before returning
 * the paths. Returns an empty array when the user cancels.
 */
export async function pickFiles(options?: FilePickerOptions): Promise<string[]> {
  const selected = await open({ ...options, multiple: true });
  if (!selected) return [];
  const paths = Array.isArray(selected) ? selected : [selected];
  await grantParentDirectories(paths);
  return paths;
}
