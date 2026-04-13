import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from "motion/react";
import { Slider } from "@/components/ui/slider";
import type { Pad } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { usePlaybackStore } from "@/state/playbackStore";
import { useUiStore } from "@/state/uiStore";
import { useLibraryStore } from "@/state/libraryStore";
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { useProjectStore } from "@/state/projectStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { usePadGesture } from "@/hooks/usePadGesture";
import { setPadVolume } from "@/lib/audio/padPlayer";
import { isPadActive } from "@/lib/audio/audioState";
import { getPadSoundState } from "@/lib/projectSoundReconcile";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { PadControlContent } from "./PadControlContent";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useIsMd } from "@/hooks/useBreakpoint";

interface PadButtonProps {
  pad: Pad;
  sceneId: string;
  index?: number;
  onEditClick?: (pad: Pad) => void;
}

export const PadButton = memo(function PadButton({ pad, sceneId, index = 0, onEditClick }: PadButtonProps) {
  const isPlaying = usePlaybackStore((s) => s.playingPadIds.has(pad.id));

  // useShallow so these only cause re-renders when their specific values change, not every tick.
  // activePadLayers: stable array reference while the same layers are active — only changes on
  //   layer start/stop, not every RAF frame.
  // layerProgressForPad: only re-renders THIS pad when ITS layer progress changes. Non-playing
  //   pads return {} (stable via shallow equality) and never re-render on audio ticks.
  const activePadLayers = usePlaybackStore(
    useShallow((s) => pad.layers.filter((l) => s.activeLayerIds.has(l.id)))
  );
  const layerProgressForPad = usePlaybackStore(
    useShallow((s) => {
      const result: Record<string, number> = {};
      for (const l of pad.layers) {
        const p = s.layerProgress[l.id];
        if (p !== undefined) result[l.id] = p;
      }
      return result;
    })
  );
  const editMode = useUiStore((s) => s.editMode);
  const toggleEditMode = useUiStore((s) => s.toggleEditMode);
  const { gestureHandlers, isDragging, dragVolume } = usePadGesture(pad);
  // padVolumes entry exists only when tick sees gain < 0.999 — absence means full volume
  const liveVolume = usePlaybackStore((s) => s.padVolumes[pad.id]);

  // liveVolumeChanging: true while an audio fade is actively running (liveVolume changing each frame).
  // A stability timer fires 300ms after liveVolume stops changing — at that point the volume has
  // settled and the bar should start its linger-then-hide sequence.
  // isDragging suppresses the stability timer so a pause mid-drag doesn't prematurely hide the bar.
  const [liveVolumeChanging, setLiveVolumeChanging] = useState(false);
  const liveVolumeStabilityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (isDragging) {
      // Drag active — show bar, cancel any pending stability timer
      setLiveVolumeChanging(true);
      if (liveVolumeStabilityTimerRef.current !== null) {
        clearTimeout(liveVolumeStabilityTimerRef.current);
        liveVolumeStabilityTimerRef.current = null;
      }
      return;
    }
    if (liveVolume !== undefined) {
      // Non-drag volume change (audio fade) — show bar, reset stability timer
      setLiveVolumeChanging(true);
      if (liveVolumeStabilityTimerRef.current !== null) clearTimeout(liveVolumeStabilityTimerRef.current);
      liveVolumeStabilityTimerRef.current = setTimeout(() => {
        liveVolumeStabilityTimerRef.current = null;
        setLiveVolumeChanging(false);
      }, 300);
    } else {
      // Volume returned to full or pad stopped — clear immediately
      if (liveVolumeStabilityTimerRef.current !== null) {
        clearTimeout(liveVolumeStabilityTimerRef.current);
        liveVolumeStabilityTimerRef.current = null;
      }
      setLiveVolumeChanging(false);
    }
    return () => {
      if (liveVolumeStabilityTimerRef.current !== null) {
        clearTimeout(liveVolumeStabilityTimerRef.current);
        liveVolumeStabilityTimerRef.current = null;
      }
    };
  }, [liveVolume, isDragging]);

  // isVolumeActive: true while volume is actively changing (drag or audio fade).
  // Goes false when drag ends or volume stabilizes → triggers the linger-then-hide sequence.
  const isVolumeActive = isDragging || liveVolumeChanging;
  const [showVolumeDisplay, setShowVolumeDisplay] = useState(false);
  const [volumeExiting, setVolumeExiting] = useState(false);
  const volumeFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const volumeHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastVolumeRef = useRef(liveVolume ?? 1.0);
  if (liveVolume !== undefined) lastVolumeRef.current = liveVolume;
  if (dragVolume !== null) lastVolumeRef.current = dragVolume;
  // During a drag, prefer dragVolume (updated synchronously on every pointer move) over
  // liveVolume (tick-driven, up to one RAF frame stale). Fallback to last seen tick value.
  const displayVolume = (isDragging && dragVolume !== null)
    ? dragVolume
    : (liveVolume ?? dragVolume ?? lastVolumeRef.current);

  useEffect(() => {
    if (isVolumeActive) {
      if (volumeFadeTimerRef.current !== null) {
        clearTimeout(volumeFadeTimerRef.current);
        volumeFadeTimerRef.current = null;
      }
      if (volumeHideTimerRef.current !== null) {
        clearTimeout(volumeHideTimerRef.current);
        volumeHideTimerRef.current = null;
      }
      setShowVolumeDisplay(true);
      setVolumeExiting(false);
    } else {
      volumeFadeTimerRef.current = setTimeout(() => {
        volumeFadeTimerRef.current = null;
        setVolumeExiting(true);
        volumeHideTimerRef.current = setTimeout(() => {
          volumeHideTimerRef.current = null;
          setShowVolumeDisplay(false);
          setVolumeExiting(false);
        }, 220);
      }, 450);
    }
    return () => {
      if (volumeFadeTimerRef.current !== null) {
        clearTimeout(volumeFadeTimerRef.current);
        volumeFadeTimerRef.current = null;
      }
      if (volumeHideTimerRef.current !== null) {
        clearTimeout(volumeHideTimerRef.current);
        volumeHideTimerRef.current = null;
      }
    };
  }, [isVolumeActive]);

  // Multi-fade mode derived state — read from store directly
  const multiFadeActive = useMultiFadeStore((s) => s.active);
  const isMultiFadeSelected = useMultiFadeStore((s) => s.active && s.selectedPads.has(pad.id));
  const multiFadeLevels = useMultiFadeStore((s) => {
    if (!s.active) return null;
    const entry = s.selectedPads.get(pad.id);
    return entry ? entry.levels : null;
  });
  const toggleMultiFadePad = useMultiFadeStore((s) => s.toggleMultiFadePad);
  const setMultiFadeLevels = useMultiFadeStore((s) => s.setMultiFadeLevels);
  const reopenPadId = useMultiFadeStore((s) => s.reopenPadId);
  const clearReopenPadId = useMultiFadeStore((s) => s.clearMultiFadeReopenPadId);

  const setPadFadeDuration = useProjectStore((s) => s.setPadFadeDuration);
  const globalFadeDurationMs = useAppSettingsStore((s) => s.settings?.globalFadeDurationMs);

  const resolvedFadeDuration = pad.fadeDurationMs ?? globalFadeDurationMs ?? 2000;
  const [displayDuration, setDisplayDuration] = useState(resolvedFadeDuration);
  useEffect(() => {
    setDisplayDuration(resolvedFadeDuration);
  }, [resolvedFadeDuration]);

  const isDesktop = useIsMd();

  // Popover (right-click live controls)
  const [popoverOpen, setPopoverOpen] = useState(false);
  // Capture popover state at pointer-down so contextMenu handler can close it:
  // Radix fires onOpenChange(false) before the contextMenu event, so by the time
  // handleContextMenu runs, popoverOpen is already false — making a naive toggle reopen it.
  const popoverWasOpenRef = useRef(false);

  // Virtual anchor: a 0×0 point at the cursor position when right-clicked.
  // Using a point anchor (instead of the full pad cell) gives avoidCollisions room
  // to flip: the anchor height was ~818px leaving only ~43px above and ~13px below,
  // so Radix correctly concluded neither side fit. A 0×0 cursor anchor has ~Y px
  // above and ~(viewportH - Y) px below, giving the flip logic what it needs.
  const contextMenuXY = useRef({ x: 0, y: 0 });
  const virtualAnchorRef = useRef<{ getBoundingClientRect: () => DOMRect }>({
    getBoundingClientRect() {
      const { x, y } = contextMenuXY.current;
      return new DOMRect(x, y, 0, 0);
    },
  });

  // Close popover when edit mode or multi-fade mode activates
  useEffect(() => {
    if (editMode || multiFadeActive) {
      setPopoverOpen(false);
    }
  }, [editMode, multiFadeActive]);

  // Reopen popover when this pad is the reopenPadId after multi-fade cancel
  useEffect(() => {
    if (reopenPadId === pad.id) {
      setPopoverOpen(true);
      clearReopenPadId();
    }
  }, [reopenPadId, pad.id, clearReopenPadId]);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id: pad.id, disabled: !editMode });

  // dnd-kit transform — lives on the motion.div wrapper (outermost element)
  const dndStyle = useMemo(
    () => ({
      transform: CSS.Transform.toString(transform),
      transition,
    }),
    [transform, transition],
  );

  // 3D tilt — disabled in edit mode, during drag, and in multi-fade mode
  const tiltEnabled = !editMode && !isSortableDragging && !multiFadeActive;
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const rotateX = useSpring(useTransform(mouseY, [-0.5, 0.5], [4, -4]), { stiffness: 300, damping: 30 });
  const rotateY = useSpring(useTransform(mouseX, [-0.5, 0.5], [-4, 4]), { stiffness: 300, damping: 30 });

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!tiltEnabled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    mouseX.set((e.clientX - rect.left) / rect.width - 0.5);
    mouseY.set((e.clientY - rect.top) / rect.height - 0.5);
  }

  function handleMouseLeave() {
    mouseX.set(0);
    mouseY.set(0);
  }

  function handleWrapperPointerDown() {
    // Snap tilt to zero immediately to prevent freeze during usePadGesture pointer capture
    mouseX.set(0);
    mouseY.set(0);
  }

  const missingSoundIds = useLibraryStore((s) => s.missingSoundIds);
  const padSoundState = useMemo(
    () => getPadSoundState(pad, missingSoundIds),
    [pad, missingSoundIds],
  );
  const isUnplayable = padSoundState === "disabled";

  // Multi-fade mode: left-click toggles pad selection instead of triggering playback
  // Read liveVolume imperatively to avoid recomputing on every RAF frame during a fade
  const multiFadeHandlers = useMemo(() => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const vol = usePlaybackStore.getState().padVolumes[pad.id] ?? 1.0;
      const playing = isPadActive(pad.id);
      toggleMultiFadePad(pad.id, playing, vol);
    },
  }), [toggleMultiFadePad, pad.id]);

  // Right-click toggles live control popover.
  // We record the open state at pointer-down because Radix fires onOpenChange(false)
  // before the contextMenu event, which would otherwise cause a naive toggle to reopen.
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (editMode || multiFadeActive || isUnplayable) return;
    if (!popoverWasOpenRef.current) {
      contextMenuXY.current = { x: e.clientX, y: e.clientY };
    }
    setPopoverOpen(popoverWasOpenRef.current ? false : true);
  }, [editMode, multiFadeActive, isUnplayable]);

  // Selection ring styling for multi-fade selected pads
  const multiFadeSelectionClass = useMemo(() => {
    if (!isMultiFadeSelected) return null;
    return isPlaying
      ? "border-amber-400 ring-2 ring-amber-400"
      : "border-teal-400 ring-2 ring-teal-400";
  }, [isMultiFadeSelected, isPlaying]);

  return (
    <>
      {/*
       * Two-element split:
       * - Outer div: owns dnd-kit ref + translate transform + edit-mode drag listeners.
       *   Plain div so motion never overwrites the dnd-kit transform string.
       * - Inner motion.div: owns tilt rotation + whileTap. Its transform is separate
       *   from dnd-kit's translate, so both compose correctly.
       *
       * PopoverAnchor uses virtualRef pointing to a 0×0 DOMRect at the cursor position
       * recorded on right-click. This gives avoidCollisions real room to flip: wrapping
       * the 818px-tall grid cell left only ~43px above and ~13px below, so Radix correctly
       * chose "top" but still clipped. A point anchor has ~Y px above and ~(viewportH-Y)
       * below, letting flip work correctly.
       */}
      <Popover open={isDesktop && popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverAnchor virtualRef={virtualAnchorRef as React.RefObject<{ getBoundingClientRect: () => DOMRect }>} />
      <div
        ref={setNodeRef}
        style={dndStyle}
        className={cn("relative w-full h-full", isSortableDragging && "opacity-50")}
        {...(editMode ? attributes : {})}
        onPointerDown={(e) => {
          if (e.button === 2) popoverWasOpenRef.current = popoverOpen;
          // Only start a dnd-kit drag when the pointer-down did NOT originate on an
          // interactive child element (buttons inside PadControlContent on the back face).
          // Calling listeners.onPointerDown on interactive targets causes dnd-kit to
          // capture the pointer, which swallows the subsequent click event.
          if (editMode && listeners?.onPointerDown) {
            const target = e.target as HTMLElement;
            if (!target.closest("button, input, a, select, textarea")) {
              listeners.onPointerDown(e);
            }
          }
        }}
        onContextMenu={handleContextMenu}
      >
        <motion.div
          className={cn("w-full h-full", isPlaying && !editMode && "drop-shadow-[0_5px_0px_#FACC15]")}
          style={{ rotateX: tiltEnabled ? rotateX : 0, rotateY: tiltEnabled ? rotateY : 0, transformPerspective: 600, transformStyle: 'preserve-3d' }}
          whileTap={!editMode && !multiFadeActive ? { scale: 0.95 } : undefined}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onPointerDown={!editMode ? handleWrapperPointerDown : undefined}
        >
          {/* Playing pulse ring — inside tilt wrapper so it follows the 3D rotation */}
          <AnimatePresence>
            {isPlaying && !editMode && !multiFadeActive && (
              <motion.div
                key="pulse"
                className="absolute -inset-1 rounded-xl pointer-events-none border-4 border-white/60 z-10"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0.3, 0.8, 0.3] }}
                transition={{ repeat: Infinity, duration: 1.2, ease: "easeInOut" }}
                exit={{ opacity: 0, transition: { duration: 0.2, ease: "easeOut" } }}
              />
            )}
          </AnimatePresence>
          {/* Flip container — rotates to reveal back face (edit overlay) */}
          <motion.div
            className="relative w-full h-full"
            animate={{ rotateY: editMode ? 180 : 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 22, delay: index * 0.03 }}
            style={{ transformStyle: 'preserve-3d' }}
          >
            {/* Front face — normal pad */}
            <div className="absolute inset-0 [backface-visibility:hidden]" aria-hidden={editMode || undefined}>
              <button
                aria-label={pad.name}
                {...(multiFadeActive ? multiFadeHandlers : gestureHandlers)}
                disabled={isUnplayable && !multiFadeActive}
                className={cn(
                  "relative w-full h-full rounded-xl overflow-hidden",
                  "flex items-center justify-center p-2",
                  "bg-card text-card-foreground",
                  "shadow-[3px_3px_0px_rgba(0,0,0,0.3)]",
                  "text-sm font-semibold text-center select-none",
                  isUnplayable && !multiFadeActive
                    ? "opacity-40 border-2 border-black/20"
                    : multiFadeSelectionClass
                      ? cn("border-2 cursor-pointer", multiFadeSelectionClass)
                      : cn(
                          "border-2 transition-all cursor-pointer",
                          "hover:brightness-110",
                          isPlaying
                            ? "border-yellow-400"
                            : "border-black/20"
                        )
                )}
                style={{
                  backgroundColor: isPlaying ? "#000" : (pad.color ?? undefined),
                  transition: "background-color 0.7s ease",
                  color: isPlaying ? "#fff" : undefined,
                }}
              >
                {/* Volume transition bar — fades in on enter, lingers 450ms, then fades out */}
                {showVolumeDisplay && (
                  <motion.div
                    className="absolute bottom-0 left-0 right-0 pointer-events-none bg-yellow-500 border-t-2 border-black"
                    style={{ height: `${displayVolume * 100}%` }}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: volumeExiting ? 0 : 1 }}
                    transition={{ duration: volumeExiting ? 0.22 : 0.15 }}
                  />
                )}
                {/* Playback progress — one bar per active layer, split vertically */}
                {isPlaying && activePadLayers.length > 0 && (
                  <div className="absolute inset-0 pointer-events-none flex flex-col">
                    {activePadLayers.map((layer) => (
                      <div
                        key={layer.id}
                        className="relative overflow-hidden flex-1"
                      >
                        <div
                          className="absolute top-0 left-0 bottom-0 bg-white/20 border border-white rounded-r"
                          style={{ width: `${(layerProgressForPad[layer.id] ?? 0) * 100}%` }}
                        />
                      </div>
                    ))}
                  </div>
                )}
                {/* Pad name + optional volume — height animates open on mount for smooth name shift */}
                <div className="relative z-10 flex flex-col items-center gap-0.5">
                  <span data-testid="pad-name" className="line-clamp-2 break-words leading-tight text-center">{pad.name}</span>
                  {showVolumeDisplay && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{
                        opacity: volumeExiting ? 0 : 1,
                        height: volumeExiting ? 0 : "auto",
                      }}
                      transition={{ duration: volumeExiting ? 0.22 : 0.2 }}
                      style={{ overflow: "hidden" }}
                      className="flex justify-center"
                    >
                      <span className="text-xs font-bold tabular-nums">
                        {Math.round(displayVolume * 100)}%
                      </span>
                    </motion.div>
                  )}
                </div>
                {/* Multi-fade slider overlay on selected pad */}
                <AnimatePresence>
                  {isMultiFadeSelected && multiFadeLevels && (
                    <motion.div
                      className="absolute bottom-0 left-0 right-0 z-20 px-2 pb-1.5 pt-0.5 bg-black/60 backdrop-blur-sm rounded-b-xl"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 8 }}
                      transition={{ duration: 0.15 }}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <Slider
                        compact
                        tooltipLabel={(v) => `${v}%`}
                        value={[multiFadeLevels[0], multiFadeLevels[1]]}
                        onValueChange={(v) => {
                          if (isPlaying && v[1] !== multiFadeLevels[1]) {
                            setPadVolume(pad.id, v[1] / 100);
                          }
                          setMultiFadeLevels(pad.id, [v[0], v[1]]);
                        }}
                        onPointerUp={() => {}}
                        min={0}
                        max={100}
                        step={1}
                        className="[&_[data-slot=slider-track]]:bg-white/20"
                      />
                      <div className="flex justify-between text-[9px] text-white/70 mt-0.5">
                        <span>{isPlaying ? "end" : "start"}</span>
                        <span>{isPlaying ? "start" : "end"}</span>
                      </div>
                      <Slider
                        compact
                        tooltipLabel={(v) => `${(v / 1000).toFixed(1)}s`}
                        value={[displayDuration]}
                        onValueChange={(v) => setDisplayDuration(v[0])}
                        onPointerUp={() => setPadFadeDuration(sceneId, pad.id, displayDuration)}
                        min={100}
                        max={10000}
                        step={100}
                        className="mt-1.5 [&_[data-slot=slider-track]]:bg-white/20"
                      />
                      <div className="flex justify-between text-[9px] text-white/70 mt-0.5">
                        <span>fade</span>
                        <span>{(displayDuration / 1000).toFixed(1)}s</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </button>
              {padSoundState === "partial" && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="absolute bottom-1 right-1 z-20 pointer-events-auto">
                      <HugeiconsIcon icon={Alert02Icon} size={16} className="text-amber-400 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    Some assigned sounds are missing from the library. Open pad settings to review.
                  </TooltipContent>
                </Tooltip>
              )}
            </div>

            {/* Back face — shared control panel */}
            <div
              className="absolute inset-0 rounded-xl overflow-hidden bg-card [backface-visibility:hidden]"
              style={{ transform: 'rotateY(180deg)', backgroundColor: pad.color ?? undefined }}
              aria-hidden={!editMode || undefined}
            >
              <div className="w-full h-full p-2">
                <PadControlContent
                  pad={pad}
                  sceneId={sceneId}
                  context="backface"
                  // No dismiss action on back face — user exits edit mode via the global toggle
                  onClose={() => {}}
                  // Exit edit mode when multi-fade is entered so both state changes land in the
                  // same React render (editMode=false, active=true), preventing useMultiFadeMode
                  // from immediately cancelling and reopening the live-control popover.
                  onMultiFade={toggleEditMode}
                  onEditClick={onEditClick}
                />
              </div>
            </div>
          </motion.div>
        </motion.div>
      </div>
      <PopoverContent side="bottom" sideOffset={10} showArrow>
        <PadControlContent
          pad={pad}
          sceneId={sceneId}
          context="popover"
          onClose={() => setPopoverOpen(false)}
          onEditClick={onEditClick}
        />
      </PopoverContent>
      </Popover>

      <Drawer open={!isDesktop && popoverOpen} onOpenChange={setPopoverOpen}>
        <DrawerContent>
          <DrawerTitle className="sr-only">{pad.name}</DrawerTitle>
          <div className="px-4 pb-4 pt-2">
            <PadControlContent
              pad={pad}
              sceneId={sceneId}
              context="popover"
              onClose={() => setPopoverOpen(false)}
              onEditClick={onEditClick}
            />
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
});
