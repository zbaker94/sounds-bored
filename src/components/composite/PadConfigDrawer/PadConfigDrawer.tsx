import { useEffect } from "react";
import { useForm, useFormContext, FormProvider, Controller, type Resolver, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useProjectStore } from "@/state/projectStore";
import { useUiStore, OVERLAY_ID, selectIsOverlayOpen } from "@/state/uiStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { useLibraryStore } from "@/state/libraryStore";
import { usePlaybackStore } from "@/state/playbackStore";
import { PadConfigSchema } from "@/lib/schemas";
import type { PadConfigForm, PadConfig, LayerConfigForm, Layer } from "@/lib/schemas";
import { DrawerDialog } from "@/components/ui/drawer-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { HugeiconsIcon } from "@hugeicons/react";
import { InformationCircleIcon } from "@hugeicons/core-free-icons";
import { LayerAccordion } from "./LayerAccordion";
import { syncLayerVolume, syncLayerConfig } from "@/lib/audio/padPlayer";
import { filterSoundsByTags } from "@/lib/audio/resolveSounds";
import { createDefaultLayer } from "./constants";

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
  const isPadPlaying = usePlaybackStore((s) =>
    padId !== undefined ? s.playingPadIds.has(padId) : false
  );

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
          cycleMode: l.cycleMode,
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
          // Typed annotation (not `as` cast) lets TypeScript validate the template literal
          // path against PadConfigForm's FieldPath union at compile time.
          const field: FieldPath<PadConfigForm> = `layers.${i}.selection.tagIds`;
          setError(field, {
            type: "manual",
            message: "No sounds in library match these tags",
          });
          hasError = true;
        }
      } else if (sel.type === "set") {
        if (sounds.filter((s) => s.sets.includes(sel.setId) && !!s.filePath).length === 0) {
          // Typed annotation (not `as` cast) lets TypeScript validate the template literal
          // path against PadConfigForm's FieldPath union at compile time.
          const field: FieldPath<PadConfigForm> = `layers.${i}.selection.setId`;
          setError(field, {
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
      layers: data.layers.map(toLayer),
      muteTargetPadIds: initialConfig?.muteTargetPadIds ?? [],
      fadeDurationMs: data.fadeDurationMs,
      icon: initialConfig?.icon,
      // Round-trip muteGroupId and color from the existing pad so they are
      // always present (or explicitly undefined) in the config object.
      // Object.assign in updatePad only clears a field when the config
      // explicitly includes it as undefined; omitting the key entirely would
      // silently preserve the old value even if the user intended to clear it.
      // In create mode, initialConfig is undefined so these evaluate to undefined
      // (no-op for a new pad; both fields are optional in PadSchema).
      muteGroupId: initialConfig?.muteGroupId,
      color: initialConfig?.color,
    };
    if (isEditMode && padId) {
      updatePad(sceneId, padId, config);
      config.layers.forEach((l) => {
        syncLayerVolume(l.id, l.volume / 100);
        const originalLayer = initialConfig?.layers?.find((ol) => ol.id === l.id);
        if (originalLayer) syncLayerConfig(l, originalLayer);
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
            {isPadPlaying && (
              <p className="text-sm text-muted-foreground rounded border border-border bg-muted/50 px-3 py-2">
                Sound selection changes will apply on the next trigger.
              </p>
            )}
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
        <div className="flex items-center gap-1">
          <Label>Fade Duration</Label>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" tabIndex={-1}
                className="inline-flex items-center text-muted-foreground hover:text-foreground cursor-help">
                <HugeiconsIcon icon={InformationCircleIcon} size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">How long this pad takes to fade in or out during mute group operations. Overrides the global setting for this pad only.</TooltipContent>
          </Tooltip>
        </div>
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
      {currentValue === undefined ? (
        <p className="text-xs text-muted-foreground">Using the global default ({(globalDefault / 1000).toFixed(1)}s). Drag the slider to set a pad-specific value.</p>
      ) : (
        <p className="text-xs text-muted-foreground">Custom fade for this pad. The global default is {(globalDefault / 1000).toFixed(1)}s.</p>
      )}
    </div>
  );
}
