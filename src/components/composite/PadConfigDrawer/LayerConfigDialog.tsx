import { useEffect } from "react";
import { useForm, FormProvider, type Resolver, type FieldPath } from "react-hook-form";
import { z } from "zod/v4";
import { zodResolver } from "@hookform/resolvers/zod";
import { useProjectStore } from "@/state/projectStore";
import { useUiStore, OVERLAY_ID, selectIsOverlayOpen } from "@/state/uiStore";
import { useLibraryStore } from "@/state/libraryStore";
import { PadConfigSchema } from "@/lib/schemas";
import type { PadConfigForm, PadConfig, LayerConfigForm, Layer, Pad } from "@/lib/schemas";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LayerConfigSection } from "./LayerConfigSection";
import { syncLayerVolume, syncLayerConfig } from "@/lib/audio/padPlayer";
import { getLayerNormalizedVolume } from "@/lib/audio/layerTrigger";
import { filterSoundsByTags } from "@/lib/audio/resolveSounds";

// ─── Local helpers ────────────────────────────────────────────────────────────

function toLayer(form: LayerConfigForm): Layer {
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

function padToConfig(pad: Pad, layers: Layer[]): PadConfig {
  return {
    name: pad.name,
    layers,
    muteTargetPadIds: pad.muteTargetPadIds,
    muteGroupId: pad.muteGroupId,
    color: pad.color,
    icon: pad.icon,
    fadeDurationMs: pad.fadeDurationMs,
    fadeLowVol: pad.fadeLowVol ?? 0,
    fadeHighVol: pad.fadeHighVol ?? 1,
  };
}

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

  // LayerConfigDialog edits a single layer; it never reads or writes the pad
  // name from the form (onSubmit uses pad.name directly via padToConfig).
  // Override name to z.string() so a new pad with an empty name doesn't block
  // the Zod resolver from accepting an otherwise valid layer config.
  const layerDialogSchema = PadConfigSchema.extend({ name: z.string() });

  const methods = useForm<PadConfigForm>({
    resolver: zodResolver(layerDialogSchema) as Resolver<PadConfigForm>,
    defaultValues: {
      name: pad.name,
      layers: [
        {
          id: layer.id,
          selection: layer.selection as LayerConfigForm["selection"],
          arrangement: layer.arrangement,
          cycleMode: layer.cycleMode,
          playbackMode: layer.playbackMode,
          retriggerMode: layer.retriggerMode,
          volume: layer.volume,
        },
      ],
      fadeDurationMs: pad.fadeDurationMs,
      fadeLowVol: pad.fadeLowVol ?? 0,
      fadeHighVol: pad.fadeHighVol ?? 1,
    },
  });

  const { handleSubmit, reset, setError } = methods;

  // Re-populate form when the overlay opens or the target layer changes.
  useEffect(() => {
    if (!isOpen) return;
    reset({
      name: pad.name,
      layers: [
        {
          id: layer.id,
          selection: layer.selection as LayerConfigForm["selection"],
          arrangement: layer.arrangement,
          cycleMode: layer.cycleMode,
          playbackMode: layer.playbackMode,
          retriggerMode: layer.retriggerMode,
          volume: layer.volume,
        },
      ],
      fadeDurationMs: pad.fadeDurationMs,
      fadeLowVol: pad.fadeLowVol ?? 0,
      fadeHighVol: pad.fadeHighVol ?? 1,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, layer.id]);

  function handleClose() {
    closeOverlay(OVERLAY_ID.LAYER_CONFIG_DIALOG);
    onClose();
  }

  function onSubmit(data: PadConfigForm) {
    const sounds = useLibraryStore.getState().sounds;
    let hasError = false;

    // Validate tag/set selections (form wraps single layer at index 0).
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
        if (sounds.filter((s) => s.sets.includes(sel.setId) && !!s.filePath).length === 0) {
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
    const updatedLayer = toLayer(data.layers[0]);
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
