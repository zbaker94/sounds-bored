import type { Layer, Sound } from "@/lib/schemas";

/**
 * Resolve a layer's selection (assigned / tag / set) into the matching Sound[].
 *
 * Does NOT filter by filePath — returns all matching sounds including those
 * whose files are missing. Callers that need only playable sounds should apply
 * `.filter(s => !!s.filePath)` after calling this function.
 *
 * This is the single source of truth for LayerSelection → Sound[] resolution.
 * All four consumers (playback, UI, export, preload) delegate here to ensure
 * consistent behaviour across selection types.
 */
export function resolveLayerSounds(layer: Layer, sounds: Sound[]): Sound[] {
  const sel = layer.selection;
  switch (sel.type) {
    case "assigned": {
      const soundById = new Map(sounds.map((s) => [s.id, s]));
      return sel.instances
        .map((inst) => soundById.get(inst.soundId))
        .filter((s): s is Sound => s !== undefined);
    }
    case "tag": {
      if (sel.tagIds.length === 0) return [];
      return sounds.filter((s) =>
        sel.matchMode === "all"
          ? sel.tagIds.every((id) => s.tags.includes(id))
          : sel.tagIds.some((id) => s.tags.includes(id)),
      );
    }
    case "set":
      return sounds.filter((s) => s.sets.includes(sel.setId));
  }
}

/**
 * Filter sounds by tag IDs using either "any" (OR) or "all" (AND) matching.
 *
 * - "any": sound must have at least one of the specified tags
 * - "all": sound must have every specified tag
 *
 * Sounds without a filePath are always excluded.
 * An empty tagIds array always returns an empty result (guards against
 * `.every()` on an empty array returning true).
 */
export function filterSoundsByTags(
  sounds: Sound[],
  tagIds: string[],
  matchMode: "any" | "all",
): Sound[] {
  if (tagIds.length === 0) return [];
  return sounds.filter((s) => {
    if (!s.filePath) return false;
    return matchMode === "all"
      ? tagIds.every((tid) => s.tags.includes(tid))
      : tagIds.some((tid) => s.tags.includes(tid));
  });
}
