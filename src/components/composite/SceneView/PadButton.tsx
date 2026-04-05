import { useEffect, useMemo, useRef, useState } from "react";
import type { Pad } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { usePlaybackStore } from "@/state/playbackStore";
import { useProjectStore } from "@/state/projectStore";
import { useUiStore } from "@/state/uiStore";
import { usePadGesture } from "@/hooks/usePadGesture";
import { getPadProgress } from "@/lib/audio/padPlayer";
import { HugeiconsIcon } from "@hugeicons/react";
import { PencilEdit01Icon, Copy01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { ConfirmDeletePadDialog } from "@/components/modals/ConfirmDeletePadDialog";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { PadFadeVisual } from "@/hooks/useFadeMode";

interface PadButtonProps {
  pad: Pad;
  sceneId: string;
  onEditClick?: () => void;
  fadeVisual?: PadFadeVisual;
  onFadeTap?: () => void;
}

export function PadButton({ pad, sceneId, onEditClick, fadeVisual = null, onFadeTap }: PadButtonProps) {
  const isPlaying = usePlaybackStore((s) => s.playingPadIds.includes(pad.id));
  const editMode = useUiStore((s) => s.editMode);
  const duplicatePad = useProjectStore((s) => s.duplicatePad);
  const deletePad = useProjectStore((s) => s.deletePad);
  const { gestureHandlers } = usePadGesture(pad);
  const isVolumeTransitioning = usePlaybackStore((s) => s.volumeTransitioningPadIds.includes(pad.id));
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

  const combinedStyle = useMemo(
    () => ({
      ...(pad.color ? { backgroundColor: pad.color } : undefined),
      transform: CSS.Transform.toString(transform),
      transition,
    }),
    [pad.color, transform, transition],
  );

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
      onFadeTap?.();
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
      <button
        ref={setNodeRef}
        {...(editMode
          ? { ...attributes, ...listeners }
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
          isSortableDragging && "opacity-50",
          editMode
            ? "border-2 border-dashed border-foreground/50 cursor-default"
            : fadeVisual !== null
              ? cn("border-2 cursor-pointer", fadeVisualClass, fadeVisual !== "invalid" && "hover:brightness-110")
              : cn(
                  "border-2 transition-all cursor-pointer",
                  "hover:brightness-110 active:scale-95 active:shadow-none",
                  isPlaying
                    ? "border-black drop-shadow-[0_5px_0px_rgba(0,0,0,1)]"
                    : "border-black/20"
                )
        )}
        style={combinedStyle}
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
                onClick={(e) => { e.stopPropagation(); onEditClick?.(); }}
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

      <ConfirmDeletePadDialog
        isOpen={confirmingDelete}
        padName={pad.name}
        onConfirm={() => {
          setConfirmingDelete(false);
          deletePad(sceneId, pad.id);
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
    </>
  );
}
