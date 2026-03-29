import { useFormContext, Controller } from "react-hook-form";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { SoundSelector } from "./SoundSelector";
import type { PadConfigForm, LayerSelection } from "@/lib/schemas";

const SELECTION_TYPE_DEFAULTS: Record<LayerSelection["type"], LayerSelection> = {
  assigned: { type: "assigned", instances: [] },
  tag: { type: "tag", tagId: "", defaultVolume: 100 },
  set: { type: "set", setId: "", defaultVolume: 100 },
};

const ARRANGEMENT_OPTIONS = [
  { value: "simultaneous", label: "Simultaneous" },
  { value: "sequential", label: "Sequential" },
  { value: "shuffled", label: "Shuffled" },
] as const;

const PLAYBACK_MODE_OPTIONS = [
  { value: "one-shot", label: "One-shot" },
  { value: "hold", label: "Hold" },
  { value: "loop", label: "Loop" },
] as const;

const RETRIGGER_MODE_OPTIONS = [
  { value: "restart", label: "Restart" },
  { value: "continue", label: "Continue" },
  { value: "stop", label: "Stop" },
  { value: "next", label: "Next" },
] as const;

export function LayerConfigSection() {
  const { control, watch, setValue, formState: { errors } } = useFormContext<PadConfigForm>();
  const selectionType = watch("layer.selection.type");
  // Cast needed: TypeScript can't narrow discriminated union error shapes
  const selectionErrors = errors.layer?.selection as Record<string, { message?: string }> | undefined;

  function handleSelectionTypeChange(type: LayerSelection["type"]) {
    setValue("layer.selection", SELECTION_TYPE_DEFAULTS[type]);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Selection Type */}
      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Sound Selection
        </Label>
        <Tabs value={selectionType} onValueChange={(v) => handleSelectionTypeChange(v as LayerSelection["type"])}>
          <TabsList className="w-full">
            <TabsTrigger value="assigned" className="flex-1">Assigned</TabsTrigger>
            <TabsTrigger value="tag" className="flex-1">Tag</TabsTrigger>
            <TabsTrigger value="set" className="flex-1">Set</TabsTrigger>
          </TabsList>
        </Tabs>

        <Controller
          control={control}
          name="layer.selection"
          render={({ field }) => (
            <SoundSelector value={field.value} onChange={field.onChange} />
          )}
        />

        {selectionType === "assigned" && selectionErrors?.instances?.message && (
          <p className="text-sm text-destructive">{selectionErrors.instances.message}</p>
        )}
        {selectionType === "tag" && selectionErrors?.tagId?.message && (
          <p className="text-sm text-destructive">{selectionErrors.tagId.message}</p>
        )}
        {selectionType === "set" && selectionErrors?.setId?.message && (
          <p className="text-sm text-destructive">{selectionErrors.setId.message}</p>
        )}
      </div>

      {/* Arrangement */}
      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Arrangement
        </Label>
        <Controller
          control={control}
          name="layer.arrangement"
          render={({ field }) => (
            <Tabs value={field.value} onValueChange={field.onChange}>
              <TabsList className="w-full">
                {ARRANGEMENT_OPTIONS.map((opt) => (
                  <TabsTrigger key={opt.value} value={opt.value} className="flex-1">
                    {opt.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
        />
      </div>

      {/* Playback Mode */}
      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Playback Mode
        </Label>
        <Controller
          control={control}
          name="layer.playbackMode"
          render={({ field }) => (
            <Tabs value={field.value} onValueChange={field.onChange}>
              <TabsList className="w-full">
                {PLAYBACK_MODE_OPTIONS.map((opt) => (
                  <TabsTrigger key={opt.value} value={opt.value} className="flex-1">
                    {opt.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
        />
      </div>

      {/* Retrigger Mode */}
      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Retrigger Mode
        </Label>
        <Controller
          control={control}
          name="layer.retriggerMode"
          render={({ field }) => (
            <Tabs value={field.value} onValueChange={field.onChange}>
              <TabsList className="w-full">
                {RETRIGGER_MODE_OPTIONS.map((opt) => (
                  <TabsTrigger key={opt.value} value={opt.value} className="flex-1">
                    {opt.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
        />
      </div>

      {/* Volume */}
      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Volume
        </Label>
        <Controller
          control={control}
          name="layer.volume"
          render={({ field }) => (
            <Slider
              min={0}
              max={100}
              step={1}
              value={[field.value]}
              onValueChange={([v]) => field.onChange(v)}
            />
          )}
        />
      </div>
    </div>
  );
}
