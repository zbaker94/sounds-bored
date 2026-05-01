import { evictBuffer } from "./bufferCache";
import { evictStreamingElement } from "./streamingCache";

export function evictSoundCaches(soundId: string): void {
  evictBuffer(soundId);
  evictStreamingElement(soundId);
}

export function evictSoundCachesMany(ids: Iterable<string>): void {
  for (const id of ids) {
    evictSoundCaches(id);
  }
}
