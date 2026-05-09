import { memo } from "react";
import { useShallow } from "zustand/react/shallow";
import { usePlaybackStore } from "@/state/playbackStore";
import { useLayerMetricsStore } from "@/state/layerMetricsStore";

interface PadButtonProgressProps {
  padId: string;
  layerIds: string[];
}

const EMPTY_IDS: readonly string[] = [];
const EMPTY_RECORD: Record<string, number> = {};

// Compares layerIds by value so React.memo skips re-renders when the parent
// passes a new array reference but the layer set is unchanged (common on any
// updateProject() call via Immer, which creates new pad.layers references).
export function arePropsEqual(
  prev: PadButtonProgressProps,
  next: PadButtonProgressProps,
): boolean {
  if (prev.padId !== next.padId) return false;
  if (prev.layerIds === next.layerIds) return true;
  if (prev.layerIds.length !== next.layerIds.length) return false;
  return prev.layerIds.every((id, i) => id === next.layerIds[i]);
}

/**
 * Renders per-layer playback progress bars inside a pad button.
 *
 * Subscribes directly to playbackStore and layerMetricsStore so that 60Hz RAF
 * tick updates are isolated to this component — PadButton itself does not
 * re-render on ticks. Receives layerIds (not Layer objects) so that Immer
 * reference churn from unrelated project mutations does not trigger re-renders.
 * Returns null when the pad is not playing or has no active layers.
 */
export const PadButtonProgress = memo(function PadButtonProgress({
  padId,
  layerIds,
}: PadButtonProgressProps) {
  const isPlaying = usePlaybackStore((s) => s.playingPadIds.has(padId));

  // Both selectors run every RAF tick while playing; stable empty constants
  // short-circuit the idle case to avoid per-frame allocations across all pads.
  const activeLayerIds = useLayerMetricsStore(
    useShallow((s) => {
      if (!isPlaying || layerIds.length === 0) return EMPTY_IDS;
      return layerIds.filter((id) => s.activeLayerIds.has(id));
    }),
  );

  const layerProgress = useLayerMetricsStore(
    useShallow((s) => {
      if (!isPlaying || layerIds.length === 0) return EMPTY_RECORD;
      const result: Record<string, number> = {};
      for (const id of layerIds) {
        const p = s.layerProgress[id];
        if (p !== undefined) result[id] = p;
      }
      return result;
    }),
  );

  if (!isPlaying || activeLayerIds.length === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col">
      {activeLayerIds.map((id) => (
        <div key={id} className="relative overflow-hidden flex-1">
          <div
            data-testid="pad-layer-progress-bar"
            className="absolute top-0 left-0 bottom-0 bg-white/20 border border-white rounded-r"
            style={{ width: `${(layerProgress[id] ?? 0) * 100}%` }}
          />
        </div>
      ))}
    </div>
  );
}, arePropsEqual);
