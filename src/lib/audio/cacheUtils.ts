import { evictBuffer } from "@/lib/audio/bufferCache";
import { evictStreamingElement } from "@/lib/audio/streamingCache";

export function evictSoundCaches(soundId: string): void {
  evictBuffer(soundId);
  evictStreamingElement(soundId);
}

export function evictSoundCachesMany(ids: Iterable<string>): void {
  for (const id of ids) {
    evictSoundCaches(id);
  }
}
