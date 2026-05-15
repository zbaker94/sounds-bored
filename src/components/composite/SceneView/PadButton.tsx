import React, { memo, useCallback, useMemo, useRef, useEffect, useState } from "react";
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from "motion/react";
import type { Pad } from "@/lib/schemas";
import { getPadMapForScenes } from "@/lib/padUtils";
import { cn } from "@/lib/utils";
import { useProjectStore } from "@/state/projectStore";
import { usePlaybackStore } from "@/state/playbackStore";
import { useUiStore, selectHasOpenOverlay } from "@/state/uiStore";
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { usePadGesture } from "@/hooks/usePadGesture";
import { usePadVolumeDisplay } from "@/hooks/usePadVolumeDisplay";
import type { PadSoundState } from "@/lib/project.reconcile";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import { PadBackFace } from "./PadBackFace";
import { PadButtonProgress } from "./PadButtonProgress";
import { PadButtonFadeOverlay } from "./PadButtonFadeOverlay";
import { PadFadePopoverContent } from "./PadFadePopoverContent";
import { PadSoundMetadataDisplay } from "./PadSoundMetadataDisplay";
import { PadCoverArt } from "./PadCoverArt";
import { usePadDisplayStore } from "@/state/padDisplayStore";
import { PAD_FLIP_DURATION_MS, PAD_FLIP_EASE, PAD_STAGGER_MS } from "./padAnimations";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface PadButtonProps {
  padId: string;
  sceneId: string;
  index?: number;
  /** Sound health derived from the pad's layers vs. the current missing-sound set. See PadSoundState for semantics. */
  padSoundState: PadSoundState;
}

// Overdamped spring config: settles in ~5 frames instead of 22+, reducing the
// RAF tail while preserving the smooth tilt feel.
const TILT_SPRING = { stiffness: 1200, damping: 80 } as const;

/** 3D tilt driven by mouse position. Snaps to zero when disabled. */
function usePadTilt(enabled: boolean) {
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const rotateX = useSpring(useTransform(mouseY, [-0.5, 0.5], [4, -4]), TILT_SPRING);
  const rotateY = useSpring(useTransform(mouseX, [-0.5, 0.5], [-4, 4]), TILT_SPRING);
  useEffect(() => {
    if (!enabled) {
      mouseX.set(0);
      mouseY.set(0);
      rotateX.set(0);
      rotateY.set(0);
    }
  }, [enabled, mouseX, mouseY, rotateX, rotateY]);
  return { mouseX, mouseY, rotateX, rotateY };
}

/** Keeps the back face mounted until the flip-out animation finishes. */
function usePadBackFaceMount(isFlipped: boolean): boolean {
  const [showBackFace, setShowBackFace] = useState(isFlipped);
  const unmountRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (unmountRef.current) {
      clearTimeout(unmountRef.current);
      unmountRef.current = null;
    }
    if (isFlipped) {
      setShowBackFace(true);
    } else {
      unmountRef.current = setTimeout(() => {
        setShowBackFace(false);
        unmountRef.current = null;
      }, PAD_FLIP_DURATION_MS + 50);
    }
    return () => {
      if (unmountRef.current) {
        clearTimeout(unmountRef.current);
        unmountRef.current = null;
      }
    };
  }, [isFlipped]);
  return showBackFace;
}

/** Clears editingPadId when the user clicks outside the pad's container. */
function useClickOutsideToDeselect(
  padId: string,
  editingPadId: string | null,
  editMode: boolean,
  containerRef: React.RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    if (editingPadId !== padId || editMode) return;
    function handlePointerDown(e: PointerEvent) {
      if (selectHasOpenOverlay(useUiStore.getState())) return;
      if (!containerRef.current?.contains(e.target as Node)) {
        useUiStore.getState().setEditingPadId(null);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown, { capture: true });
    return () => document.removeEventListener("pointerdown", handlePointerDown, { capture: true });
  }, [editingPadId, padId, editMode, containerRef]);
}

