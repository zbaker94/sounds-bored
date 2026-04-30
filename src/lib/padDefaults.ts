import type { Layer, LayerConfigForm, Pad, PadConfig } from "@/lib/schemas";

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
