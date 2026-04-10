import { useState, useEffect, useRef, useCallback, memo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
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
  ListMusicIcon,
} from "@hugeicons/core-free-icons";
import { useIsMd } from "@/hooks/useBreakpoint";
import { usePlaybackStore } from "@/state/playbackStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { useProjectStore } from "@/state/projectStore";
import {
  isPadActive,
  isLayerActive as checkLayerActive,
  getLayerChain,
  getLayerPlayOrder,
} from "@/lib/audio/audioState";
import {
  triggerPad,
  stopPad,
  fadePadWithLevels,
  triggerLayer,
  stopLayerWithRamp,
  setLayerVolume,
  commitLayerVolume,
  setPadVolume,
  skipLayerForward,
  skipLayerBack,
} from "@/lib/audio/padPlayer";
import type { Pad, Sound, Layer, Tag, Set as SchemaSet } from "@/lib/schemas";
import { toast } from "sonner";
import { useLibraryStore } from "@/state/libraryStore";
import { cn } from "@/lib/utils";

interface PadLiveControlPopoverProps {
  pad: Pad;
  sceneId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
}

const STAGGER_DELAY = 0.04;

/**
 * Resolves the set of sounds that will play for a layer, based on its selection type.
 * For "assigned": maps instances to library sounds in instance order.
 * For "tag": returns all library sounds matching the tag criteria.
 * For "set": returns all library sounds that belong to the set.
 * Sounds with no matching library entry are excluded.
 */
export function getSoundsForLayer(layer: Layer, sounds: Sound[]): Sound[] {
  const sel = layer.selection;
  switch (sel.type) {
    case "assigned":
      return sel.instances
        .map((inst) => sounds.find((s) => s.id === inst.soundId))
        .filter((s): s is Sound => s !== undefined);
    case "tag":
      return sounds.filter((s) => {
        if (sel.matchMode === "all") {
          return sel.tagIds.every((id) => s.tags.includes(id));
        }
        return sel.tagIds.some((id) => s.tags.includes(id));
      });
    case "set":
      return sounds.filter((s) => s.sets.includes(sel.setId));
  }
}

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
  const isChainedArrangement = layer.arrangement === "sequential" || layer.arrangement === "shuffled";
  const showSkip = isChainedArrangement;

  const sounds = useLibraryStore((s) => s.sounds);
  const allSounds = getSoundsForLayer(layer, sounds);
  const tags = useLibraryStore((s) => s.tags as Tag[]);
  const sets = useLibraryStore((s) => s.sets as SchemaSet[]);
  const missingSoundIds = useLibraryStore((s) => s.missingSoundIds);

  const [listOpen, setListOpen] = useState(false);
  const listAnchorRef = useRef<HTMLButtonElement>(null);

  const totalSoundCount =
    layer.selection.type === "assigned"
      ? layer.selection.instances.length
      : allSounds.length;

  const selectionTitle = (() => {
    const sel = layer.selection;
    switch (sel.type) {
      case "assigned":
        return "Sounds";
      case "tag": {
        const names = sel.tagIds
          .map((id) => tags.find((t) => t.id === id)?.name ?? id)
          .join(", ");
        return `Tag: ${names}`;
      }
      case "set": {
        const name = sets.find((s) => s.id === sel.setId)?.name ?? sel.setId;
        return `Set: ${name}`;
      }
    }
  })();

  // ─── Current-sound RAF polling (sequential/shuffled while active) ───────────
  const [currentSoundId, setCurrentSoundId] = useState<string | null>(null);
  // Tracks the live play order so the list reflects shuffled/sequential order and updates on wrap
  const [activePlayOrder, setActivePlayOrder] = useState<Sound[] | null>(null);
  const soundRafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!layerActive || !isChainedArrangement) {
      setCurrentSoundId(null);
      setActivePlayOrder(null);
      if (soundRafRef.current !== null) {
        cancelAnimationFrame(soundRafRef.current);
        soundRafRef.current = null;
      }
      return;
    }

    const poll = () => {
      const playOrder = getLayerPlayOrder(layer.id);
      const chain = getLayerChain(layer.id);
      if (playOrder && playOrder.length > 0) {
        // Use reference equality — getLayerPlayOrder returns the same array until a new order is set
        setActivePlayOrder((prev) => (prev === playOrder ? prev : playOrder));
        const chainLength = chain?.length ?? 0;
        const currentIdx = Math.max(0, playOrder.length - chainLength - 1);
        const currentSound = playOrder[currentIdx];
        const nextId = currentSound?.id ?? null;
        setCurrentSoundId((prev) => (prev === nextId ? prev : nextId));
      } else {
        setActivePlayOrder(null);
        setCurrentSoundId(null);
      }
      soundRafRef.current = requestAnimationFrame(poll);
    };
    soundRafRef.current = requestAnimationFrame(poll);

    return () => {
      if (soundRafRef.current !== null) {
        cancelAnimationFrame(soundRafRef.current);
        soundRafRef.current = null;
      }
      setCurrentSoundId(null);
      setActivePlayOrder(null);
    };
  }, [layerActive, isChainedArrangement, layer.id]);

  // ─── Display text ────────────────────────────────────────────────────────────
  const displayText = (() => {
    if (layerActive && isChainedArrangement && currentSoundId) {
      const current = allSounds.find((s) => s.id === currentSoundId);
      return current?.name ?? allSounds.map((s) => s.name).join(" · ");
    }
    return allSounds.map((s) => s.name).join(" · ");
  })();

  // Overflow detection for marquee animation
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOverflow, setIsOverflow] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setIsOverflow(el.scrollWidth > el.clientWidth);
  }, [displayText]);

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
      {/* Sound display row */}
      {allSounds.length > 0 && (
        <div className="flex items-center gap-1" data-testid="layer-sound-display">
          <div ref={containerRef} className="overflow-hidden flex-1 min-w-0">
            {isOverflow ? (
              <div
                className="flex gap-8"
                style={{ animation: "marquee 10s linear infinite" }}
              >
                <span className="whitespace-nowrap text-xs text-muted-foreground">{displayText}</span>
                <span className="whitespace-nowrap text-xs text-muted-foreground" aria-hidden>{displayText}</span>
              </div>
            ) : (
              <span className="whitespace-nowrap text-xs text-muted-foreground">{displayText}</span>
            )}
          </div>

          {totalSoundCount > 1 && (
            <>
              <button
                ref={listAnchorRef}
                type="button"
                aria-label="Show sound list"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => setListOpen((o) => !o)}
                className="p-0.5 rounded hover:bg-muted transition-colors flex-shrink-0"
              >
                <HugeiconsIcon icon={ListMusicIcon} size={12} />
              </button>
              <Popover open={listOpen} onOpenChange={setListOpen}>
                <PopoverAnchor virtualRef={listAnchorRef as React.RefObject<{ getBoundingClientRect: () => DOMRect }>} />
                <PopoverContent side="top" sideOffset={6} className="w-48 p-2">
                  <p className="text-xs font-semibold mb-1.5">{selectionTitle}</p>
                  <ol className="flex flex-col gap-0.5 max-h-48 overflow-y-auto">
                    {(activePlayOrder ?? allSounds).map((sound, i) => (
                      <li
                        key={sound.id}
                        className={cn(
                          "text-xs py-0.5",
                          currentSoundId === sound.id
                            ? "font-semibold text-foreground"
                            : missingSoundIds.has(sound.id)
                            ? "text-muted-foreground italic"
                            : "text-muted-foreground"
                        )}
                      >
                        {i + 1}. {sound.name}
                      </li>
                    ))}
                  </ol>
                </PopoverContent>
              </Popover>
            </>
          )}
        </div>
      )}
      <Slider
        compact
        tooltipLabel={(v) => `${v}%`}
        value={[layerVol]}
        onValueChange={([v]) => setLayerVolume(layer.id, v / 100)}
        onValueCommit={([v]) => commitLayerVolume(layer.id, v / 100)}
        min={0}
        max={100}
        step={1}
      />
    </motion.div>
  );
}