function getPadButtonClassName(
  isUnplayable: boolean,
  multiFadeActive: boolean,
  multiFadeSelectionClass: string | null,
  isPlaying: boolean,
): string {
  const base = cn(
    "relative w-full h-full rounded-xl overflow-hidden",
    "flex items-center justify-center p-2",
    "bg-card text-card-foreground",
    "shadow-[3px_3px_0px_rgba(0,0,0,0.3)]",
    "text-sm font-semibold text-center select-none",
  );
  if (isUnplayable && !multiFadeActive) {
    return cn(base, "opacity-40 border-2 border-black/20 cursor-default");
  }
  if (multiFadeSelectionClass) {
    return cn(base, "border-2 cursor-pointer", multiFadeSelectionClass);
  }
  return cn(
    base,
    "border-2 transition-all cursor-pointer hover:brightness-110",
    isPlaying ? "border-yellow-400" : "border-black/20",
  );
}

interface PadFrontFaceProps {
  pad: Pad;
  sceneId: string;
  isPlaying: boolean;
  isFadingOut: boolean;
  isFlipped: boolean;
  isUnplayable: boolean;
  multiFadeActive: boolean;
  multiFadeHandlers: { onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => void };
  multiFadeSelectionClass: string | null;
  gestureHandlers: ReturnType<typeof usePadGesture>["gestureHandlers"];
  showVolumeDisplay: boolean;
  volumeExiting: boolean;
  displayVolume: number;
  isPopoverOpen: boolean;
  padSoundState: PadSoundState;
}

