import { invoke } from "@tauri-apps/api/core";
import { dirname } from "@tauri-apps/api/path";
import { open, type OpenDialogOptions } from "@tauri-apps/plugin-dialog";

export async function grantPathAccess(folderPath: string): Promise<void> {
  await invoke("grant_path_access", { path: folderPath });
}

function isRootPath(path: string): boolean {
  if (path === "" || path === "/") return true;
  // Null bytes, ASCII control characters (0x00–0x1F), and DEL (0x7F) — never present in
  // legitimate dialog-returned paths. Mirrors validate_grant_path in src-tauri/src/commands.rs.
  if (/[\x00-\x1f\x7f]/.test(path)) return true;
  // Windows drive root: "C:", "C:\", "C:/"
  if (/^[A-Za-z]:[/\\]?$/.test(path)) return true;
  // DOS device namespace \\. or //. — block all forms (never produced by native dialogs)
  if (/^[/\\]{2}\.[/\\]/.test(path)) return true;
  // Windows extended-length prefix \\?\ or \\?/ or //?/ variants
  if (/^[/\\]{2}\?[/\\]/.test(path)) {
    const inner = path.slice(4).replace(/[/\\]+$/, "");
    if (inner === "") return true;
    // Extended-length drive root: \\?\C: or \\?\C:\
    if (/^[A-Za-z]:[/\\]?$/.test(inner)) return true;
    // Extended-length UNC share root: \\?\UNC\server\share (one or more separators at each interior position)
    if (/^UNC[/\\]+[^/\\]+[/\\]+[^/\\]+[/\\]?$/i.test(inner)) return true;
    // Device namespace: \\?\GLOBALROOT\... — can bypass normal ACL checks
    if (/^GLOBALROOT([/\\]|$)/i.test(inner)) return true;
    // Device volume root: \\?\Volume{GUID} — equivalent to a drive root on Windows
    if (/^Volume\{[^}]+\}$/i.test(inner)) return true;
    // Allowlist catch-all: only permit drive-letter subfolders, UNC subfolders, or
    // Volume GUID subfolders under \\?\. Everything else (HarddiskVolumeN, PhysicalDriveN,
    // PIPE, MAILSLOT, BootPartition, etc.) is an unrecognized device-namespace path.
    const isDriveSubfolder = /^[A-Za-z]:[/\\]/.test(inner);
    const isUncSubfolder = /^UNC[/\\]+[^/\\]+[/\\]+[^/\\]+[/\\]/i.test(inner);
    const isVolumeSubfolder = /^Volume\{[^}]+\}[/\\]/i.test(inner);
    if (!isDriveSubfolder && !isUncSubfolder && !isVolumeSubfolder) return true;
  }
  // UNC share root: \\server\share or //server/share (no further path segments)
  // Paths starting with \\.\ or \\?\ are already handled above
  if (/^[/\\]{2,}[^/\\]+[/\\]+[^/\\]+[/\\]*$/.test(path)) return true;
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
