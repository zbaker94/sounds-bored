import { useFormContext, Controller } from "react-hook-form";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { HugeiconsIcon } from "@hugeicons/react";
import { InformationCircleIcon } from "@hugeicons/core-free-icons";
import { SoundSelector } from "./SoundSelector";
import type { PadConfigForm, LayerSelection, Arrangement, PlaybackMode, RetriggerMode } from "@/lib/schemas";
import {
  SELECTION_TAB_TOOLTIPS,
  ARRANGEMENT_TAB_TOOLTIPS,
  CYCLE_MODE_TAB_TOOLTIPS,
  PLAYBACK_MODE_TAB_TOOLTIPS,
  RETRIGGER_TAB_TOOLTIPS,
  getArrangementHelper,
  getCycleModeHelper,
  getPlaybackModeHelper,
  getRetriggerHelper,
} from "./layerConfigCopy";

const SELECTION_TYPE_DEFAULTS: Record<LayerSelection["type"], LayerSelection> = {
  assigned: { type: "assigned", instances: [] },
  tag: { type: "tag", tagIds: [], matchMode: "any", defaultVolume: 100 },
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

// ─── Info icon helper ──────────────────────────────────────────────────────

function InfoTooltip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          tabIndex={-1}
          className="inline-flex items-center text-muted-foreground hover:text-foreground cursor-help"
        >
          <HugeiconsIcon icon={InformationCircleIcon} size={14} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{text}</TooltipContent>
    </Tooltip>
  );
}

// ─── Section label with info tooltip ───────────────────────────────────────

function SectionLabel({ label, tooltip }: { label: string; tooltip: string }) {
  return (
    <div className="flex items-center gap-1">
      <Label variant="section">{label}</Label>
      <InfoTooltip text={tooltip} />
    </div>
  );
}

// ─── Tab with tooltip ──────────────────────────────────────────────────────

function TabWithTooltip({ value, label, tooltip }: { value: string; label: string; tooltip: string }) {
  return (
    <TabsTrigger value={value}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>{label}</span>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltip}</TooltipContent>
      </Tooltip>
    </TabsTrigger>
  );
}

// ─── Selection section sub-component ──────────────────────────────────────

function SelectionSection({ index }: { index: number }) {
  const { control, watch, setValue, formState: { errors } } = useFormContext<PadConfigForm>();
  const layers = watch("layers");
  const layer = layers[index];
  const selectionType = layer?.selection.type ?? "assigned";
  const selPath = `layers.${index}.selection` as `layers.0.selection`;
  const selectionErrors = errors.layers?.[index]?.selection as Record<string, { message?: string }> | undefined;

  function handleSelectionTypeChange(type: LayerSelection["type"]) {
    setValue(selPath, SELECTION_TYPE_DEFAULTS[type] as LayerSelection);
  }

  return (
    <div className="flex flex-col gap-2">
      <SectionLabel
        label="Sound Selection"
        tooltip="Determines which sounds this layer can use when the pad is triggered."
      />
      <Tabs value={selectionType} onValueChange={(v) => {
        if (v === "assigned" || v === "tag" || v === "set") handleSelectionTypeChange(v);
      }}>
        <TabsList stretch>
          <TabWithTooltip value="assigned" label="Assigned" tooltip={SELECTION_TAB_TOOLTIPS.assigned} />
          <TabWithTooltip value="tag" label="Tag" tooltip={SELECTION_TAB_TOOLTIPS.tag} />
          <TabWithTooltip value="set" label="Set" tooltip={SELECTION_TAB_TOOLTIPS.set} />
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
  );
}

// ─── Arrangement + cycle mode sub-component ────────────────────────────────

