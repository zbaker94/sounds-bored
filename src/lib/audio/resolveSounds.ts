import type { Layer, Sound } from "@/lib/schemas";

/**
 * Module-level WeakMap cache: Sound[] reference → Map<id, Sound>.
 * Re-used across all calls that share the same sounds array reference.
 * Exported only for test introspection — do not use in production code.
 *
 * Why WeakMap: libraryStore uses Immer, so the sounds array reference is
 * stable until the library changes (at which point Immer produces a new
 * reference and the old Map is naturally GC-eligible).
 */
export const _soundByIdCache = new WeakMap<Sound[], Map<string, Sound>>();

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
      let cached = _soundByIdCache.get(sounds);
      if (!cached) {
        cached = new Map(sounds.map((s) => [s.id, s]));
        _soundByIdCache.set(sounds, cached);
      }
      const soundById = cached;
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
    default: {
      const _exhaustive: never = sel;
      return _exhaustive;
    }
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
 *
 * NOTE: Unlike `resolveLayerSounds`, this function filters by filePath — it is
 * intended for UI validation checks (e.g., "are there any playable sounds for
 * this tag selection?"). New code should prefer `resolveLayerSounds` for
 * full resolution and apply `.filter(s => !!s.filePath)` explicitly if needed.
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
