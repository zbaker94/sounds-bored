import { Sound } from "@/lib/schemas";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ANALYSIS_LARGE_FILE_BYTES, ANALYSIS_LARGE_TOTAL_BYTES } from "@/lib/constants";
import type { AnalysisType } from "@/state/analysisStore";

interface AnalysisWarningDialogProps {
  open: boolean;
  sounds: Sound[];
  type: AnalysisType;
  onSkipAnalyzed: () => void;
  onAnalyzeAll: () => void;
  onCancel: () => void;
}

function countAnalyzed(sounds: Sound[], type: AnalysisType): number {
  return sounds.filter((s) =>
    type === "loudness" ? s.loudnessLufs !== undefined : s.genre !== undefined || s.mood !== undefined,
  ).length;
}

const TYPE_LABEL: Record<AnalysisType, string> = {
  loudness: "Loudness",
  genre: "Genre/Mood",
};

export function AnalysisWarningDialog({
  open,
  sounds,
  type,
  onSkipAnalyzed,
  onAnalyzeAll,
  onCancel,
}: AnalysisWarningDialogProps) {
  const analyzedCount = countAnalyzed(sounds, type);
  const totalBytes = sounds.reduce((sum, s) => sum + (s.fileSizeBytes ?? 0), 0);
  const hasLargeFiles =
    sounds.some((s) => (s.fileSizeBytes ?? 0) >= ANALYSIS_LARGE_FILE_BYTES) ||
    totalBytes >= ANALYSIS_LARGE_TOTAL_BYTES;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Analyze {TYPE_LABEL[type]} — {sounds.length} sound{sounds.length !== 1 ? "s" : ""}?</DialogTitle>
          {hasLargeFiles && (
            <DialogDescription>
              One or more selected files are large. Analysis can be slow and
              memory-intensive — the app may be less responsive while running.
            </DialogDescription>
          )}
        </DialogHeader>
        {analyzedCount > 0 && (
          <p className="text-sm text-muted-foreground">
            {analyzedCount} of {sounds.length} sound{sounds.length !== 1 ? "s" : ""} {analyzedCount === 1 ? "has" : "have"} already been analyzed and will be overwritten if you continue.
          </p>
        )}
        <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          {analyzedCount > 0 && analyzedCount < sounds.length && (
            <Button variant="secondary" onClick={onSkipAnalyzed}>
              Skip analyzed ({sounds.length - analyzedCount})
            </Button>
          )}
          <Button onClick={onAnalyzeAll}>
            Analyze all
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function shouldWarnBeforeAnalysis(sounds: Sound[], type: AnalysisType): boolean {
  const hasAnalyzed = sounds.some((s) =>
    type === "loudness" ? s.loudnessLufs !== undefined : s.genre !== undefined || s.mood !== undefined,
  );
  const totalBytes = sounds.reduce((sum, s) => sum + (s.fileSizeBytes ?? 0), 0);
  const hasLargeFiles =
    sounds.some((s) => (s.fileSizeBytes ?? 0) >= ANALYSIS_LARGE_FILE_BYTES) ||
    totalBytes >= ANALYSIS_LARGE_TOTAL_BYTES;
  return hasAnalyzed || hasLargeFiles;
}
