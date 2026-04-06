import { useFormContext, Controller } from "react-hook-form";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { HugeiconsIcon } from "@hugeicons/react";
import { InformationCircleIcon } from "@hugeicons/core-free-icons";
import { SoundSelector } from "./SoundSelector";
import type { PadConfigForm, LayerSelection, Arrangement, PlaybackMode, RetriggerMode } from "@/lib/schemas";

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

// ─── Tooltip content maps ──────────────────────────────────────────────────

const SELECTION_TAB_TOOLTIPS: Record<string, string> = {
  assigned: "Pick specific sounds from your library.",
  tag: "Sounds matching the selected tags are eligible at trigger time.",
  set: "Sounds belonging to the selected set are eligible at trigger time.",
};

const ARRANGEMENT_TAB_TOOLTIPS: Record<string, string> = {
  simultaneous: "All sounds start at the same time.",
  sequential: "One sound plays at a time, in the order they were added. The next starts after the current one finishes.",
  shuffled: "One sound plays at a time in a random order. The next starts after the current one finishes.",
};

const CYCLE_MODE_TAB_TOOLTIPS: Record<string, string> = {
  continuous: "The full sequence plays through automatically on each trigger. Sounds chain one into the next without further input.",
  cycle: "Each trigger plays one sound, advancing to the next position. The cursor is remembered between triggers.",
};

const PLAYBACK_MODE_TAB_TOOLTIPS: Record<string, string> = {
  "one-shot": "The sound plays once from start to finish, then stops.",
  hold: "The sound plays while the pad is held. Releasing the pad stops it.",
  loop: "The sound repeats continuously. Trigger the pad again (or use Retrigger > Stop) to stop it.",
};

const RETRIGGER_TAB_TOOLTIPS: Record<string, string> = {
  restart: "Stops the current sound and starts it again from the beginning.",
  continue: "Trigger is ignored — the sound keeps playing uninterrupted.",
  stop: "Stops the sound. If not playing, triggers it normally.",
  next: "Skips to the next sound in the sequence. If not playing, triggers normally. (Sequential and Shuffled only.)",
};

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

// ─── Helper text builders ──────────────────────────────────────────────────

function getArrangementHelper(
  selectionType: LayerSelection["type"],
  arrangement: Arrangement,
  cycleMode: boolean,
  instanceCount: number,
): string | null {
  if (arrangement === "simultaneous") {
    if (selectionType === "assigned") {
      if (instanceCount === 1) return "The assigned sound plays on each trigger.";
      if (instanceCount >= 2) return `All ${instanceCount} assigned sounds play together on each trigger.`;
    }
    return "All matched sounds play together at trigger time.";
  }

  // sequential or shuffled
  if (selectionType === "assigned") {
    if (instanceCount === 1)
      return "Only one sound assigned — arrangement has no effect with a single sound.";

    if (arrangement === "sequential") {
      return cycleMode
        ? "Each trigger plays the next sound in order."
        : `All ${instanceCount} sounds chain automatically on each trigger. The first plays immediately; the rest follow in sequence.`;
    }
    // shuffled
    return cycleMode
      ? `Each trigger plays a random sound from the ${instanceCount} assigned.`
      : `All ${instanceCount} sounds chain automatically on each trigger in a new random order.`;
  }

  // tag or set
  if (cycleMode) {
    return arrangement === "sequential"
      ? "Each trigger plays the next sound from the matched pool."
      : "Each trigger plays a random sound from the matched pool.";
  }
  return "All matched sounds chain automatically on each trigger.";
}

function getCycleModeHelper(
  arrangement: Arrangement,
  cycleMode: boolean,
  playbackMode: PlaybackMode,
): string | null {
  if (arrangement === "sequential") {
    if (!cycleMode) {
      return playbackMode === "one-shot"
        ? "The full sequence plays through once and stops. Each new trigger restarts it from the first sound."
        : "The sequence loops indefinitely — when the last sound finishes, it starts again from the first.";
    }
    return playbackMode === "one-shot"
      ? "Each trigger plays the next sound in order. After the last, the position resets to the first."
      : "Each trigger advances to the next sound, which then loops until the pad is triggered again.";
  }

  // shuffled
  if (!cycleMode) {
    return playbackMode === "one-shot"
      ? "A new random order is played through once on each trigger, then stops."
      : "A random order plays through, then reshuffles and loops indefinitely.";
  }
  return playbackMode === "one-shot"
    ? "Each trigger plays a random sound. After all have played, the pool reshuffles."
    : "Each trigger plays a random sound, which loops until the pad is triggered again.";
}

function getPlaybackModeHelper(
  playbackMode: PlaybackMode,
  retriggerMode: RetriggerMode,
): string | null {
  if (playbackMode === "hold")
    return "Plays while the pad is held. Releasing the pad stops the sound.";

  if (playbackMode === "one-shot") {
    const map: Record<RetriggerMode, string> = {
      restart: "Plays once. Triggering while it's playing restarts it from the beginning.",
      continue: "Plays once. Triggering while it's playing is ignored.",
      stop: "Plays once. Triggering while it's playing stops it without restarting.",
      next: "Plays once. Triggering while it's playing skips to the next sound in the sequence.",
    };
    return map[retriggerMode];
  }

  // loop
  const map: Record<RetriggerMode, string> = {
    restart: "Loops continuously. Triggering again restarts the loop from the beginning.",
    continue: "Loops continuously. Retriggering while looping has no effect.",
    stop: "Loops continuously. Triggering again stops it — trigger once more to start.",
    next: "Loops through the sequence. Triggering again skips to the next sound without restarting.",
  };
  return map[retriggerMode];
}

