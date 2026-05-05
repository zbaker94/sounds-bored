import { useMemo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading03Icon, AudioWave01Icon, CheckmarkCircle01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useAnalysisStore } from "@/state/analysisStore";
import { useLibraryStore } from "@/state/libraryStore";

export function AnalysisStatusButton() {
  const { status, completedCount, queueLength, errorCount, currentSoundId, currentAnalysisType } = useAnalysisStore(
    useShallow((s) => ({
      status: s.status,
      completedCount: s.completedCount,
      queueLength: s.queueLength,
      errorCount: Object.keys(s.errors).length,
      currentSoundId: s.currentSoundId,
      currentAnalysisType: s.currentAnalysisType,
    })),
  );

  const sounds = useLibraryStore((s) => s.sounds);
  const currentSoundName = useMemo(
    () => (currentSoundId ? (sounds.find((s) => s.id === currentSoundId)?.name ?? null) : null),
    [sounds, currentSoundId],
  );

  if (status === "idle") return null;

  const progress = queueLength > 0 ? (completedCount / queueLength) * 100 : 0;
  const isRunning = status === "running";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="icon-sm" aria-label="Analysis status" className="relative">
          <HugeiconsIcon
            icon={isRunning ? Loading03Icon : AudioWave01Icon}
            size={14}
            className={isRunning ? "animate-spin" : undefined}
          />
          {isRunning && (
            <span className="absolute -top-1 -left-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-bold leading-none text-primary-foreground">
              {queueLength - completedCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-64 p-3 gap-2">
        <div className="flex items-center gap-2 mb-2">
          <HugeiconsIcon
            icon={isRunning ? Loading03Icon : CheckmarkCircle01Icon}
            size={14}
            className={isRunning ? "animate-spin text-primary" : "text-green-400"}
          />
          <span className="text-xs font-medium">
            {isRunning
              ? currentAnalysisType === "loudness"
                ? "Analyzing loudness…"
                : currentAnalysisType === "genre"
                  ? "Analyzing genre/mood…"
                  : "Analyzing sounds…"
              : "Analysis complete"}
          </span>
        </div>
        <Progress value={progress} className="mb-2" />
        {isRunning && currentSoundName && (
          <p className="text-xs text-muted-foreground truncate mb-1" title={currentSoundName}>
            {currentSoundName}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {completedCount} / {queueLength} sounds
          {errorCount > 0 && ` · ${errorCount} error${errorCount > 1 ? "s" : ""}`}
        </p>
        {isRunning && (
          <>
            <Separator className="my-2" />
            <button
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => useAnalysisStore.getState().cancelQueue()}
            >
              <HugeiconsIcon icon={Cancel01Icon} size={11} />
              Cancel pending
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
