import { useMemo } from "react";
import Fuse from "fuse.js";
import type { Sound, Tag } from "@/lib/schemas";

export type SoundSearchDoc = { sound: Sound; tagNames: string[] };

export function useSoundStats(sounds: Sound[], tags: Tag[]) {
  const searchDocs = useMemo(
    () =>
      sounds.map((sound) => ({
        sound,
        tagNames: sound.tags.map(
          (tid) => tags.find((t) => t.id === tid)?.name ?? ""
        ),
      })),
    [sounds, tags]
  );

  const fuse = useMemo(
    () =>
      new Fuse(searchDocs, {
        keys: ["sound.name", "tagNames"],
        threshold: 0.4,
      }),
    [searchDocs]
  );

  // Memo deps exclude tags — counts key off IDs, not resolved names.
  const { tagCountMap, setCountMap } = useMemo(() => {
    const tc: Record<string, number> = {};
    const sc: Record<string, number> = {};
    for (const s of sounds) {
      for (const tid of s.tags) tc[tid] = (tc[tid] ?? 0) + 1;
      for (const sid of s.sets) sc[sid] = (sc[sid] ?? 0) + 1;
    }
    return { tagCountMap: tc, setCountMap: sc };
  }, [sounds]);

  return { tagCountMap, setCountMap, fuse };
}
