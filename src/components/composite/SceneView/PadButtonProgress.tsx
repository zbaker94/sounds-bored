import { memo } from "react";
import { useShallow } from "zustand/react/shallow";
import { usePlaybackStore } from "@/state/playbackStore";
import { useLayerMetricsStore } from "@/state/layerMetricsStore";
import type { Layer } from "@/lib/schemas";

interface PadButtonProgressProps {
  padId: string;
  layers: Layer[];
}

const EMPTY_LAYERS: Layer[] = [];
const EMPTY_RECORD: Record<string, number> = {};

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

  // Short-circuits to a stable reference for non-playing pads, avoiding a
  // filter allocation on every RAF tick when this pad is idle. The selector
  // closes over `isPlaying` so when the pad is idle it returns a stable empty
  // reference; useShallow keeps the array reference stable across ticks while
  // playing.
  const activeLayers = useLayerMetricsStore(
    useShallow((s) => {
      if (!isPlaying) return EMPTY_LAYERS;
      return layers.filter((l) => s.activeLayerIds.has(l.id));
    }),
  );

  // Short-circuits to a stable reference for non-playing pads, avoiding a {}
  // allocation and layer iteration on every RAF tick when this pad is idle.
  const layerProgress = useLayerMetricsStore(
    useShallow((s) => {
      if (!isPlaying) return EMPTY_RECORD;
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
            data-testid="pad-layer-progress-bar"
            className="absolute top-0 left-0 bottom-0 bg-white/20 border border-white rounded-r"
            style={{ width: `${(layerProgress[layer.id] ?? 0) * 100}%` }}
          />
        </div>
      ))}
    </div>
  );
});
