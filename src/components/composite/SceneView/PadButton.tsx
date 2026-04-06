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
  onEditClick?: (pad: Pad) => void;
  fadeVisual?: PadFadeVisual;
  onFadeTap?: (padId: string) => void;
}

export const PadButton = memo(function PadButton({ pad, sceneId, onEditClick, fadeVisual = null, onFadeTap }: PadButtonProps) {
  const isPlaying = usePlaybackStore((s) => s.playingPadIds.has(pad.id));
  const editMode = useUiStore((s) => s.editMode);
  const duplicatePad = useProjectStore((s) => s.duplicatePad);
  const deletePad = useProjectStore((s) => s.deletePad);
  const { gestureHandlers } = usePadGesture(pad);
  const isVolumeTransitioning = usePlaybackStore((s) => s.volumeTransitioningPadIds.has(pad.id));
  const liveVolume = usePlaybackStore((s) => s.padVolumes[pad.id] ?? 1.0);
  const [showVolumeDisplay, setShowVolumeDisplay] = useState(false);
  const [frozenVolume, setFrozenVolume] = useState(liveVolume);
  const [progress, setProgress] = useState(0);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const rafRef = useRef<number | null>(null);
  const volumeHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the last volume seen while transitioning; read by effect on transition end
  const lastTransitionVolumeRef = useRef(liveVolume);

  // Update during render while actively transitioning — before the store resets to 1.0
  if (isVolumeTransitioning) {
    lastTransitionVolumeRef.current = liveVolume;
  }

  // During transition show the live value; when transition ends, show the snapshot for the linger period
  const displayVolume = isVolumeTransitioning ? liveVolume : frozenVolume;

  useEffect(() => {
    if (isVolumeTransitioning) {
      if (volumeHideTimerRef.current !== null) {
        clearTimeout(volumeHideTimerRef.current);
        volumeHideTimerRef.current = null;
      }
      setShowVolumeDisplay(true);
    } else {
      setFrozenVolume(lastTransitionVolumeRef.current);
      volumeHideTimerRef.current = setTimeout(() => {
        setShowVolumeDisplay(false);
        volumeHideTimerRef.current = null;
      }, 670);
    }
    return () => {
      if (volumeHideTimerRef.current !== null) {
        clearTimeout(volumeHideTimerRef.current);
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
        if (p !== null) setProgress(p);
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

  const fadeHandlers = {
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      onFadeTap?.(pad.id);
    },
  };

  const fadeVisualClass = (() => {
    switch (fadeVisual) {
      case "crossfade-out":   return "border-amber-400";
      case "crossfade-in":    return "border-emerald-400";
      case "selected-out":    return "border-amber-500 ring-2 ring-amber-500";
      case "selected-in":     return "border-emerald-500 ring-2 ring-emerald-500";
      case "invalid":         return "opacity-40 pointer-events-none";
      default:                return null;
    }
  })();

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
              className="absolute inset-0 rounded-xl pointer-events-none border-2 border-white/60 z-10"
              animate={{ opacity: [0.3, 0.8, 0.3] }}
              transition={{ repeat: Infinity, duration: 1.2, ease: "easeInOut" }}
              exit={{ opacity: 0 }}
            />
          )}
        </AnimatePresence>
        <motion.div
          className="w-full h-full"
          style={{ rotateX: tiltEnabled ? rotateX : 0, rotateY: tiltEnabled ? rotateY : 0, transformPerspective: 600 }}
          whileTap={!editMode && fadeVisual === null ? { scale: 0.95 } : undefined}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onPointerDown={!editMode ? handleWrapperPointerDown : undefined}
        >
        <button
          {...(editMode
            ? {}
            : fadeVisual !== null
              ? fadeHandlers
              : gestureHandlers
          )}
          className={cn(
            "relative w-full h-full rounded-xl overflow-hidden",
            "flex items-center justify-center p-2",
            "bg-card text-card-foreground",
            "shadow-[3px_3px_0px_rgba(0,0,0,0.3)]",
            "text-sm font-semibold text-center select-none",
            editMode
              ? "border-2 border-dashed border-foreground/50 cursor-default"
              : fadeVisual !== null
                ? cn("border-2 cursor-pointer", fadeVisualClass, fadeVisual !== "invalid" && "hover:brightness-110")
                : cn(
                    "border-2 transition-all cursor-pointer",
                    "hover:brightness-110",
                    isPlaying
                      ? "border-black drop-shadow-[0_5px_0px_rgba(0,0,0,1)]"
                      : "border-black/20"
                  )
          )}
          style={{ backgroundColor: pad.color ?? undefined }}
        >
          {/* Volume transition bar — shows for all automated and gesture-driven volume changes */}
          {!editMode && showVolumeDisplay && (
            <div
              className="absolute bottom-0 left-0 right-0 pointer-events-none bg-yellow-500 border-t-2 border-black"
              style={{ height: `${displayVolume * 100}%` }}
            />
          )}
          {/* Playback progress — normal mode only; renders on top of fill bar, slightly transparent */}
          {!editMode && isPlaying && (
            <div
              className="absolute top-0 left-0 bottom-0 pointer-events-none bg-black/35"
              style={{ width: `${progress * 100}%` }}
            />
          )}

          {/* Edit mode overlay */}
          {editMode && (
            <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-between p-1.5 pointer-events-none">
              <div className="flex flex-col items-center gap-0.5 pointer-events-none">
                <span className="text-white text-xs font-semibold line-clamp-2 text-center leading-tight">
                  {pad.name}
                </span>
                <span className="text-white/70 text-xs">
                  {layerCount} {layerCount === 1 ? "layer" : "layers"}
                </span>
              </div>
              <div className="flex gap-1 pointer-events-auto">
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
          )}

          {/* Pad name + optional volume — normal mode */}
          {!editMode && (
            <div className="relative z-10 flex flex-col items-center gap-0.5">
              <span className="line-clamp-2 break-words leading-tight text-center">{pad.name}</span>
              {showVolumeDisplay && (
                <span className="text-xs font-bold tabular-nums">
                  {Math.round(displayVolume * 100)}%
                </span>
              )}
            </div>
          )}
        </button>
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
