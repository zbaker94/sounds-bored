import type { Layer, LayerConfigForm, Sound, Tag, SoundSet } from "@/lib/schemas";

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

/**
 * Maps store Layer fields to LayerConfigForm for react-hook-form initialization.
 * The output reflects the store state verbatim — it is not guaranteed to pass
 * LayerConfigFormSchema validation (e.g. an empty `instances` array is valid in
 * the store but rejected by the form schema). Callers must handle validation
 * separately before submission.
 */
export function layerToFormLayer(layer: Layer): LayerConfigForm {
  return {
    id: layer.id,
    selection: layer.selection,
    arrangement: layer.arrangement,
    cycleMode: layer.cycleMode,
    playbackMode: layer.playbackMode,
    retriggerMode: layer.retriggerMode,
    volume: layer.volume,
  };
}

export function formLayerToLayer(form: LayerConfigForm): Layer {
  return {
    id: form.id,
    selection: form.selection,
    arrangement: form.arrangement,
    cycleMode: form.cycleMode,
    playbackMode: form.playbackMode,
    retriggerMode: form.retriggerMode,
    volume: form.volume,
  };
}

export function createDefaultLayer(): LayerConfigForm {
  return {
    id: crypto.randomUUID(),
    selection: { type: 'assigned', instances: [] },
    arrangement: 'simultaneous',
    cycleMode: false,
    playbackMode: 'one-shot',
    retriggerMode: 'restart',
    volume: 100,
  };
}

export function createDefaultStoreLayer(): Layer {
  return formLayerToLayer(createDefaultLayer());
}
