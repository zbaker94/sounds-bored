import { convertFileSrc } from "@tauri-apps/api/core";
import { getAudioContext } from "./audioContext";
import type { Sound } from "@/lib/schemas";
import { MissingFileError } from "@/lib/library.reconcile";
import { logInfo } from "@/lib/logger";
export { MissingFileError } from "@/lib/library.reconcile";

// Soft cap: a single entry exceeding this limit is kept to avoid an unbounded re-decode loop.
// Targets ~10% of a typical 2 GB RAM budget; balances re-decode cost vs memory pressure.
export const BUFFER_CACHE_MAX_BYTES = 200 * 1024 * 1024;

const cache = new Map<string, AudioBuffer>();
const sizes = new Map<string, number>();
const inflight = new Map<string, Promise<AudioBuffer>>();
let totalBytes = 0;
let maxBytes = BUFFER_CACHE_MAX_BYTES;

function computeByteSize(buffer: AudioBuffer): number {
  return buffer.numberOfChannels * buffer.length * 4;
}

function deleteEntry(id: string): void {
  totalBytes -= sizes.get(id) ?? 0;
  cache.delete(id);
  sizes.delete(id);
}

function evictLRU(): void {
  const id = cache.keys().next().value;
  if (id === undefined) return;
  logInfo("bufferCache: evicting LRU entry", { id, freedBytes: sizes.get(id) ?? 0 });
  deleteEntry(id);
}

export async function loadBuffer(sound: Sound): Promise<AudioBuffer> {
  const cached = cache.get(sound.id);
  if (cached) {
    // Map insertion order is the LRU recency signal; delete+set moves this id to the tail.
    cache.delete(sound.id);
    cache.set(sound.id, cached);
    return cached;
  }

  const pending = inflight.get(sound.id);
  if (pending) return pending;

  if (!sound.filePath) throw new MissingFileError(`Sound "${sound.name}" has no file path`);

  const ctx = getAudioContext();
  const url = convertFileSrc(sound.filePath);

  const p = (async () => {
    let response: Response;
    try {
      response = await fetch(url);
    } catch (err) {
      throw new MissingFileError(`Could not load "${sound.name}" (url: ${url}): ${err}`);
    }
    if (!response.ok) throw new MissingFileError(`File not found for "${sound.name}" (status: ${response.status}, url: ${url})`);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = await ctx.decodeAudioData(arrayBuffer);

    const bytes = computeByteSize(buffer);
    cache.set(sound.id, buffer);
    sizes.set(sound.id, bytes);
    totalBytes += bytes;

    // Active voices hold their own AudioBuffer ref, so evicting from the Map is
    // safe — in-flight playback continues uninterrupted; only re-triggers re-decode.
    while (totalBytes > maxBytes && cache.size > 1) {
      evictLRU();
    }

    return buffer;
  })().finally(() => inflight.delete(sound.id));

  inflight.set(sound.id, p);
  return p;
}

export function evictBuffer(soundId: string): void {
  if (!sizes.has(soundId)) return;
  deleteEntry(soundId);
}

/** Clear the entire buffer cache (call on project close / app reset). */
export function clearAllBuffers(): void {
  cache.clear();
  sizes.clear();
  totalBytes = 0;
}

export function _getCacheStats(): { entries: number; totalBytes: number } {
  return { entries: cache.size, totalBytes };
}

/** Test-only: override the 200 MB default cap. Reset to BUFFER_CACHE_MAX_BYTES in afterEach/beforeEach. */
export function _setMaxBytes(n: number): void {
  maxBytes = n;
}
