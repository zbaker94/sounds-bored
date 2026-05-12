import { memo } from "react";
import { useLayerMetricsStore } from "@/state/layerMetricsStore";

export const BackFaceLayerProgressBar = memo(function BackFaceLayerProgressBar({
  layerId,
}: {
  layerId: string;
}) {
  // Gate on activeLayerIds so idle layers skip the layerProgress lookup on every RAF tick.
  const progress = useLayerMetricsStore((s) =>
    s.activeLayerIds.has(layerId) ? (s.layerProgress[layerId] ?? 0) : null
  );

  if (progress === null) return null;

  return (
    <div className="h-0.5 rounded-full bg-muted overflow-hidden">
      <div
        data-testid="back-face-layer-progress-bar"
        className="h-full bg-primary/60 rounded-full"
        style={{ width: `${progress * 100}%` }}
      />
    </div>
  );
});
