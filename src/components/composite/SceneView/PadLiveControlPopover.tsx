import { useState, useEffect, useRef, useCallback, memo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Slider as SliderPrimitive } from "radix-ui";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  PlayIcon,
  StopIcon,
  VolumeHighIcon,
  NextIcon,
  PreviousIcon,
} from "@hugeicons/core-free-icons";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIsMd } from "@/hooks/useBreakpoint";
import { usePlaybackStore } from "@/state/playbackStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { isPadActive } from "@/lib/audio/audioState";
import {
  triggerPad,
  stopPad,
  fadePadWithLevels,
  resolveFadeDuration,
  triggerLayer,
  stopLayerWithRamp,
  setLayerVolume,
  commitLayerVolume,
  setPadVolume,
  skipLayerForward,
  skipLayerBack,
} from "@/lib/audio/padPlayer";
import { isLayerActive as checkLayerActive } from "@/lib/audio/audioState";
import type { Pad } from "@/lib/schemas";
import { toast } from "sonner";

interface PadLiveControlPopoverProps {
  pad: Pad;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
}

const STAGGER_DELAY = 0.04;

function LayerRow({
  pad,
  layer,
  idx,
  layerActive,
}: {
  pad: Pad;
  layer: Pad["layers"][number];
  idx: number;
  layerActive: boolean;
}) {
  const layerVol = usePlaybackStore((s) => Math.round((s.layerVolumes[layer.id] ?? (layer.volume / 100)) * 100));
  const showSkip = layer.arrangement === "sequential" || layer.arrangement === "shuffled";

  return (
    <motion.div
      key={layer.id}
      className="flex flex-col gap-1 rounded-lg bg-muted/50 p-1.5"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.12, delay: STAGGER_DELAY * 2 + idx * 0.03 }}
    >
      <div className="flex items-center gap-1.5">
        <span className={`text-xs ${layerActive ? "text-emerald-400" : "text-muted-foreground"}`}>
          {layerActive ? "\u25CF" : "\u25CB"}
        </span>
        <span className="text-xs font-medium flex-1 truncate">
          {layer.name || `Layer ${idx + 1}`}
        </span>
        <AnimatePresence mode="wait">
          {layerActive ? (
            <motion.div key="stop-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }}>
              <button
                type="button"
                onClick={() => stopLayerWithRamp(pad, layer.id)}
                className="p-0.5 rounded hover:bg-destructive/20 transition-colors"
                aria-label={`Stop ${layer.name || `Layer ${idx + 1}`}`}
              >
                <HugeiconsIcon icon={StopIcon} size={12} />
              </button>
            </motion.div>
          ) : (
            <motion.div key="play-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }}>
              <button
                type="button"
                onClick={() => {
                  triggerLayer(pad, layer).catch((err: unknown) => {
                    const message = err instanceof Error ? err.message : String(err);
                    toast.error(`Playback error: ${message}`);
                  });
                }}
                className="p-0.5 rounded hover:bg-primary/20 transition-colors"
                aria-label={`Play ${layer.name || `Layer ${idx + 1}`}`}
              >
                <HugeiconsIcon icon={PlayIcon} size={12} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        {showSkip && (
          <>
            <button
              type="button"
              onClick={() => skipLayerBack(pad, layer.id)}
              className="p-0.5 rounded hover:bg-muted transition-colors"
              aria-label="Skip back"
            >
              <HugeiconsIcon icon={PreviousIcon} size={12} />
            </button>
            <button
              type="button"
              onClick={() => skipLayerForward(pad, layer.id)}
              className="p-0.5 rounded hover:bg-muted transition-colors"
              aria-label="Skip forward"
            >
              <HugeiconsIcon icon={NextIcon} size={12} />
            </button>
          </>
        )}
      </div>
      <SliderPrimitive.Root
        value={[layerVol]}
        onValueChange={([v]) => setLayerVolume(layer.id, v / 100)}
        onValueCommit={([v]) => commitLayerVolume(layer.id, v / 100)}
        min={0}
        max={100}
        step={1}
        className="relative flex w-full touch-none items-center select-none"
      >
        <SliderPrimitive.Track className="relative grow overflow-hidden rounded-4xl bg-muted h-2 w-full">
          <SliderPrimitive.Range className="absolute h-full bg-primary" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className="block size-3 shrink-0 rounded-4xl border border-primary bg-white shadow-sm ring-ring/50 transition-colors select-none hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden" />
      </SliderPrimitive.Root>
    </motion.div>
  );
}

