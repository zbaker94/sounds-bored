import { Layer } from "@/lib/schemas";

export function createDefaultLayer(): Layer {
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