function getRetriggerHelper(
  retriggerMode: RetriggerMode,
  playbackMode: PlaybackMode,
  arrangement: Arrangement,
  cycleMode: boolean,
): string | null {
  if (retriggerMode === "next") {
    if (arrangement === "sequential") {
      return cycleMode
        ? "Triggering while playing advances the cycle cursor to the next sound."
        : "Triggering while playing skips to the next queued sound in the chain.";
    }
    // shuffled
    return cycleMode
      ? "Triggering while playing advances to the next random position in the cycle."
      : "Triggering while playing skips to the next randomly-ordered sound in the chain.";
  }

  const helpers: Record<Exclude<RetriggerMode, "next">, Record<PlaybackMode, string>> = {
    restart: {
      "one-shot": "Each retrigger stops the current sound and plays it from the beginning.",
      hold: "Re-pressing the pad while held stops and restarts the sound.",
      loop: "Each retrigger stops the loop and restarts from the beginning.",
    },
    continue: {
      "one-shot": "Triggering while the sound plays is ignored — it plays to completion.",
      hold: "Re-pressing while held is ignored.",
      loop: "Once looping, subsequent triggers have no effect.",
    },
    stop: {
      "one-shot": "Triggering while playing stops the sound. Trigger again to play.",
      hold: "Re-pressing while held stops the sound.",
      loop: "Triggering while looping stops the loop. Trigger again to restart.",
    },
  };

  return helpers[retriggerMode as Exclude<RetriggerMode, "next">][playbackMode];
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

// ─── Component ─────────────────────────────────────────────────────────────

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
  const cycleMode = layer?.cycleMode ?? false;
  const playbackMode = layer?.playbackMode ?? "one-shot";
  const retriggerMode = layer?.retriggerMode ?? "restart";
  const instanceCount = selectionType === "assigned" && layer?.selection.type === "assigned"
    ? layer.selection.instances.length
    : 0;

  // Cast array element paths — react-hook-form requires path strings;
  // we use fixed-index alias (0) for TypeScript inference.
  const selPath = `layers.${index}.selection` as `layers.0.selection`;
  const arrPath = `layers.${index}.arrangement` as `layers.0.arrangement`;
  const cyclePath = `layers.${index}.cycleMode` as `layers.0.cycleMode`;
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
    if (v === "simultaneous") {
      if (retriggerMode === "next") setValue(rtPath, "restart", { shouldDirty: true });
      setValue(cyclePath, false, { shouldDirty: true });
    }
  }

  // Compute helper texts
  const arrangementHelper = getArrangementHelper(selectionType, arrangement, cycleMode, instanceCount);
  const cycleModeHelper = (arrangement === "sequential" || arrangement === "shuffled")
    ? getCycleModeHelper(arrangement, cycleMode, playbackMode)
    : null;
  const playbackModeHelper = getPlaybackModeHelper(playbackMode, retriggerMode);
  const retriggerHelper = getRetriggerHelper(retriggerMode, playbackMode, arrangement, cycleMode);

  return (
    <div className="flex flex-col gap-4">
      {/* Selection Type */}
      <div className="flex flex-col gap-2">
        <SectionLabel
          label="Sound Selection"
          tooltip="Determines which sounds this layer can use when the pad is triggered."
        />
        <Tabs value={selectionType} onValueChange={(v) => {
          if (v === "assigned" || v === "tag" || v === "set")
            handleSelectionTypeChange(v);
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

      {/* Arrangement */}
      <div className="flex flex-col gap-2">
        <SectionLabel
          label="Arrangement"
          tooltip="Controls whether eligible sounds play all at once, or one at a time in order or at random."
        />
        <Tabs
          value={arrangement}
          onValueChange={(v) => {
            if (ARRANGEMENT_OPTIONS.some((o) => o.value === v))
              handleArrangementChange(v as Arrangement);
          }}
        >
          <TabsList stretch>
            {ARRANGEMENT_OPTIONS.map((opt) => (
              <TabWithTooltip
                key={opt.value}
                value={opt.value}
                label={opt.label}
                tooltip={ARRANGEMENT_TAB_TOOLTIPS[opt.value]}
              />
            ))}
          </TabsList>
        </Tabs>
        {arrangementHelper && (
          <p className="text-xs text-muted-foreground">{arrangementHelper}</p>
        )}
      </div>

      {/* Cycle Mode */}
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
              <Tabs
                value={field.value ? "cycle" : "continuous"}
                onValueChange={(v) => field.onChange(v === "cycle")}
              >
                <TabsList stretch>
                  <TabWithTooltip value="continuous" label="Continuous" tooltip={CYCLE_MODE_TAB_TOOLTIPS.continuous} />
                  <TabWithTooltip value="cycle" label="Cycle" tooltip={CYCLE_MODE_TAB_TOOLTIPS.cycle} />
                </TabsList>
              </Tabs>
            )}
          />
          {cycleModeHelper && (
            <p className="text-xs text-muted-foreground">{cycleModeHelper}</p>
          )}
        </div>
      )}

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
              <TabWithTooltip
                key={opt.value}
                value={opt.value}
                label={opt.label}
                tooltip={PLAYBACK_MODE_TAB_TOOLTIPS[opt.value]}
              />
            ))}
          </TabsList>
        </Tabs>
        {playbackModeHelper && (
          <p className="text-xs text-muted-foreground">{playbackModeHelper}</p>
        )}
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
                <TabWithTooltip
                  key={opt.value}
                  value={opt.value}
                  label={opt.label}
                  tooltip={RETRIGGER_TAB_TOOLTIPS[opt.value]}
                />
              ))}
          </TabsList>
        </Tabs>
        {retriggerHelper && (
          <p className="text-xs text-muted-foreground">{retriggerHelper}</p>
        )}
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