function PadLiveControlContent({
  pad,
  sceneId,
  onClose,
}: {
  pad: Pad;
  sceneId: string;
  onClose: () => void;
}) {
  const isPlaying = usePlaybackStore((s) => s.playingPadIds.has(pad.id));
  const padVolume = usePlaybackStore((s) => s.padVolumes[pad.id] ?? 1.0);
  const enterMultiFade = useMultiFadeStore((s) => s.enterMultiFade);
  const updatePad = useProjectStore((s) => s.updatePad);
  const globalFadeDurationMs = useAppSettingsStore((s) => s.settings?.globalFadeDurationMs ?? 2000);
  const fadeDuration = pad.fadeDurationMs ?? globalFadeDurationMs;

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

  // Clear startThumbDraggingRef when pointer released anywhere (handles out-of-bounds release)
  useEffect(() => {
    const handlePointerUp = () => {
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
    const fromLevel = fadeLevels[0] / 100;
    const toLevel = fadeLevels[1] / 100;
    fadePadWithLevels(pad, fadeDuration, fromLevel, toLevel).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Playback error: audio fade failed — ${message}`);
    });
    onClose();
  }, [pad, fadeLevels, fadeDuration, onClose]);

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
          <Slider
            tooltipLabel={(v) => `${v}%`}
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
              if (startThumbDraggingRef.current) {
                startThumbDraggingRef.current = false;
                usePlaybackStore.getState().clearVolumeTransition(pad.id);
              }
            }}
            onThumbPointerDown={(index) => {
              if (index === 1) startThumbDraggingRef.current = true;
            }}
            min={0}
            max={100}
            step={1}
          />
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Fade Duration</span>
              <span className="tabular-nums">{(fadeDuration / 1000).toFixed(1)}s</span>
            </div>
            <Slider
              compact
              tooltipLabel={(v) => `${(v / 1000).toFixed(1)}s`}
              value={[fadeDuration]}
              onValueChange={([v]) => {
                const { id, ...config } = pad;
                updatePad(sceneId, id, { ...config, fadeDurationMs: v });
              }}
              min={100}
              max={10000}
              step={100}
            />
            {pad.fadeDurationMs !== undefined ? (
              <button
                type="button"
                className="text-xs text-muted-foreground underline self-start"
                onClick={() => {
                  const { id, ...config } = pad;
                  updatePad(sceneId, id, { ...config, fadeDurationMs: undefined });
                }}
              >
                Reset to default
              </button>
            ) : (
              <p className="text-xs text-muted-foreground">
                Global default ({(globalFadeDurationMs / 1000).toFixed(1)}s)
              </p>
            )}
          </div>
          <Button size="sm" variant="secondary" onClick={handleFade} className="w-full gap-1.5">
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
        <Button size="sm" variant="ghost" onClick={handleMultiFade} className="bg-yellow-500 w-full text-xs">
          Synchronized Fades
        </Button>
      </motion.div>
    </div>
  );
}

export const PadLiveControlPopover = memo(function PadLiveControlPopover({
  pad,
  sceneId,
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
              sceneId={sceneId}
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
      <PopoverContent className="w-72" side="top" sideOffset={10} showArrow>
        <PadLiveControlContent
          pad={pad}
          sceneId={sceneId}
          onClose={handleClose}
        />
      </PopoverContent>
    </Popover>
  );
});
