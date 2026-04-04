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

interface PadButtonProps {
  pad: Pad;
  sceneId: string;
  onEditClick?: () => void;
}

export function PadButton({ pad, sceneId, onEditClick }: PadButtonProps) {
  const isPlaying = usePlaybackStore((s) => s.playingPadIds.includes(pad.id));
  const editMode = useUiStore((s) => s.editMode);
  const duplicatePad = useProjectStore((s) => s.duplicatePad);
  const deletePad = useProjectStore((s) => s.deletePad);
  const { gestureHandlers, fillVolume, isDragging } = usePadGesture(pad);
  const [progress, setProgress] = useState(0);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const rafRef = useRef<number | null>(null);

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

  return (
    <>
      <button
        ref={setNodeRef}
        {...(editMode ? { ...attributes, ...listeners } : gestureHandlers)}
        className={cn(
          "relative w-full h-full rounded-xl overflow-hidden",
          "flex items-center justify-center p-2",
          "bg-card text-card-foreground",
          "shadow-[3px_3px_0px_rgba(0,0,0,0.25)]",
          "text-sm font-semibold text-center select-none",
          isSortableDragging && "opacity-50",
          editMode
            ? "border-2 border-dashed border-foreground/50 cursor-default"
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
        {/* Playback progress — normal mode only */}
        {!editMode && isPlaying && (
          <div
            className="absolute top-0 left-0 bottom-0 pointer-events-none bg-black/35"
            style={{ width: `${progress * 100}%` }}
          />
        )}
        {/* Volume fill — normal mode only */}
        {!editMode && fillVolume !== null && (
          <div
            className={cn(
              "absolute bottom-0 left-0 right-0 pointer-events-none bg-yellow-500 border-t-2 border-black",
              !isDragging && "transition-[height] duration-150 ease-out"
            )}
            style={{ height: `${fillVolume * 100}%` }}
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

        {/* Pad name / volume percentage — normal mode */}
        {!editMode && (
          <span className="relative z-10 line-clamp-3 break-words leading-tight">
            {fillVolume !== null ? `${Math.round(fillVolume * 100)}%` : pad.name}
          </span>
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
