import { memo } from "react";
import type { Pad } from "@/lib/schemas";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";
import { BackFaceLayerRow } from "./BackFaceLayerRow";

interface PadLayerSectionProps {
  pad: Pad;
  onAddLayer: () => void;
  onEditLayer: (index: number) => void;
  onRemoveLayer: (index: number) => void;
}

export const PadLayerSection = memo(function PadLayerSection({
  pad,
  onAddLayer,
  onEditLayer,
  onRemoveLayer,
}: PadLayerSectionProps) {
  return (
    <div className="flex flex-col gap-1 flex-shrink-0">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-muted-foreground uppercase tracking-wide">Layers</h4>
        <button
          type="button"
          aria-label="Add layer"
          onClick={onAddLayer}
          className="p-0.5 rounded hover:bg-muted transition-colors"
        >
          <HugeiconsIcon icon={Add01Icon} size={18} />
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {pad.layers.map((layer, i) => (
          <BackFaceLayerRow
            key={layer.id}
            pad={pad}
            layer={layer}
            index={i}
            onEditLayer={() => onEditLayer(i)}
            onRemoveLayer={() => onRemoveLayer(i)}
          />
        ))}
      </div>
    </div>
  );
});
