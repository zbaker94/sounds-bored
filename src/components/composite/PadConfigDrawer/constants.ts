import type { LayerConfigForm } from "@/lib/schemas";

export const DEFAULT_LAYER: LayerConfigForm = {
  selection: { type: "assigned", instances: [] },
  arrangement: "simultaneous",
  playbackMode: "one-shot",
  retriggerMode: "restart",
  volume: 100,
};
