import React, { memo, useCallback, useMemo, useRef, useEffect } from "react";
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from "motion/react";
import type { Pad } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { usePlaybackStore } from "@/state/playbackStore";
import { useUiStore } from "@/state/uiStore";
import { useLibraryStore } from "@/state/libraryStore";
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { usePadGesture } from "@/hooks/usePadGesture";
import { usePadVolumeDisplay } from "@/hooks/usePadVolumeDisplay";
import { getPadSoundState } from "@/lib/projectSoundReconcile";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import { PadBackFace } from "./PadBackFace";
import { PadButtonProgress } from "./PadButtonProgress";
import { PadButtonFadeOverlay } from "./PadButtonFadeOverlay";
import { PAD_FLIP_DURATION_MS, PAD_FLIP_EASE, PAD_STAGGER_MS } from "./padAnimations";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface PadButtonProps {
  pad: Pad;
  sceneId: string;
  index?: number;
}

// Overdamped spring config: settles in ~5 frames instead of 22+, reducing the
// RAF tail while preserving the smooth tilt feel.
const TILT_SPRING = { stiffness: 1200, damping: 80 } as const;

export const PadButton = memo(function PadButton({ pad, sceneId, index = 0 }: PadButtonProps) {
  // isPlaying drives styling (border, background, drop-shadow, pulse ring).
  // Heavy RAF-driven subscriptions (activeLayers, layerProgress) live in PadButtonProgress.
  const isPlaying = usePlaybackStore((s) => s.playingPadIds.has(pad.id));

  const editMode = useUiStore((s) => s.editMode);
  const toggleEditMode = useUiStore((s) => s.toggleEditMode);
  const editingPadId = useUiStore((s) => s.editingPadId);
  const setEditingPadId = useUiStore((s) => s.setEditingPadId);
  const { gestureHandlers, isDragging, dragVolume } = usePadGesture(pad);

  // Volume display state is fully managed by the hook — PadButton only consumes the result.
  const { showVolumeDisplay, volumeExiting, displayVolume } = usePadVolumeDisplay(
    pad.id,
    isDragging,
    dragVolume,
  );

  // Multi-fade mode derived state
  const multiFadeActive = useMultiFadeStore((s) => s.active);
  const isMultiFadeSelected = useMultiFadeStore((s) => s.active && s.selectedPads.has(pad.id));
  const toggleMultiFadePad = useMultiFadeStore((s) => s.toggleMultiFadePad);

  const isFlipped = editMode || editingPadId === pad.id;

  const padWrapperRef = useRef<HTMLDivElement | null>(null);

  // Click-outside: when individually flipped (not global editMode), clicking outside clears editingPadId — unless an overlay is open.
  useEffect(() => {
    if (editingPadId !== pad.id || editMode) return;
    function handlePointerDown(e: PointerEvent) {
      if (useUiStore.getState().hasOpenOverlay()) return;
      if (!padWrapperRef.current?.contains(e.target as Node)) {
        useUiStore.getState().setEditingPadId(null);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown, { capture: true });
    return () => document.removeEventListener("pointerdown", handlePointerDown, { capture: true });
  }, [editingPadId, pad.id, editMode]);

  // Clear hover/editing state if this pad unmounts while it owns either slot
  useEffect(() => {
    return () => {
      const { hoveredPadId, editingPadId: currentEditingId, setHoveredPadId, setEditingPadId: clearId } = useUiStore.getState();
      if (hoveredPadId === pad.id) setHoveredPadId(null);
      if (currentEditingId === pad.id) clearId(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pad.id]);

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

  // 3D tilt — disabled when flipped, during drag, and in multi-fade mode
  const tiltEnabled = !isFlipped && !isSortableDragging && !multiFadeActive;
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const rotateX = useSpring(useTransform(mouseY, [-0.5, 0.5], [4, -4]), TILT_SPRING);
  const rotateY = useSpring(useTransform(mouseX, [-0.5, 0.5], [-4, 4]), TILT_SPRING);

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

  // Multi-fade mode: left-click toggles pad selection instead of triggering playback.
  // Read liveVolume imperatively to avoid recomputing on every RAF frame during a fade.
  const multiFadeHandlers = useMemo(() => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      toggleMultiFadePad(pad.id, pad.fadeLowVol ?? 0, pad.fadeHighVol ?? 1);
    },
  }), [toggleMultiFadePad, pad.id, pad.fadeLowVol, pad.fadeHighVol]);

  // Right-click flips the pad to its back face (individually).
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (editMode || multiFadeActive || isUnplayable) return;
    setEditingPadId(editingPadId === pad.id ? null : pad.id);
  }, [editMode, multiFadeActive, isUnplayable, editingPadId, pad.id, setEditingPadId]);

  // Selection ring styling for multi-fade selected pads
  const multiFadeSelectionClass = useMemo(() => {
    if (!isMultiFadeSelected) return null;
    return isPlaying
      ? "border-amber-400 ring-2 ring-amber-400"
      : "border-teal-400 ring-2 ring-teal-400";
  }, [isMultiFadeSelected, isPlaying]);

  const mergedRef = useCallback((el: HTMLDivElement | null) => {
    setNodeRef(el);
    padWrapperRef.current = el;
  }, [setNodeRef]);

  return (
    <div
      ref={mergedRef}
      style={dndStyle}
      className={cn("relative w-full h-full", isSortableDragging && "opacity-50")}
      {...(editMode ? attributes : {})}
      onMouseEnter={() => useUiStore.getState().setHoveredPadId(pad.id)}
      onMouseLeave={() => useUiStore.getState().setHoveredPadId(null)}
      onPointerDown={(e) => {
        // Only start a dnd-kit drag when the pointer-down did NOT originate on an
        // interactive child element (buttons inside PadBackFace on the back face).
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
        className={cn("w-full h-full", isPlaying && !isFlipped && "drop-shadow-[0_5px_0px_#FACC15]")}
        style={{ rotateX: tiltEnabled ? rotateX : 0, rotateY: tiltEnabled ? rotateY : 0, transformPerspective: 600, transformStyle: 'preserve-3d' }}
        whileTap={!isFlipped && !multiFadeActive ? { scale: 0.95 } : undefined}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onPointerDown={!isFlipped ? handleWrapperPointerDown : undefined}
      >
        {/* Playing pulse ring — inside tilt wrapper so it follows the 3D rotation */}
        <AnimatePresence>
          {isPlaying && !isFlipped && !multiFadeActive && (
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
        {/* Flip container — CSS transition instead of JS spring to avoid RAF overload
             when 12 pads flip simultaneously. GPU-composited; zero main-thread cost. */}
        <div
          className="relative w-full h-full"
          style={{
            transformStyle: 'preserve-3d',
            transform: `rotateY(${isFlipped ? 180 : 0}deg)`,
            transition: `transform ${PAD_FLIP_DURATION_MS}ms ${PAD_FLIP_EASE} ${index * PAD_STAGGER_MS}ms`,
          }}
        >
          {/* Front face — normal pad */}
          <div className="absolute inset-0 [backface-visibility:hidden]" aria-hidden={isFlipped || undefined}>
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
              {/* Playback progress — one bar per active layer, split vertically.
                  Isolated in PadButtonProgress so 60Hz RAF ticks do not re-render PadButton. */}
              <PadButtonProgress padId={pad.id} layers={pad.layers} />
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
              {/* Multi-fade slider overlay — isolated in PadButtonFadeOverlay with its own store subscriptions */}
              <PadButtonFadeOverlay pad={pad} sceneId={sceneId} />
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

          {/* Back face */}
          <div
            className="absolute inset-0 rounded-xl overflow-hidden bg-card [backface-visibility:hidden]"
            style={{ transform: 'rotateY(180deg)', backgroundColor: pad.color ?? undefined }}
            aria-hidden={!isFlipped || undefined}
          >
            <PadBackFace pad={pad} sceneId={sceneId} onMultiFade={toggleEditMode} />
          </div>
        </div>
      </motion.div>
    </div>
  );
});
