import { writeTextFile, rename, remove } from "@tauri-apps/plugin-fs";

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
 * self-healed by subsequent writes. Callers may sweep `<filePath>.*.tmp` on
 * startup to avoid unbounded accumulation after crashes. See issue #307.
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
