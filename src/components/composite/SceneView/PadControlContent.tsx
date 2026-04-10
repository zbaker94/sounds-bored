import { useState, useEffect, useRef, useCallback, memo, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  PlayIcon,
  StopIcon,
  VolumeHighIcon,
  NextIcon,
  PreviousIcon,
  ListMusicIcon,
  PencilEdit01Icon,
  Copy01Icon,
  Delete02Icon,
  Settings01Icon,
  Layers01Icon,
} from "@hugeicons/core-free-icons";
import { usePlaybackStore } from "@/state/playbackStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { useProjectStore } from "@/state/projectStore";
import {
  isPadActive,
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
import type { Pad, Sound, Layer } from "@/lib/schemas";
import { toast } from "sonner";
import { useLibraryStore } from "@/state/libraryStore";
import { cn } from "@/lib/utils";
import { ConfirmDeletePadDialog } from "@/components/modals/ConfirmDeletePadDialog";

const STAGGER_DELAY = 0.04;

type DisplayMode = "full" | "condensed" | "scroll";

function getDisplayMode(height: number): DisplayMode {
  if (height >= 280) return "full";
  if (height >= 200) return "condensed";
  return "scroll";
}

export interface PadControlContentProps {
  pad: Pad;
  sceneId: string;
  onClose: () => void;
  onEditClick?: (pad: Pad) => void;
}

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

// ─── LayerRow ────────────────────────────────────────────────────────────────

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
  const layerVol = usePlaybackStore(
    (s) => Math.round((s.layerVolumes[layer.id] ?? (layer.volume / 100)) * 100)
  );
  const isChainedArrangement =
    layer.arrangement === "sequential" || layer.arrangement === "shuffled";
  const showSkip = isChainedArrangement;

  const sounds = useLibraryStore((s) => s.sounds);
  const allSounds = useMemo(
    () => getSoundsForLayer(layer, sounds),
    [layer, sounds]
  );
  const tags = useLibraryStore((s) => s.tags);
  const sets = useLibraryStore((s) => s.sets);
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

  const [currentSoundId, setCurrentSoundId] = useState<string | null>(null);
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

  const displayText = (() => {
    if (layerActive && isChainedArrangement && currentSoundId) {
      const current = allSounds.find((s) => s.id === currentSoundId);
      return current?.name ?? allSounds.map((s) => s.name).join(" · ");
    }
    return allSounds.map((s) => s.name).join(" · ");
  })();

  const textContainerRef = useRef<HTMLDivElement>(null);
  const [isOverflow, setIsOverflow] = useState(false);
  useEffect(() => {
    const el = textContainerRef.current;
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
        <span
          className={`text-xs ${layerActive ? "text-emerald-400" : "text-muted-foreground"}`}
        >
          {layerActive ? "\u25CF" : "\u25CB"}
        </span>
        <span className="text-xs font-medium flex-1 truncate">
          {layer.name || `Layer ${idx + 1}`}
        </span>
        <AnimatePresence mode="wait">
          {layerActive ? (
            <motion.div
              key="stop-layer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.1 }}
            >
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
            <motion.div
              key="play-layer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.1 }}
            >
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
      {allSounds.length > 0 && (
        <div className="flex items-center gap-1" data-testid="layer-sound-display">
          <div ref={textContainerRef} className="overflow-hidden flex-1 min-w-0">
            {isOverflow ? (
              <div
                className="flex gap-8"
                style={{ animation: "marquee 10s linear infinite" }}
              >
                <span className="whitespace-nowrap text-xs text-muted-foreground">
                  {displayText}
                </span>
                <span
                  className="whitespace-nowrap text-xs text-muted-foreground"
                  aria-hidden
                >
                  {displayText}
                </span>
              </div>
            ) : (
              <span className="whitespace-nowrap text-xs text-muted-foreground">
                {displayText}
              </span>
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
                <PopoverAnchor
                  virtualRef={
                    listAnchorRef as React.RefObject<{
                      getBoundingClientRect: () => DOMRect;
                    }>
                  }
                />
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

// ─── PadControlContent ───────────────────────────────────────────────────────

export const PadControlContent = memo(function PadControlContent({
  pad,
  sceneId,
  onClose,
  onEditClick,
}: PadControlContentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("full");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [subPopover, setSubPopover] = useState<null | "fade" | "layers">(null);
  const fadeOptionsAnchorRef = useRef<HTMLButtonElement>(null);
  const layersAnchorRef = useRef<HTMLButtonElement>(null);

  const duplicatePad = useProjectStore((s) => s.duplicatePad);
  const deletePad = useProjectStore((s) => s.deletePad);
  const updatePad = useProjectStore((s) => s.updatePad);

  const isPlaying = usePlaybackStore((s) => s.playingPadIds.has(pad.id));
  const padVolume = usePlaybackStore((s) => s.padVolumes[pad.id] ?? 1.0);
  const activeLayerIds = usePlaybackStore((s) => s.activeLayerIds);
  const enterMultiFade = useMultiFadeStore((s) => s.enterMultiFade);
  const globalFadeDurationMs = useAppSettingsStore(
    (s) => s.settings?.globalFadeDurationMs ?? 2000
  );
  const fadeDuration = pad.fadeDurationMs ?? globalFadeDurationMs;

  const [fadeLevels, setFadeLevels] = useState<[number, number]>([0, 100]);
  const startThumbDraggingRef = useRef(false);

  // ResizeObserver — switches display mode based on available height
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setDisplayMode(getDisplayMode(el.getBoundingClientRect().height));
    const ro = new ResizeObserver(([entry]) => {
      setDisplayMode(getDisplayMode(entry.contentRect.height));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Reset end thumb when pad stops
  useEffect(() => {
    if (!isPlaying) setFadeLevels([0, 100]);
  }, [isPlaying]);

  // Sync right thumb from padVolume when not actively dragging
  useEffect(() => {
    if (!startThumbDraggingRef.current) {
      setFadeLevels((prev) => {
        const newRight = Math.round(padVolume * 100);
        return prev[1] === newRight ? prev : [prev[0], newRight];
      });
    }
  }, [padVolume]);

  // Clear startThumbDraggingRef on pointer release anywhere
  useEffect(() => {
    const handlePointerUp = () => {
      if (startThumbDraggingRef.current) {
        startThumbDraggingRef.current = false;
      }
    };
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointerup", handlePointerUp);
      if (startThumbDraggingRef.current) {
        startThumbDraggingRef.current = false;
      }
    };
  }, []);

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

  const fadeSection = (
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
            setPadVolume(pad.id, next[1] / 100);
          }
          setFadeLevels(next);
        }}
        onPointerUp={() => {
          if (startThumbDraggingRef.current) {
            startThumbDraggingRef.current = false;
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
  );

  const layersSection = (
    <div className="flex flex-col gap-1">
      {pad.layers.map((layer, idx) => (
        <LayerRow
          key={layer.id}
          pad={pad}
          layer={layer}
          idx={idx}
          layerActive={activeLayerIds.has(layer.id)}
        />
      ))}
    </div>
  );

  return (
    <>
      <div
        ref={containerRef}
        className={cn(
          "flex flex-col gap-3 w-full h-full",
          displayMode === "full" && "overflow-hidden",
          displayMode === "scroll" && "overflow-y-auto"
        )}
      >
        {/* Header — always visible */}
        <motion.div
          className="flex items-center gap-1"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15 }}
        >
          <h3 className="font-deathletter tracking-wider text-base font-semibold truncate flex-1 min-w-0">
            {pad.name}
          </h3>
          <Button
            size="icon-xs"
            variant="default"
            aria-label="Edit pad"
            onClick={() => { onEditClick?.(pad); onClose(); }}
          >
            <HugeiconsIcon icon={PencilEdit01Icon} size={12} />
          </Button>
          <Button
            size="icon-xs"
            variant="secondary"
            aria-label="Duplicate pad"
            onClick={() => { duplicatePad(sceneId, pad.id); onClose(); }}
          >
            <HugeiconsIcon icon={Copy01Icon} size={12} />
          </Button>
          <Button
            size="icon-xs"
            variant="destructive"
            aria-label="Delete pad"
            onClick={() => setConfirmingDelete(true)}
          >
            <HugeiconsIcon icon={Delete02Icon} size={12} />
          </Button>
        </motion.div>

        {/* ── Full mode ─────────────────────────────────────────────────── */}
        {displayMode === "full" && (
          <>
            <motion.div
              className="flex flex-col gap-2 flex-shrink-0"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15, delay: STAGGER_DELAY }}
            >
              <AnimatePresence mode="wait">
                {isPlaying ? (
                  <motion.div
                    key="stop"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.1 }}
                  >
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={handleStartStop}
                      className="w-full gap-1.5"
                    >
                      <HugeiconsIcon icon={StopIcon} size={14} />
                      Stop
                    </Button>
                  </motion.div>
                ) : (
                  <motion.div
                    key="play"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.1 }}
                  >
                    <Button
                      size="sm"
                      variant="default"
                      onClick={handleStartStop}
                      className="w-full gap-1.5"
                    >
                      <HugeiconsIcon icon={PlayIcon} size={14} />
                      Start
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
              {fadeSection}
            </motion.div>

            <motion.div
              className="flex flex-col gap-1.5 flex-1 min-h-0"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15, delay: STAGGER_DELAY * 2 }}
            >
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex-shrink-0">
                Layers
              </h4>
              <div className="overflow-y-auto flex-1 min-h-0">
                {layersSection}
              </div>
            </motion.div>

            <motion.div
              className="flex-shrink-0"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15, delay: STAGGER_DELAY * 3 }}
            >
              <Button
                size="sm"
                variant="ghost"
                onClick={handleMultiFade}
                className="bg-yellow-500 w-full text-xs"
              >
                Synchronized Fades
              </Button>
            </motion.div>
          </>
        )}

        {/* ── Condensed / Scroll mode ───────────────────────────────────── */}
        {(displayMode === "condensed" || displayMode === "scroll") && (
          <>
            {/* Start/Stop */}
            <AnimatePresence mode="wait">
              {isPlaying ? (
                <motion.div
                  key="stop-c"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.1 }}
                >
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleStartStop}
                    className="w-full gap-1.5"
                  >
                    <HugeiconsIcon icon={StopIcon} size={14} />
                    Stop
                  </Button>
                </motion.div>
              ) : (
                <motion.div
                  key="play-c"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.1 }}
                >
                  <Button
                    size="sm"
                    variant="default"
                    onClick={handleStartStop}
                    className="w-full gap-1.5"
                  >
                    <HugeiconsIcon icon={PlayIcon} size={14} />
                    Start
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Compact action row */}
            <div className="flex items-center gap-1">
              {/* Fade In/Out — fires with default levels */}
              <Button
                size="sm"
                variant="secondary"
                onClick={handleFade}
                className="flex-1 gap-1 text-xs"
              >
                <HugeiconsIcon icon={VolumeHighIcon} size={12} />
                {isPlaying ? "Fade Out" : "Fade In"}
              </Button>

              {/* Fade options sub-popover anchor */}
              <Button
                ref={fadeOptionsAnchorRef}
                size="icon-xs"
                variant="outline"
                aria-label="Fade options"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() =>
                  setSubPopover((p) => (p === "fade" ? null : "fade"))
                }
              >
                <HugeiconsIcon icon={Settings01Icon} size={12} />
              </Button>

              {/* Layers sub-popover anchor */}
              <Button
                ref={layersAnchorRef}
                size="icon-xs"
                variant="outline"
                aria-label="Layers"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() =>
                  setSubPopover((p) => (p === "layers" ? null : "layers"))
                }
              >
                <HugeiconsIcon icon={Layers01Icon} size={12} />
              </Button>

              {/* Synchronized Fades — fires directly */}
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Synchronized Fades"
                className="bg-yellow-500"
                onClick={handleMultiFade}
              >
                <HugeiconsIcon icon={PlayIcon} size={12} />
              </Button>
            </div>

            {/* Fade options sub-popover */}
            <Popover
              open={subPopover === "fade"}
              onOpenChange={(o) => setSubPopover(o ? "fade" : null)}
            >
              <PopoverAnchor
                virtualRef={
                  fadeOptionsAnchorRef as React.RefObject<{
                    getBoundingClientRect: () => DOMRect;
                  }>
                }
              />
              <PopoverContent side="top" sideOffset={6} className="w-64 p-3">
                {fadeSection}
              </PopoverContent>
            </Popover>

            {/* Layers sub-popover */}
            <Popover
              open={subPopover === "layers"}
              onOpenChange={(o) => setSubPopover(o ? "layers" : null)}
            >
              <PopoverAnchor
                virtualRef={
                  layersAnchorRef as React.RefObject<{
                    getBoundingClientRect: () => DOMRect;
                  }>
                }
              />
              <PopoverContent side="top" sideOffset={6} className="w-64 p-3">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                  Layers
                </h4>
                {layersSection}
              </PopoverContent>
            </Popover>
          </>
        )}
      </div>

      <ConfirmDeletePadDialog
        isOpen={confirmingDelete}
        padName={pad.name}
        onConfirm={() => {
          setConfirmingDelete(false);
          stopPad(pad);
          deletePad(sceneId, pad.id);
          onClose();
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
    </>
  );
});
