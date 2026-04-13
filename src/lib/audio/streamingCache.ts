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

// ---------------------------------------------------------------------------
// Streaming element cache
// ---------------------------------------------------------------------------

/**
 * Internal entry. `sourceNode` is null until the first trigger because
 * MediaElementAudioSourceNode requires an AudioContext that may not exist yet
 * when we pre-load (e.g. before first user interaction).
 */
interface StreamingElementEntry {
  audio: HTMLAudioElement;
  sourceNode: MediaElementAudioSourceNode | null;
  /** The AudioContext that owns sourceNode. Used to detect stale entries after a context change. */
  ownerCtx: AudioContext | null;
}

const streamingElementCache = new Map<string, StreamingElementEntry>();

/**
 * Pre-warm a streaming element by starting audio buffering before the first
 * trigger. Does NOT require an AudioContext — the HTMLAudioElement buffers
 * independently of the Web Audio graph.
 *
 * Call this when pads are rendered so the file is already in memory by the
 * time the user presses the pad, eliminating first-trigger latency.
 * No-op if an entry already exists for this sound.
 */
function createStreamingAudioElement(url: string): HTMLAudioElement {
  const audio = new Audio();
  audio.crossOrigin = "anonymous";
  audio.preload = "auto";
  audio.src = url;
  return audio;
}

export function preloadStreamingAudio(sound: Sound): void {
  if (!sound.filePath || streamingElementCache.has(sound.id)) return;

  const url = convertFileSrc(sound.filePath);
  const audio = createStreamingAudioElement(url);
  streamingElementCache.set(sound.id, { audio, sourceNode: null, ownerCtx: null });
}

/**
 * Returns a pre-buffered HTMLAudioElement + MediaElementAudioSourceNode for
 * the given sound, creating and caching an entry on first call.
 *
 * If `preloadStreamingAudio` was called earlier, the audio is already buffered
 * and playback starts with near-zero latency. The MediaElementAudioSourceNode
 * is created lazily here (requires an AudioContext).
 *
 * The caller must:
 *   1. Call sourceNode.disconnect() to remove stale audio-graph connections.
 *   2. Reset audio.currentTime before calling play().
 *   3. Set audio.loop as needed.
 */
export function getOrCreateStreamingElement(
  sound: Sound,
  ctx: AudioContext,
): { audio: HTMLAudioElement; sourceNode: MediaElementAudioSourceNode } {
  let entry = streamingElementCache.get(sound.id);

  if (!entry) {
    const url = convertFileSrc(sound.filePath!);
    const audio = createStreamingAudioElement(url);
    entry = { audio, sourceNode: null, ownerCtx: null };
    streamingElementCache.set(sound.id, entry);
  }

  // If the sourceNode was created for a different AudioContext (e.g. after a dev HMR
  // reload), it can never be reused — MediaElementAudioSourceNode is permanently
  // bound to its context. Create a fresh HTMLAudioElement + sourceNode.
  if (entry.sourceNode && entry.ownerCtx !== ctx) {
    entry.sourceNode.disconnect();
    const existingSrc = entry.audio.src;
    entry.audio.pause();
    entry.audio.src = "";
    entry.audio = createStreamingAudioElement(existingSrc);
    entry.sourceNode = null;
    entry.ownerCtx = null;
  }

  if (!entry.sourceNode) {
    entry.sourceNode = ctx.createMediaElementSource(entry.audio);
    entry.ownerCtx = ctx;
  }

  return { audio: entry.audio, sourceNode: entry.sourceNode };
}

/** Remove a single entry when a sound file is replaced on disk. */
export function evictStreamingElement(soundId: string): void {
  const entry = streamingElementCache.get(soundId);
  if (entry) {
    entry.audio.pause();
    entry.audio.src = "";
    streamingElementCache.delete(soundId);
  }
}

/** Clear the entire streaming element cache (call on app reset / tests). */
export function clearAllStreamingElements(): void {
  for (const entry of streamingElementCache.values()) {
    entry.audio.pause();
    entry.audio.src = "";
  }
  streamingElementCache.clear();
}

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
