import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useProjectStore } from "@/state/projectStore";
import { useUiStore, OVERLAY_ID } from "@/state/uiStore";
import { PadConfigSchema } from "@/lib/schemas";
import type { PadConfigForm, PadConfig } from "@/lib/schemas";
import { DrawerDialog } from "@/components/ui/drawer-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LayerConfigSection } from "./LayerConfigSection";

const DEFAULT_VALUES: PadConfigForm = {
  name: "",
  layer: {
    selection: { type: "assigned", instances: [] },
    arrangement: "simultaneous",
    playbackMode: "one-shot",
    retriggerMode: "restart",
    volume: 100,
  },
};

interface PadConfigDrawerProps {
  sceneId: string;
  initialConfig?: Partial<PadConfig>;
}

export function PadConfigDrawer({ sceneId, initialConfig }: PadConfigDrawerProps) {
  const isOpen = useUiStore((s) => s.isOverlayOpen(OVERLAY_ID.PAD_CONFIG_DRAWER));
  const closeOverlay = useUiStore((s) => s.closeOverlay);
  const addPad = useProjectStore((s) => s.addPad);

  const isEditing = initialConfig !== undefined;

  const methods = useForm<PadConfigForm>({
    resolver: zodResolver(PadConfigSchema),
    defaultValues: initialConfig
      ? {
          name: initialConfig.name ?? "",
          layer: initialConfig.layers?.[0]
            ? {
                selection: initialConfig.layers[0].selection,
                arrangement: initialConfig.layers[0].arrangement,
                playbackMode: initialConfig.layers[0].playbackMode,
                retriggerMode: initialConfig.layers[0].retriggerMode,
                volume: initialConfig.layers[0].volume,
              }
            : DEFAULT_VALUES.layer,
        }
      : DEFAULT_VALUES,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = methods;

  function handleClose() {
    reset(DEFAULT_VALUES);
    closeOverlay(OVERLAY_ID.PAD_CONFIG_DRAWER);
  }

  function onSubmit(data: PadConfigForm) {
    // Layer id is generated here (not in addPad) because PadConfig.layers is Layer[].
    // addPad only generates the pad's own id.
    const config: PadConfig = {
      name: data.name,
      layers: [{ id: crypto.randomUUID(), ...data.layer }],
      muteTargetPadIds: [],
    };
    addPad(sceneId, config);
    handleClose();
  }

  return (
    <FormProvider {...methods}>
      <DrawerDialog
        open={isOpen}
        onOpenChange={(open) => { if (!open) handleClose(); }}
        title={isEditing ? "Edit Pad" : "Configure Pad"}
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
            <LayerConfigSection />
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
