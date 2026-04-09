import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, PlayIcon } from "@hugeicons/core-free-icons";
import type { UseMultiFadeModeReturn } from "@/hooks/useMultiFadeMode";

interface MultiFadePillProps {
  mode: UseMultiFadeModeReturn;
}

export function MultiFadePill({ mode }: MultiFadePillProps) {
  const count = mode.selectedPads.size;

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
        disabled={!mode.canExecute}
        onClick={() => mode.execute()}
        className="gap-1.5"
      >
        <HugeiconsIcon icon={PlayIcon} size={14} />
        Execute Fade
      </Button>
      <button
        type="button"
        onClick={() => mode.cancel()}
        className="p-1 rounded-full hover:bg-white/20 transition-colors"
        aria-label="Cancel multi-fade"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={16} />
      </button>
    </motion.div>
  );
}
