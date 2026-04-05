import { useFormContext, Controller } from "react-hook-form";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { SoundSelector } from "./SoundSelector";
import type { PadConfigForm, LayerSelection, Arrangement, PlaybackMode, RetriggerMode } from "@/lib/schemas";

const SELECTION_TYPE_DEFAULTS: Record<LayerSelection["type"], LayerSelection> = {
  assigned: { type: "assigned", instances: [] },
  tag: { type: "tag", tagIds: [], defaultVolume: 100 },
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

const RETRIGGER_MODE_OPTIONS: { value: RetriggerMode; label: string; arrangements?: Arrangement[] }[] = [
  { value: "restart", label: "Restart" },
  { value: "continue", label: "Continue" },
  { value: "stop", label: "Stop" },
  { value: "next", label: "Next", arrangements: ["sequential", "shuffled"] },
];

interface LayerConfigSectionProps {
  index: number;
}

export function LayerConfigSection({ index }: LayerConfigSectionProps) {
  const { control, watch, setValue, formState: { errors } } = useFormContext<PadConfigForm>();

  // Read all layer values reactively via the top-level array watch.
  const layers = watch("layers");
  const layer = layers[index];
  const selectionType = layer?.selection.type ?? "assigned";
  const arrangement = layer?.arrangement ?? "simultaneous";
  const playbackMode = layer?.playbackMode ?? "one-shot";
  const retriggerMode = layer?.retriggerMode ?? "restart";

  // Cast array element paths — react-hook-form requires path strings;
  // we use fixed-index alias (0) for TypeScript inference.
  const selPath = `layers.${index}.selection` as `layers.0.selection`;
  const arrPath = `layers.${index}.arrangement` as `layers.0.arrangement`;
  const pbPath  = `layers.${index}.playbackMode` as `layers.0.playbackMode`;
  const rtPath  = `layers.${index}.retriggerMode` as `layers.0.retriggerMode`;
  const volPath = `layers.${index}.volume` as `layers.0.volume`;

  const selectionErrors = errors.layers?.[index]?.selection as Record<string, { message?: string }> | undefined;

  function handleSelectionTypeChange(type: LayerSelection["type"]) {
    setValue(selPath, SELECTION_TYPE_DEFAULTS[type] as LayerSelection);
  }

  function handleArrangementChange(v: Arrangement) {
    setValue(arrPath, v, { shouldDirty: true });
    // "next" retrigger requires a chain — reset to "restart" when switching to simultaneous
    if (v === "simultaneous" && retriggerMode === "next") {
      setValue(rtPath, "restart", { shouldDirty: true });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Selection Type */}
      <div className="flex flex-col gap-2">
        <Label variant="section">Sound Selection</Label>
        <Tabs value={selectionType} onValueChange={(v) => {
          if (v === "assigned" || v === "tag" || v === "set")
            handleSelectionTypeChange(v);
        }}>
          <TabsList stretch>
            <TabsTrigger value="assigned">Assigned</TabsTrigger>
            <TabsTrigger value="tag">Tag</TabsTrigger>
            <TabsTrigger value="set">Set</TabsTrigger>
          </TabsList>
        </Tabs>

        <Controller
          control={control}
          name={selPath}
          render={({ field }) => (
            <SoundSelector value={field.value as LayerSelection} onChange={field.onChange} />
          )}
        />

        {selectionType === "assigned" && selectionErrors?.instances?.message && (
          <p className="text-sm text-destructive">{selectionErrors.instances.message}</p>
        )}
        {selectionType === "tag" && selectionErrors?.tagIds?.message && (
          <p className="text-sm text-destructive">{selectionErrors.tagIds.message}</p>
        )}
        {selectionType === "set" && selectionErrors?.setId?.message && (
          <p className="text-sm text-destructive">{selectionErrors.setId.message}</p>
        )}
      </div>

      {/* Arrangement */}
      <div className="flex flex-col gap-2">
        <Label variant="section">Arrangement</Label>
        <Tabs
          value={arrangement}
          onValueChange={(v) => {
            if (ARRANGEMENT_OPTIONS.some((o) => o.value === v))
              handleArrangementChange(v as Arrangement);
          }}
        >
          <TabsList stretch>
            {ARRANGEMENT_OPTIONS.map((opt) => (
              <TabsTrigger key={opt.value} value={opt.value}>
                {opt.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Playback Mode */}
      <div className="flex flex-col gap-2">
        <Label variant="section">Playback Mode</Label>
        <Tabs
          value={playbackMode}
          onValueChange={(v) => {
            if (PLAYBACK_MODE_OPTIONS.some((o) => o.value === v))
              setValue(pbPath, v as PlaybackMode, { shouldDirty: true });
          }}
        >
          <TabsList stretch>
            {PLAYBACK_MODE_OPTIONS.map((opt) => (
              <TabsTrigger key={opt.value} value={opt.value}>
                {opt.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Retrigger Mode */}
      <div className="flex flex-col gap-2">
        <Label variant="section">Retrigger Mode</Label>
        <Tabs
          value={retriggerMode}
          onValueChange={(v) => {
            if (RETRIGGER_MODE_OPTIONS.some((o) => o.value === v))
              setValue(rtPath, v as RetriggerMode, { shouldDirty: true });
          }}
        >
          <TabsList stretch>
            {RETRIGGER_MODE_OPTIONS
              .filter((opt) => !opt.arrangements || opt.arrangements.includes(arrangement))
              .map((opt) => (
                <TabsTrigger key={opt.value} value={opt.value}>
                  {opt.label}
                </TabsTrigger>
              ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Volume */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label variant="section">Volume</Label>
          <span className="text-xs text-muted-foreground tabular-nums">
            {layer?.volume ?? 100}%
          </span>
        </div>
        <Controller
          control={control}
          name={volPath}
          render={({ field }) => (
            <Slider
              min={0}
              max={100}
              step={1}
              value={[field.value as number]}
              onValueChange={([v]) => field.onChange(v)}
            />
          )}
        />
      </div>
    </div>
  );
}
