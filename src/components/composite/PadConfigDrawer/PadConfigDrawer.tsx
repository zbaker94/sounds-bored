import { useEffect } from "react";
import { useForm, useFormContext, FormProvider, Controller, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useProjectStore } from "@/state/projectStore";
import { useUiStore, OVERLAY_ID, selectIsOverlayOpen } from "@/state/uiStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { useLibraryStore } from "@/state/libraryStore";
import { PadConfigSchema } from "@/lib/schemas";
import type { PadConfigForm, PadConfig, LayerConfigForm } from "@/lib/schemas";
import { DrawerDialog } from "@/components/ui/drawer-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { LayerAccordion } from "./LayerAccordion";
import { syncLayerVolume, syncLayerPlaybackMode } from "@/lib/audio/padPlayer";
import { filterSoundsByTags } from "@/lib/audio/resolveSounds";
import { createDefaultLayer } from "./constants";

function defaultPadValues(): PadConfigForm {
  return {
    name: "",
    layers: [createDefaultLayer()],
    fadeDurationMs: undefined,
  };
}

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
  const isOpen = useUiStore(selectIsOverlayOpen(OVERLAY_ID.PAD_CONFIG_DRAWER));
  const closeOverlay = useUiStore((s) => s.closeOverlay);
  const addPad = useProjectStore((s) => s.addPad);
  const updatePad = useProjectStore((s) => s.updatePad);

  const isEditMode = padId !== undefined;

  const methods = useForm<PadConfigForm>({
    resolver: zodResolver(PadConfigSchema) as Resolver<PadConfigForm>,
    defaultValues: defaultPadValues(),
  });

  const { register, handleSubmit, reset, setError, formState: { errors } } = methods;

  // Reset form with correct values whenever the drawer opens.
  useEffect(() => {
    if (!isOpen) return;
    if (isEditMode && initialConfig) {
      reset({
        name: initialConfig.name ?? "",
        layers: (initialConfig.layers ?? []).map((l) => ({
          id: l.id,
          selection: l.selection as LayerConfigForm["selection"],
          arrangement: l.arrangement,
          playbackMode: l.playbackMode,
          retriggerMode: l.retriggerMode,
          volume: l.volume,
        })),
        fadeDurationMs: initialConfig.fadeDurationMs,
      });
    } else {
      reset(defaultPadValues());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, padId]);

  function handleClose() {
    reset(defaultPadValues());
    closeOverlay(OVERLAY_ID.PAD_CONFIG_DRAWER);
    onClose?.();
  }

  function onSubmit(data: PadConfigForm) {
    const sounds = useLibraryStore.getState().sounds;
    let hasError = false;
    data.layers.forEach((layer, i) => {
      const sel = layer.selection;
      if (sel.type === "tag") {
        if (filterSoundsByTags(sounds, sel.tagIds, sel.matchMode).length === 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setError(`layers.${i}.selection.tagIds` as any, {
            type: "manual",
            message: "No sounds in library match these tags",
          });
          hasError = true;
        }
      } else if (sel.type === "set") {
        if (sounds.filter((s) => s.sets.includes(sel.setId) && !!s.filePath).length === 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setError(`layers.${i}.selection.setId` as any, {
            type: "manual",
            message: "No sounds in library match this set",
          });
          hasError = true;
        }
      }
    });
    if (hasError) return;

    const config: PadConfig = {
      name: data.name,
      layers: data.layers.map((l) => ({ ...l })),
      muteTargetPadIds: initialConfig?.muteTargetPadIds ?? [],
      fadeDurationMs: data.fadeDurationMs,
    };
    if (isEditMode && padId) {
      updatePad(sceneId, padId, config);
      config.layers.forEach((l) => {
        syncLayerVolume(l.id, l.volume);
        const originalLayer = initialConfig?.layers?.find((ol) => ol.id === l.id);
        if (originalLayer && originalLayer.playbackMode !== l.playbackMode) {
          syncLayerPlaybackMode(l);
        }
      });
    } else {
      addPad(sceneId, config);
    }
    handleClose();
  }

  return (
    <FormProvider {...methods}>
      <DrawerDialog
        open={isOpen}
        onOpenChange={(open) => { if (!open) handleClose(); }}
        title={isEditMode ? "Edit Pad" : "New Pad"}
        content={
          <div className="flex flex-col gap-4 px-4 py-2 overflow-y-auto max-h-[65vh]">
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
            <FadeDurationField />
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

function FadeDurationField() {
  const { control, watch } = useFormContext<PadConfigForm>();
  const globalDefault = useAppSettingsStore((s) => s.settings?.globalFadeDurationMs ?? 2000);
  const currentValue = watch("fadeDurationMs");
  const displayValue = currentValue ?? globalDefault;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>Fade Duration</Label>
        <div className="flex items-center gap-2">
          <span className="text-sm tabular-nums text-muted-foreground">
            {(displayValue / 1000).toFixed(1)}s
          </span>
          {currentValue !== undefined && (
            <Controller
              name="fadeDurationMs"
              control={control}
              render={({ field }) => (
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline"
                  onClick={() => field.onChange(undefined)}
                >
                  Reset to default
                </button>
              )}
            />
          )}
        </div>
      </div>
      <Controller
        name="fadeDurationMs"
        control={control}
        render={({ field }) => (
          <Slider
            min={100}
            max={10000}
            step={100}
            value={[field.value ?? globalDefault]}
            onValueChange={(vals) => field.onChange(vals[0])}
          />
        )}
      />
      {currentValue === undefined && (
        <p className="text-xs text-muted-foreground">Using global default ({(globalDefault / 1000).toFixed(1)}s)</p>
      )}
    </div>
  );
}
