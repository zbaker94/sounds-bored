import type { Layer, LayerConfigForm } from "@/lib/schemas";

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
