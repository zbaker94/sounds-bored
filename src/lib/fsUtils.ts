import { writeTextFile, rename, remove, readDir, type DirEntry } from "@tauri-apps/plugin-fs";
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

/**
 * Removes any orphaned `<basename>.<uuid>.tmp` files left in the same directory
 * as `filePath` by prior crashed {@link atomicWriteText} calls.
 *
 * This is opportunistic cleanup — all errors are silently suppressed so that a
 * sweep failure never prevents the caller from loading its file.
 */
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
