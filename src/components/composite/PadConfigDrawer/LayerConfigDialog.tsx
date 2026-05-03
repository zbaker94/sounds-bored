import { useEffect } from "react";
import { useForm, FormProvider, type Resolver, type FieldPath } from "react-hook-form";
import { z } from "zod/v4";
import { zodResolver } from "@hookform/resolvers/zod";
import { useProjectStore } from "@/state/projectStore";
import { useUiStore, OVERLAY_ID, selectIsOverlayOpen } from "@/state/uiStore";
import { useLibraryStore } from "@/state/libraryStore";
import { PadConfigSchema } from "@/lib/schemas";
import type { PadConfigForm, Layer, Pad } from "@/lib/schemas";
import { padToConfig, layerToFormLayer, formLayerToLayer } from "@/lib/padDefaults";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LayerConfigSection } from "./LayerConfigSection";
import { syncLayerVolume, syncLayerConfig, getLayerNormalizedVolume, filterSoundsByTags, filterSoundsBySet } from "@/lib/audio";

const LAYER_DIALOG_SCHEMA = PadConfigSchema.extend({ name: z.string() });
const LAYER_DIALOG_RESOLVER = zodResolver(LAYER_DIALOG_SCHEMA) as Resolver<PadConfigForm>;

// ─── Component contract ───────────────────────────────────────────────────────

export interface LayerConfigDialogProps {
  pad: Pad;
  sceneId: string;
  layerIndex: number;
  onClose: () => void;
}

export function LayerConfigDialog(props: LayerConfigDialogProps) {
  const layer = props.pad.layers[props.layerIndex];
  if (!layer) return null;
  return <LayerConfigDialogInner {...props} layer={layer} />;
}

interface LayerConfigDialogInnerProps extends LayerConfigDialogProps {
  layer: Layer;
}

function LayerConfigDialogInner({ pad, sceneId, layerIndex, onClose, layer }: LayerConfigDialogInnerProps) {
  const isOpen = useUiStore(selectIsOverlayOpen(OVERLAY_ID.LAYER_CONFIG_DIALOG));
  const closeOverlay = useUiStore((s) => s.closeOverlay);
  const updatePad = useProjectStore((s) => s.updatePad);

  const methods = useForm<PadConfigForm>({
    // LAYER_DIALOG_RESOLVER overrides name to z.string() so a new pad with an
    // empty name doesn't block the Zod resolver from accepting an otherwise
    // valid layer config. The dialog never reads or writes the pad name.
    resolver: LAYER_DIALOG_RESOLVER,
    defaultValues: {
      name: pad.name,
      layers: [layerToFormLayer(layer)],
      fadeDurationMs: pad.fadeDurationMs,
      volume: pad.volume ?? 100,
      fadeTargetVol: pad.fadeTargetVol ?? 0,
    },
  });

  const { handleSubmit, reset, setError } = methods;

  // Re-populate form when the overlay opens or the target layer changes.
  useEffect(() => {
    if (!isOpen) return;
    reset({
      name: pad.name,
      layers: [layerToFormLayer(layer)],
      fadeDurationMs: pad.fadeDurationMs,
      volume: pad.volume ?? 100,
      fadeTargetVol: pad.fadeTargetVol ?? 0,
    });
  }, [isOpen, layer.id]);

  function handleClose() {
    closeOverlay(OVERLAY_ID.LAYER_CONFIG_DIALOG);
    onClose();
  }

  function onSubmit(data: PadConfigForm) {
    const sounds = useLibraryStore.getState().sounds;
    let hasError = false;

    // Validate tag/set selections (form wraps single layer at index 0).
    // This check cannot be expressed in Zod: LAYER_DIALOG_SCHEMA is a module-level
    // constant so it has no access to runtime library state (the sounds array).
    // Even a z.refine() callback would not help — the schema instance is fixed at
    // module load, not per-submit. Keep this out-of-band; do not consolidate into
    // the schema.
    const formLayer = data.layers[0];
    if (formLayer) {
      const sel = formLayer.selection;
      if (sel.type === "tag") {
        if (filterSoundsByTags(sounds, sel.tagIds, sel.matchMode).length === 0) {
          const field: FieldPath<PadConfigForm> = "layers.0.selection.tagIds";
          setError(field, {
            type: "manual",
            message: "No sounds in library match these tags",
          });
          hasError = true;
        }
      } else if (sel.type === "set") {
        if (filterSoundsBySet(sounds, sel.setId).length === 0) {
          const field: FieldPath<PadConfigForm> = "layers.0.selection.setId";
          setError(field, {
            type: "manual",
            message: "No sounds in library match this set",
          });
          hasError = true;
        }
      }
    }
    if (hasError) return;

    // Build the updated layers array by replacing the layer at layerIndex.
    const updatedLayer = formLayerToLayer(data.layers[0]);
    const newLayers: Layer[] = pad.layers.map((l, i) =>
      i === layerIndex ? updatedLayer : l
    );

    const config = padToConfig(pad, newLayers);
    updatePad(sceneId, pad.id, config);

    // Sync live-playing audio state.
    syncLayerVolume(updatedLayer.id, getLayerNormalizedVolume(updatedLayer));
    const originalLayer = pad.layers[layerIndex];
    if (originalLayer) syncLayerConfig(updatedLayer, originalLayer);

    handleClose();
  }

  return (
    <FormProvider {...methods}>
      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) handleClose();
        }}
      >
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Layer</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <LayerConfigSection index={0} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button onClick={handleSubmit(onSubmit)}>Save Layer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FormProvider>
  );
}
