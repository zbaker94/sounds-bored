import { memo, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from "motion/react";
import type { Pad } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { usePlaybackStore } from "@/state/playbackStore";
import { useProjectStore } from "@/state/projectStore";
import { useUiStore } from "@/state/uiStore";
import { usePadGesture } from "@/hooks/usePadGesture";
import { getPadProgress, stopPad } from "@/lib/audio/padPlayer";
import { HugeiconsIcon } from "@hugeicons/react";
import { PencilEdit01Icon, Copy01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { ConfirmDeletePadDialog } from "@/components/modals/ConfirmDeletePadDialog";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { PadFadeVisual } from "@/hooks/useFadeMode";

interface PadButtonProps {
  pad: Pad;
  sceneId: string;
  index?: number;
  onEditClick?: (pad: Pad) => void;
  fadeVisual?: PadFadeVisual;
  onFadeTap?: (padId: string) => void;
}

export const PadButton = memo(function PadButton({ pad, sceneId, index = 0, onEditClick, fadeVisual = null, onFadeTap }: PadButtonProps) {
  const isPlaying = usePlaybackStore((s) => s.playingPadIds.has(pad.id));
  const editMode = useUiStore((s) => s.editMode);
  const duplicatePad = useProjectStore((s) => s.duplicatePad);
  const deletePad = useProjectStore((s) => s.deletePad);
  const { gestureHandlers } = usePadGesture(pad);
  const isVolumeTransitioning = usePlaybackStore((s) => s.volumeTransitioningPadIds.has(pad.id));
  const liveVolume = usePlaybackStore((s) => s.padVolumes[pad.id] ?? 1.0);
  const [showVolumeDisplay, setShowVolumeDisplay] = useState(false);
  const [volumeExiting, setVolumeExiting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
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

  // 3D tilt — disabled in edit mode, during drag, and in fade mode
  const tiltEnabled = !editMode && !isSortableDragging && fadeVisual === null;
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

  const layerCount = pad.layers.length;

  const fadeHandlers = useMemo(() => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      onFadeTap?.(pad.id);
    },
  }), [onFadeTap, pad.id]);

  const fadeVisualClass = useMemo(() => {
    switch (fadeVisual) {
      case "crossfade-out":   return "border-amber-400";
      case "crossfade-in":    return "border-emerald-400";
      case "selected-out":    return "border-amber-500 ring-2 ring-amber-500";
      case "selected-in":     return "border-emerald-500 ring-2 ring-emerald-500";
      case "invalid":         return "opacity-40 pointer-events-none";
      default:                return null;
    }
  }, [fadeVisual]);

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
      >
        {/* Playing pulse ring — sibling of the tilt wrapper, outside overflow-hidden button */}
        <AnimatePresence>
          {isPlaying && !editMode && (
            <motion.div
              key="pulse"
              className="absolute -inset-1 rounded-xl pointer-events-none border-4 border-white/60 z-10"
              animate={{ opacity: [0.3, 0.8, 0.3] }}
              transition={{ repeat: Infinity, duration: 1.2, ease: "easeInOut" }}
              exit={{ opacity: 0 }}
            />
          )}
        </AnimatePresence>
        <motion.div
          className="w-full h-full"
          style={{ rotateX: tiltEnabled ? rotateX : 0, rotateY: tiltEnabled ? rotateY : 0, transformPerspective: 600, transformStyle: 'preserve-3d' }}
          whileTap={!editMode && fadeVisual === null ? { scale: 0.95 } : undefined}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onPointerDown={!editMode ? handleWrapperPointerDown : undefined}
        >
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
                {...(fadeVisual !== null ? fadeHandlers : gestureHandlers)}
                className={cn(
                  "relative w-full h-full rounded-xl overflow-hidden",
                  "flex items-center justify-center p-2",
                  "bg-card text-card-foreground",
                  "shadow-[3px_3px_0px_rgba(0,0,0,0.3)]",
                  "text-sm font-semibold text-center select-none",
                  fadeVisual !== null
                    ? cn("border-2 cursor-pointer", fadeVisualClass, fadeVisual !== "invalid" && "hover:brightness-110")
                    : cn(
                        "border-2 transition-all cursor-pointer",
                        "hover:brightness-110",
                        isPlaying
                          ? "border-yellow-400 drop-shadow-[0_5px_0px_#FACC15]"
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
              </button>
            </div>

            {/* Back face — edit overlay */}
            <div
              className="absolute inset-0 rounded-xl overflow-hidden bg-card flex flex-col items-center justify-between p-1.5 [backface-visibility:hidden]"
              style={{ transform: 'rotateY(180deg)', backgroundColor: pad.color ?? undefined }}
              aria-hidden={!editMode || undefined}
            >
              {/* Dark overlay for readability — sits on top of the pad color */}
              <div className="absolute inset-0 bg-black/60" />
              <div className="relative z-10 flex flex-col items-center gap-0.5">
                <span className="text-white text-xs font-semibold line-clamp-2 text-center leading-tight">
                  {pad.name}
                </span>
                <span className="text-white/70 text-xs">
                  {layerCount} {layerCount === 1 ? "layer" : "layers"}
                </span>
              </div>
              <div className="relative z-10 flex gap-1">
                <button
                  type="button"
                  aria-label="Edit pad"
                  onClick={(e) => { e.stopPropagation(); onEditClick?.(pad); }}
                  className="p-1 rounded bg-white/20 hover:bg-white/40 transition-colors"
                >
                  <HugeiconsIcon icon={PencilEdit01Icon} size={14} className="text-white" />
                </button>
                <button
                  type="button"
                  aria-label="Duplicate pad"
                  onClick={(e) => { e.stopPropagation(); duplicatePad(sceneId, pad.id); }}
                  className="p-1 rounded bg-white/20 hover:bg-white/40 transition-colors"
                >
                  <HugeiconsIcon icon={Copy01Icon} size={14} className="text-white" />
                </button>
                <button
                  type="button"
                  aria-label="Delete pad"
                  onClick={(e) => { e.stopPropagation(); setConfirmingDelete(true); }}
                  className="p-1 rounded bg-white/20 hover:bg-red-500/80 transition-colors"
                >
                  <HugeiconsIcon icon={Delete02Icon} size={14} className="text-white" />
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      </div>

      <ConfirmDeletePadDialog
        isOpen={confirmingDelete}
        padName={pad.name}
        onConfirm={() => {
          setConfirmingDelete(false);
          stopPad(pad);
          deletePad(sceneId, pad.id);
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
    </>
  );
});