function PadLiveControlContent({
  pad,
  onClose,
}: {
  pad: Pad;
  onClose: () => void;
}) {
  const isPlaying = usePlaybackStore((s) => s.playingPadIds.has(pad.id));
  const padVolume = usePlaybackStore((s) => s.padVolumes[pad.id] ?? 1.0);
  const enterMultiFade = useMultiFadeStore((s) => s.enterMultiFade);

  // fadeLevels[0] = the "other end" thumb (end when playing, start when not playing).
  // fadeLevels[1] = the "start (current)" thumb = current pad volume.
  // Dragging fadeLevels[1] updates padVolume live; external padVolume changes
  // (e.g. fades, vertical drag) sync back into fadeLevels[1] when not dragging.
  const [fadeLevels, setFadeLevels] = useState<[number, number]>([0, 100]);
  const startThumbDraggingRef = useRef(false);

  // Reset the end thumb when the pad stops playing
  useEffect(() => {
    if (!isPlaying) {
      setFadeLevels([0, 100]);
    }
  }, [isPlaying]);

  // Sync right thumb from padVolume when not actively dragging it
  useEffect(() => {
    if (!startThumbDraggingRef.current) {
      setFadeLevels((prev) => {
        const newRight = Math.round(padVolume * 100);
        return prev[1] === newRight ? prev : [prev[0], newRight];
      });
    }
  }, [padVolume]);

  // Clear thumbsDragging when pointer released anywhere (handles out-of-bounds release)
  useEffect(() => {
    const handlePointerUp = () => {
      setThumbsDragging([false, false]);
      if (startThumbDraggingRef.current) {
        startThumbDraggingRef.current = false;
        usePlaybackStore.getState().clearVolumeTransition(pad.id);
      }
    };
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointerup", handlePointerUp);
      // If component unmounts while right thumb is mid-drag, ensure transition is cleared
      if (startThumbDraggingRef.current) {
        startThumbDraggingRef.current = false;
        usePlaybackStore.getState().clearVolumeTransition(pad.id);
      }
    };
  }, [pad.id]);

  // Track active layers via RAF polling — only runs when pad is playing
  const [activeLayerIds, setActiveLayerIds] = useState<Set<string>>(new Set());
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isPlaying) {
      // Clear active layers immediately when pad stops
      setActiveLayerIds((prev) => (prev.size === 0 ? prev : new Set()));
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const poll = () => {
      const active = new Set<string>();
      for (const layer of pad.layers) {
        if (checkLayerActive(layer.id)) active.add(layer.id);
      }
      // Only update if set contents changed (avoid unnecessary re-renders)
      setActiveLayerIds((prev) => {
        if (prev.size === active.size && [...active].every((id) => prev.has(id))) return prev;
        return active;
      });
      rafRef.current = requestAnimationFrame(poll);
    };
    rafRef.current = requestAnimationFrame(poll);
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      setActiveLayerIds(new Set()); // clear stale state on unmount/effect re-run
    };
  }, [isPlaying, pad.layers]);

  // Tooltip state for two-thumb slider
  const [thumbsHovered, setThumbsHovered] = useState<[boolean, boolean]>([false, false]);
  const [thumbsDragging, setThumbsDragging] = useState<[boolean, boolean]>([false, false]);
  function setHovered(i: number, v: boolean) {
    setThumbsHovered((p) => [i === 0 ? v : p[0], i === 1 ? v : p[1]]);
  }
  function setDragging(i: number, v: boolean) {
    setThumbsDragging((p) => [i === 0 ? v : p[0], i === 1 ? v : p[1]]);
  }

  const handleStartStop = useCallback(() => {
    if (isPlaying) {
      stopPad(pad);
    } else {
      triggerPad(pad).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`Playback error: ${message}`);
      });
    }
  }, [isPlaying, pad]);

  const handleFade = useCallback(() => {
    const globalFadeDurationMs = useAppSettingsStore.getState().settings?.globalFadeDurationMs;
    const duration = resolveFadeDuration(pad, globalFadeDurationMs);

    const fromLevel = fadeLevels[0] / 100;
    const toLevel = fadeLevels[1] / 100;
    fadePadWithLevels(pad, duration, fromLevel, toLevel).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Playback error: audio fade failed — ${message}`);
    });
    onClose();
  }, [pad, fadeLevels, isPlaying, onClose]);

  const handleMultiFade = useCallback(() => {
    const playing = isPadActive(pad.id);
    enterMultiFade(pad.id, playing, padVolume);
    onClose();
  }, [pad.id, padVolume, enterMultiFade, onClose]);

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15 }}
      >
        <h3 className="font-deathletter tracking-wider text-base font-semibold truncate">
          {pad.name}
        </h3>
      </motion.div>

      {/* Pad controls */}
      <motion.div
        className="flex flex-col gap-2"
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15, delay: STAGGER_DELAY }}
      >
        <AnimatePresence mode="wait">
          {isPlaying ? (
            <motion.div key="stop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }}>
              <Button size="sm" variant="destructive" onClick={handleStartStop} className="w-full gap-1.5">
                <HugeiconsIcon icon={StopIcon} size={14} />
                Stop
              </Button>
            </motion.div>
          ) : (
            <motion.div key="play" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }}>
              <Button size="sm" variant="default" onClick={handleStartStop} className="w-full gap-1.5">
                <HugeiconsIcon icon={PlayIcon} size={14} />
                Start
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Fade slider */}
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{isPlaying ? "end" : "start"}</span>
            <span>{isPlaying ? "start (current)" : "end"}</span>
          </div>
          <SliderPrimitive.Root
            value={fadeLevels}
            onValueChange={(v) => {
              const next = v as [number, number];
              if (isPlaying && next[1] !== fadeLevels[1]) {
                // Right thumb moved — update pad volume live
                setPadVolume(pad.id, next[1] / 100);
                usePlaybackStore.getState().startVolumeTransition(pad.id);
              }
              setFadeLevels(next);
            }}
            onPointerUp={() => {
              setThumbsDragging([false, false]);
              if (startThumbDraggingRef.current) {
                startThumbDraggingRef.current = false;
                usePlaybackStore.getState().clearVolumeTransition(pad.id);
              }
            }}
            min={0}
            max={100}
            step={1}
            className="relative flex w-full touch-none items-center select-none"
          >
            <SliderPrimitive.Track className="relative grow overflow-hidden rounded-4xl bg-muted h-3 w-full">
              <SliderPrimitive.Range className="absolute h-full bg-primary" />
            </SliderPrimitive.Track>
            {fadeLevels.map((val, index) => (
              <Tooltip key={index} open={thumbsHovered[index] || thumbsDragging[index]}>
                <TooltipTrigger asChild>
                  <SliderPrimitive.Thumb
                    className="block size-4 shrink-0 rounded-4xl border border-primary bg-white shadow-sm ring-ring/50 transition-colors select-none hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden"
                    onPointerEnter={() => setHovered(index, true)}
                    onPointerLeave={() => setHovered(index, false)}
                    onPointerDown={() => {
                      setDragging(index, true);
                      if (index === 1) startThumbDraggingRef.current = true;
                    }}
                  />
                </TooltipTrigger>
                <TooltipContent>{val}%</TooltipContent>
              </Tooltip>
            ))}
          </SliderPrimitive.Root>
          <Button size="sm" variant="outline" onClick={handleFade} className="w-full gap-1.5">
            <HugeiconsIcon icon={VolumeHighIcon} size={14} />
            {isPlaying ? "Fade Out" : "Fade In"}
          </Button>
        </div>
      </motion.div>

      {/* Layers section */}
      <motion.div
        className="flex flex-col gap-1.5"
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15, delay: STAGGER_DELAY * 2 }}
      >
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Layers
        </h4>
        <div className="flex flex-col gap-1">
          {pad.layers.map((layer, idx) => {
            const layerActive = activeLayerIds.has(layer.id);
            return (
              <LayerRow
                key={layer.id}
                pad={pad}
                layer={layer}
                idx={idx}
                layerActive={layerActive}
              />
            );
          })}
        </div>
      </motion.div>

      {/* Footer */}
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15, delay: STAGGER_DELAY * 3 }}
      >
        <Button size="sm" variant="ghost" onClick={handleMultiFade} className="w-full text-xs">
          Multi-fade with others...
        </Button>
      </motion.div>
    </div>
  );
}

export const PadLiveControlPopover = memo(function PadLiveControlPopover({
  pad,
  open,
  onOpenChange,
  anchorRef,
}: PadLiveControlPopoverProps) {
  const isDesktop = useIsMd();

  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  if (!isDesktop) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent>
          <DrawerHeader className="text-left">
            <DrawerTitle className="font-deathletter tracking-wider text-2xl">
              {pad.name}
            </DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-4">
            <PadLiveControlContent
              pad={pad}
              onClose={handleClose}
            />
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor virtualRef={anchorRef as React.RefObject<{ getBoundingClientRect: () => DOMRect }>} />
      <PopoverContent className="w-72" side="top" sideOffset={8}>
        <PadLiveControlContent
          pad={pad}
          onClose={handleClose}
        />
      </PopoverContent>
    </Popover>
  );
});
