import { convertFileSrc } from "@tauri-apps/api/core";
import { getAudioContext } from "./audioContext";
import type { Sound } from "@/lib/schemas";

const cache = new Map<string, AudioBuffer>();

export async function loadBuffer(sound: Sound): Promise<AudioBuffer> {
  const cached = cache.get(sound.id);
  if (cached) return cached;

  if (!sound.filePath) throw new Error(`Sound "${sound.name}" has no file path`);

  const ctx = getAudioContext();
  const url = convertFileSrc(sound.filePath);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch "${sound.name}": ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  const buffer = await ctx.decodeAudioData(arrayBuffer);
  cache.set(sound.id, buffer);
  return buffer;
}

export function evictBuffer(soundId: string): void {
  cache.delete(soundId);
}
