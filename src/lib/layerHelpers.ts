import type { Layer, Sound, Tag, SoundSet } from "@/lib/schemas";

/**
 * Produce a short human-readable summary of a layer's sound selection,
 * suitable for display in the pad back-face layer row.
 *
 * `sounds` is expected to be the already-resolved list of sounds for this
 * layer (e.g. the output of `resolveLayerSounds(layer, library.sounds)`).
 */
export function summarizeLayerSelection(
  layer: Layer,
  sounds: Sound[],
  tags: Tag[],
  sets: SoundSet[]
): string {
  const sel = layer.selection;
  switch (sel.type) {
    case "assigned":
      return sounds.length === 0
        ? "No sounds assigned"
        : sounds.map((s) => s.name).join(", ");
    case "tag": {
      const names = sel.tagIds.map((id) => tags.find((t) => t.id === id)?.name ?? id).join(", ");
      return `Tag: ${names || "\u2014"}`;
    }
    case "set": {
      const name = sets.find((s) => s.id === sel.setId)?.name ?? sel.setId;
      return `Set: ${name}`;
    }
  }
}
