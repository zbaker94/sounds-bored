import { useCallback } from "react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, PlayIcon } from "@hugeicons/core-free-icons";
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { useProjectStore } from "@/state/projectStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { fadePadWithLevels, resolveFadeDuration } from "@/lib/audio/padPlayer";
import { toast } from "sonner";

export function MultiFadePill() {
  const count = useMultiFadeStore((s) => s.selectedPads.size);
  const active = useMultiFadeStore((s) => s.active);
  const canExecute = active && count > 0;
  const cancelMultiFade = useMultiFadeStore((s) => s.cancelMultiFade);
  const resetMultiFade = useMultiFadeStore((s) => s.resetMultiFade);

  const execute = useCallback(() => {
    if (!canExecute) return;
    const pads = useProjectStore.getState().project?.scenes.flatMap((s) => s.pads) ?? [];
    const allSelectedPads = useMultiFadeStore.getState().selectedPads;
    const globalFadeDurationMs = useAppSettingsStore.getState().settings?.globalFadeDurationMs;

    for (const [padId, fade] of allSelectedPads) {
      const pad = pads.find((p) => p.id === padId);
      if (!pad) continue;
      const duration = resolveFadeDuration(pad, globalFadeDurationMs);
      fadePadWithLevels(pad, duration, fade.levels[0] / 100, fade.levels[1] / 100).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`Playback error: audio fade failed — ${message}`);
      });
    }
    resetMultiFade();
  }, [canExecute, resetMultiFade]);

  const cancel = useCallback(() => {
    cancelMultiFade();
  }, [cancelMultiFade]);

  return (
    <motion.div
      className="absolute bottom-4 left-1/2 z-30 flex items-center gap-3 rounded-full bg-black/80 px-4 py-2 text-white shadow-lg border border-white/20 backdrop-blur-sm"
      style={{ x: "-50%" }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
    >
      <span className="text-sm font-medium tabular-nums">
        {count} pad{count !== 1 ? "s" : ""} selected
      </span>
      <Button
        size="sm"
        variant="default"
        disabled={!canExecute}
        onClick={() => execute()}
        className="gap-1.5"
      >
        <HugeiconsIcon icon={PlayIcon} size={14} />
        Execute Fade
      </Button>
      <button
        type="button"
        onClick={() => cancel()}
        className="p-1 rounded-full hover:bg-white/20 transition-colors"
        aria-label="Cancel multi-fade"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={16} />
      </button>
    </motion.div>
  );
}
