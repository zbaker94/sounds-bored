import type { Sound } from "@/lib/schemas";

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
