import { convertFileSrc } from "@tauri-apps/api/core";
import type { Sound } from "@/lib/schemas";

/**
 * Compressed files at or above this size are routed to the HTMLAudioElement
 * streaming path instead of the AudioBuffer decode path.
 * 20 MB: at 128 kbps MP3 ≈ 20 minutes audio; a 20 MB WAV ≈ 55 s.
 */
export const LARGE_FILE_THRESHOLD_BYTES = 20 * 1024 * 1024;

/** Cache: sound.id → isLarge. Avoids a HEAD request on every trigger. */
const sizeCache = new Map<string, boolean>();

/**
 * Returns true when the sound's compressed file is at or above the 20 MB
 * threshold, meaning it should be played via the streaming path.
 *
 * Caches the result per sound ID (including false on fetch failure, so a
 * broken file path does not hammer the network on every pad trigger).
 * Returns false (safe fallback: buffer path) when the file has no path,
 * the fetch fails, or Content-Length is absent.
 */
export async function checkIsLargeFile(sound: Sound): Promise<boolean> {
  if (!sound.filePath) return false;
  if (sizeCache.has(sound.id)) return sizeCache.get(sound.id)!;

  // Fast path: use pre-populated file size from schema (populated at reconcile/download time)
  if (sound.fileSizeBytes !== undefined) {
    const isLarge = sound.fileSizeBytes >= LARGE_FILE_THRESHOLD_BYTES;
    sizeCache.set(sound.id, isLarge);
    return isLarge;
  }

  // Slow path: fall back to HTTP HEAD request (first trigger before reconcile runs)
  const url = convertFileSrc(sound.filePath);
  let isLarge = false;
  try {
    const response = await fetch(url, { method: "HEAD" });
    const contentLength = response.headers.get("Content-Length");
    if (contentLength !== null) {
      isLarge = parseInt(contentLength, 10) >= LARGE_FILE_THRESHOLD_BYTES;
    }
  } catch {
    // Network error or missing file — fall back to buffer path.
  }

  sizeCache.set(sound.id, isLarge);
  return isLarge;
}

/** Remove a single entry (e.g. after a sound file is replaced on disk). */
export function evictSizeCache(soundId: string): void {
  sizeCache.delete(soundId);
}

/** Clear the entire size cache. Call in tests (via beforeEach) and on app reset. */
export function clearAllSizeCache(): void {
  sizeCache.clear();
}
