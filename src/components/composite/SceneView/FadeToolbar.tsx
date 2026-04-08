import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { VolumeHighIcon, ShuffleIcon } from "@hugeicons/core-free-icons";
import { Kbd } from "@/components/ui/kbd";
import type { UseFadeModeReturn } from "@/hooks/useFadeMode";

interface FadeToolbarProps {
  // fadeMode is passed as a prop (rather than called internally) because SceneView
  // also consumes it for PadButton rendering (getPadFadeVisual, onPadTap). Calling
  // useFadeMode() twice would create two independent state machines.
  fadeMode: UseFadeModeReturn;
}

export function FadeToolbar({ fadeMode }: FadeToolbarProps) {
  return (
    <motion.div
      className="flex items-center gap-2 shrink-0"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.15 }}
    >
      <Button
        variant={fadeMode.mode === "fade" ? "default" : "ghost"}
        size="sm"
        onClick={() =>
          fadeMode.mode === "fade" ? fadeMode.cancel() : fadeMode.enterFade()
        }
        aria-label="Fade pad"
      >
        <HugeiconsIcon icon={VolumeHighIcon} size={16} />
        Fade
        <Kbd className="ml-1">F</Kbd>
      </Button>
      <Button
        variant={fadeMode.mode === "crossfade" ? "default" : "ghost"}
        size="sm"
        onClick={() => {
          if (fadeMode.mode === "crossfade") {
            if (fadeMode.canExecute) fadeMode.execute();
            else fadeMode.cancel();
          } else {
            fadeMode.enterCrossfade();
          }
        }}
        disabled={fadeMode.mode !== "crossfade" && !fadeMode.hasPlayingPads}
        aria-label="Crossfade pads"
      >
        <HugeiconsIcon icon={ShuffleIcon} size={16} />
        Crossfade
        <Kbd className="ml-1">X</Kbd>
      </Button>
      <AnimatePresence>
        {fadeMode.statusLabel && (
          <motion.span
            key="status-label"
            className="text-xs font-medium px-2.5 py-1 rounded-full bg-black/50 text-white border border-white/20"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.15 }}
          >
            {fadeMode.statusLabel}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