function PadFrontFace({
  pad, sceneId, isPlaying, isFadingOut, isFlipped, isUnplayable,
  multiFadeActive, multiFadeHandlers, multiFadeSelectionClass, gestureHandlers,
  showVolumeDisplay, volumeExiting, displayVolume, isPopoverOpen, padSoundState,
}: PadFrontFaceProps) {
  const currentVoice = usePadDisplayStore((s) => s.currentVoice[pad.id] ?? null);
  const hasCoverArt = !!currentVoice?.coverArtDataUrl;
  // Memoized so Immer reference churn on pad.layers (any project mutation) doesn't
  // create a new array reference when layer IDs are unchanged — PadButtonProgress.memo
  // can then short-circuit via reference equality instead of element-wise walk.
  const layerIds = useMemo(() => pad.layers.map((l) => l.id), [pad.layers]);

  return (
    <div className="absolute inset-0 [backface-visibility:hidden]" aria-hidden={isFlipped || undefined}>
      <button
        aria-label={pad.name}
        {...(multiFadeActive ? multiFadeHandlers : (isUnplayable ? {} : gestureHandlers))}
        className={getPadButtonClassName(isUnplayable, multiFadeActive, multiFadeSelectionClass, isPlaying)}
        style={{
          backgroundColor: isPlaying ? (hasCoverArt ? "rgba(0,0,0,0.6)" : "#000") : (pad.color ?? undefined),
          transition: "background-color 0.7s ease",
          color: isPlaying ? "#fff" : undefined,
        }}
      >
        <PadCoverArt padId={pad.id} />
        {/* Volume transition bar — fades in on enter, lingers 450ms, then fades out */}
        {showVolumeDisplay && (
          <motion.div
            data-testid="volume-drag-bar"
            className="absolute bottom-0 left-0 right-0 pointer-events-none bg-yellow-500 border-t-2 border-black"
            style={{ height: `${displayVolume * 100}%` }}
            initial={{ opacity: 0 }}
            animate={{ opacity: volumeExiting ? 0 : 1 }}
            transition={{ duration: volumeExiting ? 0.22 : 0.15 }}
          />
        )}
        {/* Isolated so 60Hz RAF ticks do not re-render PadButton. */}
        <PadButtonProgress padId={pad.id} layerIds={layerIds} />
        {/* Pad name / sound metadata — crossfade between them via AnimatePresence */}
        <div className="relative z-10 flex flex-col items-center gap-0.5">
          <AnimatePresence mode="wait">
            {currentVoice != null ? (
              <motion.div
                key={`voice-${currentVoice.seq}`}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className="w-full flex flex-col items-center"
              >
                <PadSoundMetadataDisplay padId={pad.id} />
              </motion.div>
            ) : (
              <motion.div
                key="pad-name"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="w-full flex flex-col items-center"
              >
                <span data-testid="pad-name" className="line-clamp-2 break-words leading-tight text-center">{pad.name}</span>
              </motion.div>
            )}
          </AnimatePresence>
          {/* Volume display — independent of the pad name / metadata crossfade */}
          {showVolumeDisplay && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: volumeExiting ? 0 : 1, height: volumeExiting ? 0 : "auto" }}
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
        {/* Amber line during fade-out — uses persisted target, no live subscription needed */}
        {isFadingOut && (
          <div
            className="absolute left-0 right-0 h-px bg-amber-400/80 pointer-events-none z-10"
            style={{ bottom: `${pad.fadeTargetVol ?? 0}%` }}
          />
        )}
        {/* Popover content isolated so pointer-move updates only re-render this subtree */}
        {isPopoverOpen && <PadFadePopoverContent pad={pad} sceneId={sceneId} />}
        {/* Multi-fade slider overlay — isolated in PadButtonFadeOverlay with its own store subscriptions */}
        <PadButtonFadeOverlay pad={pad} sceneId={sceneId} />
      </button>
      {padSoundState === "partial" && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span data-testid="pad-partial-warning" className="absolute bottom-1 right-1 z-20 pointer-events-auto">
              <HugeiconsIcon icon={Alert02Icon} size={16} className="text-amber-400 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]" />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">
            Some assigned sounds are missing from the library. Open pad settings to review.
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

interface PadButtonContentProps {
  pad: Pad;
  sceneId: string;
  index: number;
  padSoundState: PadSoundState;
}

const PadButtonContent = memo(function PadButtonContent({ pad, sceneId, index, padSoundState }: PadButtonContentProps) {
  // isPlaying drives styling (border, background, drop-shadow, pulse ring).
  // Heavy RAF-driven subscriptions (activeLayers, layerProgress) live in PadButtonProgress.
  const isPlaying = usePlaybackStore((s) => s.playingPadIds.has(pad.id));
  const isFadingOut = usePlaybackStore((s) => s.fadingOutPadIds.has(pad.id));

  const editMode = useUiStore((s) => s.editMode);
  const toggleEditMode = useUiStore((s) => s.toggleEditMode);
  const editingPadId = useUiStore((s) => s.editingPadId);
  const setEditingPadId = useUiStore((s) => s.setEditingPadId);
  const isPopoverOpen = useUiStore((s) => s.fadePopoverPadId === pad.id);
  const setFadePopoverPadId = useUiStore((s) => s.setFadePopoverPadId);
  const { gestureHandlers, isDragging, dragVolume } = usePadGesture(pad);

  // Volume display state is fully managed by the hook — PadButton only consumes the result.
  const { showVolumeDisplay, volumeExiting, displayVolume } = usePadVolumeDisplay(
    pad.id,
    isDragging,
    dragVolume,
    (pad.volume ?? 100) / 100,
  );

  // Multi-fade mode derived state
  const multiFadeActive = useMultiFadeStore((s) => s.active);
  const isMultiFadeSelected = useMultiFadeStore((s) => s.active && s.selectedPads.has(pad.id));
  const toggleMultiFadePad = useMultiFadeStore((s) => s.toggleMultiFadePad);

  const isFlipped = editMode || editingPadId === pad.id;

  const padWrapperRef = useRef<HTMLDivElement | null>(null);

  useClickOutsideToDeselect(pad.id, editingPadId, editMode, padWrapperRef);

  // Clear hover state if this pad unmounts while it owns the hover slot.
  // editingPadId is intentionally NOT cleared here: React 19 StrictMode runs
  // this cleanup immediately after mount (before the first paint), which would
  // erase the editingPadId just set by handleAddPad and prevent the new pad from
  // flipping to its back face. The click-outside handler (above) covers all
  // realistic unmount paths (page nav, scene switch, project close) because each
  // is preceded by a pointerdown that fires before the component unmounts.
  useEffect(() => {
    return () => {
      const { hoveredPadId, setHoveredPadId } = useUiStore.getState();
      if (hoveredPadId === pad.id) setHoveredPadId(null);
    };
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
  const { mouseX, mouseY, rotateX, rotateY } = usePadTilt(tiltEnabled);

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

  // Gate PadBackFace mount behind a delayed-unmount state so the flip-out animation
  // can finish before the back face's store subscriptions (RAF-driven at 60fps)
  // are torn down. Avoids paying the subscription cost on front-facing pads.
  const showBackFace = usePadBackFaceMount(isFlipped);

  const isUnplayable = padSoundState === "disabled";

  // Exit whichever flip state is currently active without enabling the other.
  // If global editMode is on, toggle it off; otherwise clear the individual editingPadId.
  // Using toggleEditMode here when editMode=false would turn it ON, which triggers the
  // useMultiFadeSideEffects cancel guard and immediately aborts multi-fade.
  const handleMultiFade = useCallback(() => {
    if (editMode) toggleEditMode();
    else setEditingPadId(null);
  }, [editMode, toggleEditMode, setEditingPadId]);

  // Multi-fade mode: left-click toggles pad selection instead of triggering playback.
  // Read liveVolume imperatively to avoid recomputing on every RAF frame during a fade.
  const multiFadeHandlers = useMemo(() => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const currentVol = isPlaying ? (pad.volume ?? 100) : 0;
      toggleMultiFadePad(pad.id, currentVol, pad.fadeTargetVol ?? 0);
    },
  }), [toggleMultiFadePad, pad.id, pad.volume, pad.fadeTargetVol, isPlaying]);

  // Right-click flips the pad to its back face (individually).
  // isUnplayable is intentionally excluded — disabled pads should still be right-click-flippable
  // so the user can assign sounds to them. The HTML disabled attribute is also removed from the
  // front-face button so Chromium does not swallow the contextmenu event before it bubbles here.
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (editMode || multiFadeActive) return;
    setEditingPadId(editingPadId === pad.id ? null : pad.id);
  }, [editMode, multiFadeActive, editingPadId, pad.id, setEditingPadId]);

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
      onMouseLeave={() => {
        useUiStore.getState().setHoveredPadId(null);
        setFadePopoverPadId(null);
      }}
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
              data-testid="pulse-ring"
              className="absolute -inset-1 rounded-xl pointer-events-none z-10"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.2, ease: "easeOut" } }}
              transition={{ duration: 0.15 }}
            >
              {/* CSS animation — zero JS overhead vs. Motion keyframe loop */}
              <div
                className="absolute inset-0 rounded-xl border-4 border-white/60"
                style={{ animation: "pad-pulse 1.2s ease-in-out infinite" }}
              />
            </motion.div>
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
          <PadFrontFace
            pad={pad}
            sceneId={sceneId}
            isPlaying={isPlaying}
            isFadingOut={isFadingOut}
            isFlipped={isFlipped}
            isUnplayable={isUnplayable}
            multiFadeActive={multiFadeActive}
            multiFadeHandlers={multiFadeHandlers}
            multiFadeSelectionClass={multiFadeSelectionClass}
            gestureHandlers={gestureHandlers}
            showVolumeDisplay={showVolumeDisplay}
            volumeExiting={volumeExiting}
            displayVolume={displayVolume}
            isPopoverOpen={isPopoverOpen}
            padSoundState={padSoundState}
          />

          {/* Back face */}
          <div
            className="absolute inset-0 rounded-xl overflow-hidden bg-card [backface-visibility:hidden]"
            style={{ transform: 'rotateY(180deg)', backgroundColor: pad.color ?? undefined }}
            aria-hidden={!isFlipped || undefined}
          >
            {showBackFace && <PadBackFace pad={pad} sceneId={sceneId} onMultiFade={handleMultiFade} />}
          </div>
        </div>
      </motion.div>
    </div>
  );
});

