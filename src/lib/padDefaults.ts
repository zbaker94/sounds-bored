import type { Layer, LayerConfigForm, Pad, PadConfig, Scene } from "@/lib/schemas";

/**
 * Build an O(1) lookup map of padId → Pad across all scenes. Avoids the
 * O(scenes × pads) cost of scenes.flatMap(...).find(...) inside per-pad loops.
 */
export function buildPadMap(scenes: Scene[]): Map<string, Pad> {
  const map = new Map<string, Pad>();
  for (const scene of scenes) {
    for (const pad of scene.pads) {
      map.set(pad.id, pad);
    }
  }
  return map;
}

export function createDefaultLayer(): LayerConfigForm {
  return {
    id: crypto.randomUUID(),
    selection: { type: "assigned", instances: [] },
    arrangement: "simultaneous",
    cycleMode: false,
    playbackMode: "one-shot",
    retriggerMode: "restart",
    volume: 100,
  };
}

export function createDefaultStoreLayer(): Layer {
  return formLayerToLayer(createDefaultLayer());
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

export function padToConfig(pad: Pad, layers?: Layer[]): PadConfig {
  return {
    name: pad.name,
    layers: layers ?? pad.layers,
    muteTargetPadIds: pad.muteTargetPadIds,
    muteGroupId: pad.muteGroupId,
    color: pad.color,
    icon: pad.icon,
    fadeDurationMs: pad.fadeDurationMs,
    volume: pad.volume ?? 100,
    fadeTargetVol: pad.fadeTargetVol ?? 0,
  };
}