function ArrangementSection({ index }: { index: number }) {
  const { control, watch, setValue } = useFormContext<PadConfigForm>();
  const layers = watch("layers");
  const layer = layers[index];
  const selectionType = layer?.selection.type ?? "assigned";
  const arrangement = layer?.arrangement ?? "simultaneous";
  const cycleMode = layer?.cycleMode ?? false;
  const playbackMode = layer?.playbackMode ?? "one-shot";
  const retriggerMode = layer?.retriggerMode ?? "restart";
  const instanceCount = selectionType === "assigned" && layer?.selection.type === "assigned"
    ? layer.selection.instances.length : 0;

  const arrPath = `layers.${index}.arrangement` as `layers.0.arrangement`;
  const cyclePath = `layers.${index}.cycleMode` as `layers.0.cycleMode`;
  const rtPath = `layers.${index}.retriggerMode` as `layers.0.retriggerMode`;

  function handleArrangementChange(v: Arrangement) {
    setValue(arrPath, v, { shouldDirty: true });
    if (v === "simultaneous") {
      if (retriggerMode === "next") setValue(rtPath, "restart", { shouldDirty: true });
      setValue(cyclePath, false, { shouldDirty: true });
    }
  }

  const arrangementHelper = getArrangementHelper(selectionType, arrangement, cycleMode, instanceCount);
  const cycleModeHelper = (arrangement === "sequential" || arrangement === "shuffled")
    ? getCycleModeHelper(arrangement, cycleMode, playbackMode)
    : null;

  return (
    <>
      <div className="flex flex-col gap-2">
        <SectionLabel
          label="Arrangement"
          tooltip="Controls whether eligible sounds play all at once, or one at a time in order or at random."
        />
        <Tabs
          value={arrangement}
          onValueChange={(v) => {
            if (ARRANGEMENT_OPTIONS.some((o) => o.value === v)) handleArrangementChange(v as Arrangement);
          }}
        >
          <TabsList stretch>
            {ARRANGEMENT_OPTIONS.map((opt) => (
              <TabWithTooltip key={opt.value} value={opt.value} label={opt.label} tooltip={ARRANGEMENT_TAB_TOOLTIPS[opt.value]} />
            ))}
          </TabsList>
        </Tabs>
        {arrangementHelper && <p className="text-xs text-muted-foreground">{arrangementHelper}</p>}
      </div>

      {(arrangement === "sequential" || arrangement === "shuffled") && (
        <div className="flex flex-col gap-2">
          <SectionLabel
            label="Mode"
            tooltip="Controls whether the whole sequence chains automatically, or each trigger advances one step at a time."
          />
          <Controller
            control={control}
            name={cyclePath}
            render={({ field }) => (
              <Tabs value={field.value ? "cycle" : "continuous"} onValueChange={(v) => field.onChange(v === "cycle")}>
                <TabsList stretch>
                  <TabWithTooltip value="continuous" label="Continuous" tooltip={CYCLE_MODE_TAB_TOOLTIPS.continuous} />
                  <TabWithTooltip value="cycle" label="Cycle" tooltip={CYCLE_MODE_TAB_TOOLTIPS.cycle} />
                </TabsList>
              </Tabs>
            )}
          />
          {cycleModeHelper && <p className="text-xs text-muted-foreground">{cycleModeHelper}</p>}
        </div>
      )}
    </>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────

interface LayerConfigSectionProps {
  index: number;
}

export function LayerConfigSection({ index }: LayerConfigSectionProps) {
  const { control, watch, setValue } = useFormContext<PadConfigForm>();
  const layers = watch("layers");
  const layer = layers[index];
  const arrangement = layer?.arrangement ?? "simultaneous";
  const cycleMode = layer?.cycleMode ?? false;
  const playbackMode = layer?.playbackMode ?? "one-shot";
  const retriggerMode = layer?.retriggerMode ?? "restart";

  const pbPath  = `layers.${index}.playbackMode` as `layers.0.playbackMode`;
  const rtPath  = `layers.${index}.retriggerMode` as `layers.0.retriggerMode`;
  const volPath = `layers.${index}.volume` as `layers.0.volume`;

  const playbackModeHelper = getPlaybackModeHelper(playbackMode, retriggerMode);
  const retriggerHelper = getRetriggerHelper(retriggerMode, playbackMode, arrangement, cycleMode);

  return (
    <div className="flex flex-col gap-4">
      <SelectionSection index={index} />
      <ArrangementSection index={index} />

      {/* Playback Mode */}
      <div className="flex flex-col gap-2">
        <SectionLabel
          label="Playback Mode"
          tooltip="Controls how long the sound plays after the pad is triggered."
        />
        <Tabs
          value={playbackMode}
          onValueChange={(v) => {
            if (PLAYBACK_MODE_OPTIONS.some((o) => o.value === v))
              setValue(pbPath, v as PlaybackMode, { shouldDirty: true });
          }}
        >
          <TabsList stretch>
            {PLAYBACK_MODE_OPTIONS.map((opt) => (
              <TabWithTooltip key={opt.value} value={opt.value} label={opt.label} tooltip={PLAYBACK_MODE_TAB_TOOLTIPS[opt.value]} />
            ))}
          </TabsList>
        </Tabs>
        {playbackModeHelper && <p className="text-xs text-muted-foreground">{playbackModeHelper}</p>}
      </div>

      {/* Retrigger Mode */}
      <div className="flex flex-col gap-2">
        <SectionLabel
          label="Retrigger Mode"
          tooltip="Controls what happens when the pad is triggered while this layer is already playing."
        />
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
                <TabWithTooltip key={opt.value} value={opt.value} label={opt.label} tooltip={RETRIGGER_TAB_TOOLTIPS[opt.value]} />
              ))}
          </TabsList>
        </Tabs>
        {retriggerHelper && <p className="text-xs text-muted-foreground">{retriggerHelper}</p>}
      </div>

      {/* Volume */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label variant="section">Volume</Label>
          <span className="text-xs text-muted-foreground tabular-nums">{layer?.volume ?? 100}%</span>
        </div>
        <Controller
          control={control}
          name={volPath}
          render={({ field }) => (
            <Slider min={0} max={100} step={1} value={[field.value as number]} onValueChange={([v]) => field.onChange(v)} />
          )}
        />
      </div>
    </div>
  );
}
