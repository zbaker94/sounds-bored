import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from "motion/react";
import { Slider } from "@/components/ui/slider";
import type { Pad } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { usePlaybackStore } from "@/state/playbackStore";
import { useUiStore } from "@/state/uiStore";
import { useLibraryStore } from "@/state/libraryStore";
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { usePadGesture } from "@/hooks/usePadGesture";
import { getPadProgress, setPadVolume } from "@/lib/audio/padPlayer";
import { isPadActive } from "@/lib/audio/audioState";
import { getPadSoundState } from "@/lib/projectSoundReconcile";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import { PadLiveControlPopover } from "./PadLiveControlPopover";
import { PadControlContent } from "./PadControlContent";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface PadButtonProps {
  pad: Pad;
  sceneId: string;
  index?: number;
  onEditClick?: (pad: Pad) => void;
}

export const PadButton = memo(function PadButton({ pad, sceneId, index = 0, onEditClick }: PadButtonProps) {
  const isPlaying = usePlaybackStore((s) => s.playingPadIds.has(pad.id));
  const editMode = useUiStore((s) => s.editMode);
  const { gestureHandlers } = usePadGesture(pad);
  const isVolumeTransitioning = usePlaybackStore((s) => s.volumeTransitioningPadIds.has(pad.id));
  const liveVolume = usePlaybackStore((s) => s.padVolumes[pad.id] ?? 1.0);
  const [showVolumeDisplay, setShowVolumeDisplay] = useState(false);
  const [volumeExiting, setVolumeExiting] = useState(false);
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number | null>(null);
  const volumeFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const volumeHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the last volume seen while transitioning; read synchronously during render on transition end
  const lastTransitionVolumeRef = useRef(liveVolume);

  // Update during render while actively transitioning — before the store resets to 1.0
  if (isVolumeTransitioning) {
    lastTransitionVolumeRef.current = liveVolume;
  }

  // During transition show the live value; when transition ends, read the snapshot directly from ref
  // (avoids a 1-frame jump that would occur if we stored it in state and updated via useEffect)
  const displayVolume = isVolumeTransitioning ? liveVolume : lastTransitionVolumeRef.current;

  useEffect(() => {
    if (isVolumeTransitioning) {
      // Cancel any pending linger/fade timers (re-triggered during hold)
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
      // Linger at full opacity, then fade, then unmount
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
  }, [isVolumeTransitioning]);

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

  // Popover (right-click live controls)
  const [popoverOpen, setPopoverOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Capture popover state at pointer-down so contextMenu handler can close it:
  // Radix fires onOpenChange(false) before the contextMenu event, so by the time
  // handleContextMenu runs, popoverOpen is already false — making a naive toggle reopen it.
  const popoverWasOpenRef = useRef(false);

  // Close popover when multi-fade mode activates
  useEffect(() => {
    if (multiFadeActive) {
      setPopoverOpen(false);
    }
  }, [multiFadeActive]);

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

  useEffect(() => {
    if (isPlaying) {
      const animate = () => {
        const p = getPadProgress(pad.id);
        setProgress(p ?? 0);
        rafRef.current = requestAnimationFrame(animate);
      };
      rafRef.current = requestAnimationFrame(animate);
    } else {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setProgress(0);
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, pad.id]);

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
    if (editMode || multiFadeActive) return;
    e.preventDefault();
    setPopoverOpen(popoverWasOpenRef.current ? false : true);
  }, [editMode, multiFadeActive]);

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
       */}
      <div
        ref={setNodeRef}
        style={dndStyle}
        className={cn("relative w-full h-full", isSortableDragging && "opacity-50")}
        {...(editMode ? { ...attributes, ...listeners } : {})}
        onPointerDown={(e) => { if (e.button === 2) popoverWasOpenRef.current = popoverOpen; }}
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
                ref={buttonRef}
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
                {/* Playback progress */}
                {isPlaying && (
                  <div
                    className="absolute top-0 left-0 bottom-0 pointer-events-none bg-white/20"
                    style={{ width: `${progress * 100}%` }}
                  />
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
                            usePlaybackStore.getState().startVolumeTransition(pad.id);
                          }
                          setMultiFadeLevels(pad.id, [v[0], v[1]]);
                        }}
                        onPointerUp={() => usePlaybackStore.getState().clearVolumeTransition(pad.id)}
                        min={0}
                        max={100}
                        step={1}
                        className="[&_[data-slot=slider-track]]:bg-white/20"
                      />
                      <div className="flex justify-between text-[9px] text-white/70 mt-0.5">
                        <span>{isPlaying ? "end" : "start"}</span>
                        <span>{isPlaying ? "start" : "end"}</span>
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
              className="absolute inset-0 rounded-xl overflow-hidden [backface-visibility:hidden]"
              style={{ transform: 'rotateY(180deg)', backgroundColor: pad.color ?? undefined }}
              aria-hidden={!editMode || undefined}
            >
              {/* Dark overlay for readability */}
              <div className="absolute inset-0 bg-black/60" />
              <div className="relative z-10 w-full h-full p-2">
                <PadControlContent
                  pad={pad}
                  sceneId={sceneId}
                  // No dismiss action on back face — user exits edit mode via the global toggle
                  onClose={() => {}}
                  onEditClick={onEditClick}
                />
              </div>
            </div>
          </motion.div>
        </motion.div>
      </div>

      <PadLiveControlPopover
        pad={pad}
        sceneId={sceneId}
        open={popoverOpen}
        onOpenChange={setPopoverOpen}
        anchorRef={buttonRef}
      />
    </>
  );
});
