import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { VolumeHighIcon, ShuffleIcon } from "@hugeicons/core-free-icons";
import { Kbd } from "@/components/ui/kbd";
import { Slider as SliderPrimitive } from "radix-ui";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { UseFadeModeReturn } from "@/hooks/useFadeMode";

interface FadeToolbarProps {
  // fadeMode is passed as a prop (rather than called internally) because SceneView
  // also consumes it for PadButton rendering (getPadFadeVisual, onPadTap). Calling
  // useFadeMode() twice would create two independent state machines.
  fadeMode: UseFadeModeReturn;
}

export function FadeToolbar({ fadeMode }: FadeToolbarProps) {
  const showSlider = fadeMode.mode === "fade";
  // Controlled tooltip open state: tooltip stays visible while hovering OR dragging.
  // Radix Tooltip closes on pointerdown by default; we bypass that by driving open ourselves.
  // Radix Slider Root captures the pointer on drag, so pointerup must be caught on Root.
  const [thumbsHovered, setThumbsHovered] = useState<[boolean, boolean]>([false, false]);
  const [thumbsDragging, setThumbsDragging] = useState<[boolean, boolean]>([false, false]);
  function setHovered(i: number, v: boolean) {
    setThumbsHovered((p) => [i === 0 ? v : p[0], i === 1 ? v : p[1]]);
  }
  function setDragging(i: number, v: boolean) {
    setThumbsDragging((p) => [i === 0 ? v : p[0], i === 1 ? v : p[1]]);
  }

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
      <AnimatePresence mode="wait">
        {showSlider ? (
          <motion.div
            key="fade-slider"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.15 }}
            className="h-8 w-36 flex items-center px-1"
          >
            <SliderPrimitive.Root
                value={fadeMode.fadeLevels}
                onValueChange={(v) => fadeMode.setFadeLevels(v as [number, number])}
                onPointerUp={() => setThumbsDragging([false, false])}
                min={0}
                max={100}
                step={1}
                className="relative flex w-full touch-none items-center select-none"
              >
                <SliderPrimitive.Track className="relative grow overflow-hidden rounded-4xl bg-muted h-3 w-full">
                  <SliderPrimitive.Range className="absolute h-full bg-primary" />
                </SliderPrimitive.Track>
                {fadeMode.fadeLevels.map((val, index) => (
                  <Tooltip key={index} open={thumbsHovered[index] || thumbsDragging[index]}>
                    <TooltipTrigger asChild>
                      <SliderPrimitive.Thumb
                        className="block size-4 shrink-0 rounded-4xl border border-primary bg-white shadow-sm ring-ring/50 transition-colors select-none hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden"
                        onPointerEnter={() => setHovered(index, true)}
                        onPointerLeave={() => setHovered(index, false)}
                        onPointerDown={() => setDragging(index, true)}
                      />
                    </TooltipTrigger>
                    <TooltipContent>{val}%</TooltipContent>
                  </Tooltip>
                ))}
              </SliderPrimitive.Root>
          </motion.div>
        ) : (
          <motion.div
            key="crossfade-button"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.15 }}
          >
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
          </motion.div>
        )}
      </AnimatePresence>
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
