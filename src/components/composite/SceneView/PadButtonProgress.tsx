import { memo } from "react";
import { useShallow } from "zustand/react/shallow";
import { usePlaybackStore } from "@/state/playbackStore";
import type { Layer } from "@/lib/schemas";

interface PadButtonProgressProps {
  padId: string;
  layers: Layer[];
}

/**
 * Renders per-layer playback progress bars inside a pad button.
 *
 * Subscribes directly to playbackStore so that 60Hz RAF tick updates are
 * isolated to this component — PadButton itself does not re-render on ticks.
 * Returns null when the pad is not playing or has no active layers.
 */
export const PadButtonProgress = memo(function PadButtonProgress({
  padId,
  layers,
}: PadButtonProgressProps) {
  const isPlaying = usePlaybackStore((s) => s.playingPadIds.has(padId));

  // Stable array reference while the same layers are active — only changes on
  // layer start/stop, not every RAF frame.
  const activeLayers = usePlaybackStore(
    useShallow((s) => layers.filter((l) => s.activeLayerIds.has(l.id))),
  );

  // Only re-renders THIS pad when ITS layer progress changes. Non-playing pads
  // return {} (stable via shallow equality) and never re-render on audio ticks.
  //
  // Perf note: this iterates `layers` (the pad's own layer list, typically 1–3
  // entries) — not the global layer set. O(pad.layers) per tick per playing pad
  // is negligible; no need to pre-filter by activeLayerIds before the lookup.
  const layerProgress = usePlaybackStore(
    useShallow((s) => {
      const result: Record<string, number> = {};
      for (const l of layers) {
        const p = s.layerProgress[l.id];
        if (p !== undefined) result[l.id] = p;
      }
      return result;
    }),
  );

  if (!isPlaying || activeLayers.length === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col">
      {activeLayers.map((layer) => (
        <div key={layer.id} className="relative overflow-hidden flex-1">
          <div
            className="absolute top-0 left-0 bottom-0 bg-white/20 border border-white rounded-r"
            style={{ width: `${(layerProgress[layer.id] ?? 0) * 100}%` }}
          />
        </div>
      ))}
    </div>
  );
});
