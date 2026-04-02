import { useEffect, useRef } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useProjectStore } from "@/state/projectStore";
import { useUiStore, OVERLAY_ID } from "@/state/uiStore";
import { PadConfigSchema } from "@/lib/schemas";
import type { PadConfigForm, PadConfig, LayerConfigForm } from "@/lib/schemas";
import { DrawerDialog } from "@/components/ui/drawer-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LayerAccordion } from "./LayerAccordion";
import { syncLayerVolume } from "@/lib/audio/padPlayer";

const DEFAULT_LAYER: LayerConfigForm = {
  selection: { type: "assigned", instances: [] },
  arrangement: "simultaneous",
  playbackMode: "one-shot",
  retriggerMode: "restart",
  volume: 100,
};

const DEFAULT_VALUES: PadConfigForm = {
  name: "",
  layers: [DEFAULT_LAYER],
};

interface PadConfigDrawerProps {
  sceneId: string;
  /** When set, the drawer operates in edit mode and calls updatePad on submit. */
  padId?: string;
  /** Pre-populate the form with existing pad data (only used when padId is set). */
  initialConfig?: Partial<PadConfig>;
  /** Called when the drawer closes, e.g. to clear parent editingPad state. */
  onClose?: () => void;
}

export function PadConfigDrawer({ sceneId, padId, initialConfig, onClose }: PadConfigDrawerProps) {
  const isOpen = useUiStore((s) => s.isOverlayOpen(OVERLAY_ID.PAD_CONFIG_DRAWER));
  const closeOverlay = useUiStore((s) => s.closeOverlay);
  const addPad = useProjectStore((s) => s.addPad);
  const updatePad = useProjectStore((s) => s.updatePad);

  const isEditMode = padId !== undefined;

  // Preserve layer IDs across edits so audio engine retrigger tracking (keyed by layer.id) stays valid.
  const layerIdsRef = useRef<string[]>([]);

  const methods = useForm<PadConfigForm>({
    resolver: zodResolver(PadConfigSchema),
    defaultValues: DEFAULT_VALUES,
  });

  const { register, handleSubmit, reset, formState: { errors } } = methods;

  // Reset form with correct values whenever the drawer opens.
  useEffect(() => {
    if (!isOpen) return;
    if (isEditMode && initialConfig) {
      layerIdsRef.current = (initialConfig.layers ?? []).map((l) => l.id);
      reset({
        name: initialConfig.name ?? "",
        layers: (initialConfig.layers ?? []).map((l) => ({
          selection: l.selection as LayerConfigForm["selection"],
          arrangement: l.arrangement,
          playbackMode: l.playbackMode,
          retriggerMode: l.retriggerMode,
          volume: l.volume,
        })),
      });
    } else {
      layerIdsRef.current = [];
      reset(DEFAULT_VALUES);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, padId]);

  function handleClose() {
    reset(DEFAULT_VALUES);
    closeOverlay(OVERLAY_ID.PAD_CONFIG_DRAWER);
    onClose?.();
  }

  function onSubmit(data: PadConfigForm) {
    const config: PadConfig = {
      name: data.name,
      layers: data.layers.map((l, i) => ({ id: layerIdsRef.current[i] ?? crypto.randomUUID(), ...l })),
      muteTargetPadIds: initialConfig?.muteTargetPadIds ?? [],
    };
    if (isEditMode && padId) {
      updatePad(sceneId, padId, config);
      config.layers.forEach((l) => syncLayerVolume(l.id, l.volume));
    } else {
      addPad(sceneId, config);
    }
    handleClose();
  }

  return (
    <FormProvider {...methods}>
      <DrawerDialog
        classNames={{
          title: "[font-family:DeathLetter] tracking-wider text-2xl",
        }}
        open={isOpen}
        onOpenChange={(open) => { if (!open) handleClose(); }}
        title={isEditMode ? "Edit Pad" : "New Pad"}
        content={
          <div className="flex flex-col gap-4 px-4 py-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="pad-name">Pad Name</Label>
              <Input
                id="pad-name"
                aria-label="Pad name"
                placeholder="e.g. Kick"
                {...register("name")}
              />
              {errors.name && (
                <p className="text-sm text-destructive">{errors.name.message}</p>
              )}
            </div>
            <LayerAccordion />
          </div>
        }
        footer={
          <>
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button onClick={handleSubmit(onSubmit)}>Save</Button>
          </>
        }
      />
    </FormProvider>
  );
}
