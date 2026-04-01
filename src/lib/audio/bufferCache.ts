import { convertFileSrc } from "@tauri-apps/api/core";
import { getAudioContext } from "./audioContext";
import type { Sound } from "@/lib/schemas";
import { MissingFileError } from "@/lib/library.reconcile";
export { MissingFileError } from "@/lib/library.reconcile";

const cache = new Map<string, AudioBuffer>();

export async function loadBuffer(sound: Sound): Promise<AudioBuffer> {
  const cached = cache.get(sound.id);
  if (cached) return cached;

  if (!sound.filePath) throw new Error(`Sound "${sound.name}" has no file path`);

  const ctx = getAudioContext();
  const url = convertFileSrc(sound.filePath);
  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new MissingFileError(`Could not load "${sound.name}" (url: ${url}): ${err}`);
  }
  if (!response.ok) throw new MissingFileError(`File not found for "${sound.name}" (status: ${response.status}, url: ${url})`);
  const arrayBuffer = await response.arrayBuffer();
  const buffer = await ctx.decodeAudioData(arrayBuffer);
  cache.set(sound.id, buffer);
  return buffer;
}

export function evictBuffer(soundId: string): void {
  cache.delete(soundId);
}
