import { writeTextFile, readTextFile, rename, remove, readDir, type DirEntry } from "@tauri-apps/plugin-fs";
import { dirname, basename, join } from "@tauri-apps/api/path";

/**
 * Atomically writes text to `filePath`. Guarantees all-or-nothing semantics
 * via write-to-temp-then-rename — `filePath` will contain either its previous
 * contents or the new contents, never partial contents from a crashed write.
 *
 * The temp file is placed in the same directory as `filePath` (required for
 * same-filesystem rename atomicity on POSIX/NTFS) and is given a UUID suffix
 * so concurrent calls to the same `filePath` each use a distinct temp file.
 *
 * @throws If either `writeTextFile` or `rename` fails, a best-effort cleanup of
 *         the `.tmp` file is attempted (cleanup errors are suppressed) and the
 *         original error is re-thrown. On `rename` failure, `filePath` retains
 *         its previous contents.
 *
 * Note: unlike a deterministic `.tmp` suffix, UUID-suffixed orphans are not
 * self-healed by subsequent writes. Call {@link sweepOrphanedTmpFiles} on
 * startup to remove any accumulated orphans from prior crashes.
 */
export async function atomicWriteText(filePath: string, text: string): Promise<void> {
  const tmpPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    await writeTextFile(tmpPath, text);
    await rename(tmpPath, filePath);
  } catch (err) {
    try { await remove(tmpPath); } catch { /* ignore cleanup errors */ }
    throw err;
  }
}

/**
 * Atomically writes `data` as pretty-printed JSON to `filePath`.
 * Delegates to {@link atomicWriteText} for write-to-temp-then-rename semantics.
 *
 * @throws TypeError if `data` contains circular references (from JSON.stringify).
 */
export async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  await atomicWriteText(filePath, JSON.stringify(data, null, 2));
}

const UUID_TMP_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/i;

/**
 * Removes any orphaned `<basename>.<uuid>.tmp` files left in the same directory
 * as `filePath` by prior crashed {@link atomicWriteText} calls.
 *
 * This is opportunistic cleanup — all errors are silently suppressed so that a
 * sweep failure never prevents the caller from loading its file.
 */
export async function sweepOrphanedTmpFiles(filePath: string): Promise<void> {
  try {
    const dir = await dirname(filePath);
    const base = await basename(filePath);
    const entries = await readDir(dir);
    const orphanPaths = await Promise.all(
      entries
        .filter((e): e is DirEntry & { name: string } =>
          typeof e.name === "string" &&
          e.name.startsWith(`${base}.`) &&
          UUID_TMP_RE.test(e.name.slice(base.length + 1)),
        )
        .map((e) => join(dir, e.name)),
    );
    await Promise.allSettled(orphanPaths.map((p) => remove(p)));
  } catch {
    // sweep is opportunistic — never block loading on cleanup failures
  }
}

export interface LoadJsonWithRecoveryOptions<T> {
  path: string;
  parse: (raw: unknown) => T;
  /** Must be JSON-serializable — written to disk via `atomicWriteJson` on recovery. */
  defaults: T;
  onCorruption?: (message: string) => void;
  corruptMessage: string;
  /**
   * Defaults to true; pass `false` to skip when the caller already swept
   * before an early-return branch and delegates here for the read+parse path.
   */
  sweep?: boolean;
}

/**
 * Reads and parses a JSON file, recovering automatically if the file is corrupt.
 *
 * Sweeps orphaned `.tmp` files before reading (unless `opts.sweep` is false).
 *
 * I/O errors from `readTextFile` propagate unchanged — callers should handle
 * permission or missing-file errors before calling this function.
 *
 * On `SyntaxError` from `JSON.parse` or any error from `opts.parse`, the corrupt
 * file is renamed to `<basename>.corrupt.json`, a fresh default is written in its
 * place, the optional `onCorruption` callback is invoked, and `opts.defaults` is
 * returned — callers never get an unrecoverable broken state.
 */
export async function loadJsonWithRecovery<T>(opts: LoadJsonWithRecoveryOptions<T>): Promise<T> {
  if (opts.sweep !== false) {
    await sweepOrphanedTmpFiles(opts.path);
  }
  const text = await readTextFile(opts.path);
  try {
    return opts.parse(JSON.parse(text));
  } catch {
    await backupCorruptFile(opts.path);
    await atomicWriteJson(opts.path, opts.defaults);
    opts.onCorruption?.(opts.corruptMessage);
    return opts.defaults;
  }
}

/**
 * Renames a corrupt file to `<basename>.corrupt.json` (or appends `.corrupt.json`
 * if the path has no `.json` extension) as part of a corrupt-JSON recovery flow.
 *
 * Single-backup-slot: if `<basename>.corrupt.json` already exists from a prior
 * crash, the rename call throws and this helper silently swallows the error —
 * the previous backup is preserved, and the caller's subsequent default-write
 * proceeds as normal. This behavior is intentional for simplicity.
 *
 * Other rename failures (e.g. filesystem does not support rename, permission
 * errors) are also swallowed so recovery proceeds regardless. This function
 * never throws.
 *
 * The caller is responsible for writing a fresh default and notifying the user
 * after this helper returns.
 */
export async function backupCorruptFile(filePath: string): Promise<void> {
  const backupPath = filePath.endsWith(".json")
    ? filePath.replace(/\.json$/, ".corrupt.json")
    : `${filePath}.corrupt.json`;
  try {
    await rename(filePath, backupPath);
  } catch {
    // Swallow rename errors — file may already exist as .corrupt.json,
    // filesystem may not support rename, etc. Recovery proceeds regardless.
  }
}
