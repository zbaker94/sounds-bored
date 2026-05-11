import { invoke } from "@tauri-apps/api/core";
import { dirname } from "@tauri-apps/api/path";
import { type OpenDialogOptions } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";

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
 * Dialog and scope-grant are handled atomically in Rust.
 * Returns null when the user cancels.
 */
export async function pickFolder(options?: FolderPickerOptions): Promise<string | null> {
  try {
    return await invoke<string | null>("pick_folder_and_grant", {
      title: options?.title ?? null,
      defaultPath: options?.defaultPath ?? null,
    });
  } catch (err) {
    toast.error(`Cannot use that folder: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Opens a native file picker and, if the user selects a file, grants runtime
 * fs-scope access to its parent directory before returning the path.
 * Returns null when the user cancels.
 */
export async function pickFile(options?: FilePickerOptions): Promise<string | null> {
  return invoke<string | null>("pick_file_and_grant", {
    title: options?.title ?? null,
    defaultPath: options?.defaultPath ?? null,
    filters: options?.filters ?? null,
  });
}

/**
 * Opens a native multi-file picker and, if the user selects files, grants
 * runtime fs-scope access to their unique parent directories before returning
 * the paths. Returns an empty array when the user cancels.
 */
export async function pickFiles(options?: FilePickerOptions): Promise<string[]> {
  return invoke<string[]>("pick_files_and_grant", {
    title: options?.title ?? null,
    defaultPath: options?.defaultPath ?? null,
    filters: options?.filters ?? null,
  });
}

/**
 * Opens a path in the OS file explorer. Routes through a Rust command so
 * user-chosen project paths outside the static opener capability allowlist
 * work correctly. Validates via validate_grant_path + fs-scope server-side.
 *
 * Throws on validation failure or OS opener error — callers must catch.
 * The path must be in scope (via restorePathScope or a picker) before calling.
 */
export async function openPathInExplorer(path: string): Promise<void> {
  await invoke("open_path_in_explorer", { path });
}

/**
 * Restores runtime fs-scope access for a path previously selected by the user
 * and persisted to disk (e.g. a project folder from history or a global
 * library folder from app settings). Tauri's allow_directory grants are
 * session-only and lost on restart.
 */
export async function restorePathScope(path: string): Promise<void> {
  await invoke("restore_path_scope", { path });
}

/**
 * Grants runtime fs-scope access to the unique parent directories of the
 * given file paths. Intended for OS drag-and-drop events where the user
 * provides paths directly (not via a picker dialog). Uses allSettled so a
 * single bad path does not prevent remaining grants from running.
 *
 * Path safety relies on `restore_path_scope`/`validate_grant_path` enforcement
 * in Rust — not on a dialog. Callers must supply only OS-originating paths
 * (e.g. from Tauri's drag-drop event), never user-constructed strings.
 */
export async function grantDroppedPaths(filePaths: string[]): Promise<void> {
  const uniqueParents = new Set<string>();
  for (const p of filePaths) {
    uniqueParents.add(await dirname(p));
  }
  await Promise.allSettled([...uniqueParents].map((p) => restorePathScope(p)));
}
