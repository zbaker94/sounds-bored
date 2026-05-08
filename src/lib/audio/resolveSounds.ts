import type { Layer, Sound } from "@/lib/schemas";

/**
 * Branded type for a Sound[] captured at a defined moment in time.
 * Distinguishable from a live-store reference at compile time; identical at runtime.
 *
 * Use `snapshotSounds()` to create a SoundSnapshot. Pass to `resolveLayerSounds` / `resolveSounds`.
 */
export type SoundSnapshot = Sound[] & { readonly __brand: "SoundSnapshot" };

/**
 * Mark a Sound[] as captured at this point in time. Zero runtime cost — no copy, no allocation.
 *
 * IMPORTANT: This does NOT defensively copy. Stability across the snapshot's lifetime
 * depends on the caller's source being structurally immutable after capture. `libraryStore`
 * satisfies this via Immer: every mutation produces a new array reference, so an existing
 * snapshot cannot be mutated in place. Do not call from a code path that mutates Sound[] directly.
 */
export function snapshotSounds(sounds: Sound[]): SoundSnapshot {
  return sounds as SoundSnapshot;
}

/**
 * Module-level WeakMap cache: Sound[] reference → Map<id, Sound>.
 * Re-used across all calls that share the same sounds array reference.
 * Exported only for test introspection — do not use in production code.
 *
 * Why WeakMap: libraryStore uses Immer, so the sounds array reference is
 * stable until the library changes (at which point Immer produces a new
 * reference and the old Map is naturally GC-eligible).
 *
 * Keyed on SoundSnapshot to match the resolveLayerSounds parameter contract —
 * only explicitly snapshotted arrays should enter the cache.
 */
export const _soundByIdCache = new WeakMap<SoundSnapshot, Map<string, Sound>>();

/**
 * Module-level cache for tag and set selections.
 * Outer key: Sound[] reference. Inner key: normalized selection key string.
 * Exported only for test introspection — do not use in production code.
 *
 * Eliminates redundant O(n) filters when multiple layers share the same
 * tag/set selection against the same sounds array reference (same Immer
 * snapshot). Each Immer update produces a new Sound[] reference, which
 * naturally evicts the prior inner map via WeakMap GC semantics.
 *
 * IMPORTANT: Callers must not mutate the returned arrays — they are shared
 * references. All current consumers read-only (length checks, iteration,
 * spread to new arrays).
 */
export const _tagSetCache = new WeakMap<SoundSnapshot, Map<string, Sound[]>>();

/** Normalized cache key for tag/set selections.
 *  Uses JSON.stringify to safely encode tag IDs that may contain any character. */
function tagSetKey(sel: { type: "tag"; tagIds: string[]; matchMode: "any" | "all" } | { type: "set"; setId: string }): string {
  return sel.type === "tag"
    ? `t:${JSON.stringify([...sel.tagIds].sort())}:${sel.matchMode}`
    : `s:${JSON.stringify(sel.setId)}`;
}

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
export function resolveLayerSounds(layer: Layer, sounds: SoundSnapshot): Sound[] {
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
      const key = tagSetKey(sel);
      let inner = _tagSetCache.get(sounds);
      if (inner?.has(key)) return inner.get(key)!;
      const result = sounds.filter((s) =>
        sel.matchMode === "all"
          ? sel.tagIds.every((id) => s.tags.includes(id))
          : sel.tagIds.some((id) => s.tags.includes(id)),
      );
      if (!inner) { inner = new Map(); _tagSetCache.set(sounds, inner); }
      inner.set(key, result);
      return result;
    }
    case "set": {
      const key = tagSetKey(sel);
      let inner = _tagSetCache.get(sounds);
      if (inner?.has(key)) return inner.get(key)!;
      const result = sounds.filter((s) => s.sets.includes(sel.setId));
      if (!inner) { inner = new Map(); _tagSetCache.set(sounds, inner); }
      inner.set(key, result);
      return result;
    }
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

/**
 * Filter sounds belonging to a set, excluding those with missing file paths.
 *
 * Mirrors `filterSoundsByTags` — intended for UI validation checks only.
 * Prefer `resolveLayerSounds` + `.filter(s => !!s.filePath)` for full resolution.
 */
export function filterSoundsBySet(sounds: Sound[], setId: string): Sound[] {
  return sounds.filter((s) => s.sets.includes(setId) && !!s.filePath);
}
