import { evictBuffer } from "./bufferCache";
import { evictStreamingElement, evictSizeCache } from "./streamingCache";

export function evictSoundCaches(soundId: string): void {
  evictBuffer(soundId);
  evictStreamingElement(soundId);
  evictSizeCache(soundId);
}

export function evictSoundCachesMany(ids: Iterable<string>): void {
  for (const id of ids) {
    evictSoundCaches(id);
  }
}