/**
 * Selects the pad from the project store by ID and renders PadButtonContent.
 * `padId` and `sceneId` are stable string props; `index` is a number that changes
 * only on reorder (intentionally re-renders for stagger animation). `padSoundState`
 * is a string union so reference equality equals value equality — React.memo on
 * these primitives prevents cascade re-renders from SceneView's displayPads.map.
 * The selector resolves the pad via getPadMapForScenes, an O(1) cached Map lookup.
 * The Map is rebuilt only when the `scenes` array reference changes, so store updates
 * that don't touch scenes (isDirty, folderPath, etc.) return the same Map and the same
 * pad reference — Zustand's === check then skips the re-render.
 *
 * Returning null when pad is not found (deleted or not yet committed) fully unmounts
 * PadButtonContent, resetting all local state (tilt spring, volume display timer).
 * SceneView removes the PadButton from the DOM in its next render cycle.
 */
export const PadButton = memo(function PadButton({ padId, sceneId, index = 0, padSoundState }: PadButtonProps) {
  const pad = useProjectStore(
    (s) => getPadMapForScenes(s.project?.scenes ?? null).get(padId) ?? null,
  );
  if (!pad) return null;
  return <PadButtonContent pad={pad} sceneId={sceneId} index={index} padSoundState={padSoundState} />;
});
