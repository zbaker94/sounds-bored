import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type {
  Arrangement,
  PlaybackMode,
  RetriggerMode,
} from "@/lib/schemas";

interface PillOption<T extends string> {
  value: T;
  label: string;
  description: string;
}

const ARRANGEMENT_OPTIONS: PillOption<Arrangement>[] = [
  { value: "simultaneous", label: "simultaneous", description: "All sounds play at once" },
  { value: "sequential", label: "sequential", description: "Sounds play in order, one per trigger" },
  { value: "shuffled", label: "shuffled", description: "Sounds play in random order, one per trigger" },
];

const PLAYBACK_OPTIONS: PillOption<PlaybackMode>[] = [
  { value: "one-shot", label: "one-shot", description: "Plays once and stops" },
  { value: "hold", label: "hold", description: "Plays while held, stops on release" },
  { value: "loop", label: "loop", description: "Loops until stopped" },
];

const RETRIGGER_OPTIONS: PillOption<RetriggerMode>[] = [
  { value: "restart", label: "restart", description: "Restarts from beginning" },
  { value: "continue", label: "continue", description: "Continues from current position" },
  { value: "stop", label: "stop", description: "Stops if already playing" },
  { value: "next", label: "next", description: "Advances to next sound" },
];

interface PillProps<T extends string> {
  category: string;
  value: T | undefined;
  options: PillOption<T>[];
  onChange: (value: T) => void;
}

function Pill<T extends string>({ category, value, options, onChange }: PillProps<T>) {
  const [open, setOpen] = useState(false);
  const isSet = value !== undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={category}
        data-pill-category={category}
        data-pill-set={isSet ? "true" : "false"}
        data-pill-active={open ? "true" : "false"}
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors outline-none",
          isSet
            ? "bg-muted text-muted-foreground border border-transparent"
            : "border border-dashed border-muted-foreground/50 text-muted-foreground",
          open && "border-primary ring-1 ring-primary",
        )}
      >
        {isSet ? (
          <span>{value}</span>
        ) : (
          <>
            <HugeiconsIcon icon={Add01Icon} size={12} />
            <span>{category}</span>
          </>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 gap-1 p-1"
        role="listbox"
        aria-label={`${category} options`}
      >
        {options.map((opt) => {
          const selected = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={cn(
                "flex flex-col items-start gap-0.5 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground",
                selected && "bg-accent text-accent-foreground",
              )}
            >
              <span className="font-medium">{opt.label}</span>
              <span className="text-muted-foreground">{opt.description}</span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

export interface PillRowProps {
  layerId: string;
  arrangement: Arrangement | undefined;
  playbackMode: PlaybackMode | undefined;
  retriggerMode: RetriggerMode | undefined;
  onArrangementChange: (value: Arrangement) => void;
  onPlaybackModeChange: (value: PlaybackMode) => void;
  onRetriggerModeChange: (value: RetriggerMode) => void;
}

export function PillRow({
  layerId,
  arrangement,
  playbackMode,
  retriggerMode,
  onArrangementChange,
  onPlaybackModeChange,
  onRetriggerModeChange,
}: PillRowProps) {
  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      data-testid={`pill-row-${layerId}`}
    >
      <Pill
        category="Arrangement"
        value={arrangement}
        options={ARRANGEMENT_OPTIONS}
        onChange={onArrangementChange}
      />
      <Pill
        category="Playback"
        value={playbackMode}
        options={PLAYBACK_OPTIONS}
        onChange={onPlaybackModeChange}
      />
      <Pill
        category="Retrigger"
        value={retriggerMode}
        options={RETRIGGER_OPTIONS}
        onChange={onRetriggerModeChange}
      />
    </div>
  );
}
