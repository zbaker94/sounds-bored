import { useState, useMemo } from "react";
import type { Pad } from "@/lib/schemas";
import { useProjectStore } from "@/state/projectStore";
import { usePlaybackStore } from "@/state/playbackStore";
import { useUiStore, OVERLAY_ID } from "@/state/uiStore";
import { PadButton } from "./PadButton";
import { PadConfigDrawer } from "../PadConfigDrawer/PadConfigDrawer";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add02Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  LayersLogoIcon,
  VolumeHighIcon,
  ShuffleIcon,
} from "@hugeicons/core-free-icons";
import { useFadeMode } from "@/hooks/useFadeMode";
import { useHotkeys } from "react-hotkeys-hook";
import { cn, modKey } from "@/lib/utils";
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";

const PADS_PER_PAGE = 12;

export function SceneView() {
  const activeScene = useProjectStore((s) =>
    s.project?.scenes.find((sc) => sc.id === s.activeSceneId) ?? null,
  );
  const openOverlay = useUiStore((s) => s.openOverlay);
  const [pageByScene, setPageByScene] = useState<Record<string, number>>({});
  const [editingPad, setEditingPad] = useState<Pad | null>(null);

  const addScene = useProjectStore((s) => s.addScene);
  const reorderPads = useProjectStore((s) => s.reorderPads);
  const editMode = useUiStore((s) => s.editMode);
  const [isDraggingPad, setIsDraggingPad] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  const page = activeScene ? (pageByScene[activeScene.id] ?? 0) : 0;

  function setPage(updater: (prev: number) => number) {
    if (!activeScene) return;
    setPageByScene((prev) => ({
      ...prev,
      [activeScene.id]: updater(prev[activeScene.id] ?? 0),
    }));
  }

  const pads = activeScene?.pads ?? [];
  const fadeMode = useFadeMode(pads);
  const playingPadIds = usePlaybackStore((s) => s.playingPadIds);
  const totalPages = Math.max(1, Math.ceil(pads.length / PADS_PER_PAGE));
  const safePage = Math.min(page, totalPages - 1);
  const isLastPage = safePage === totalPages - 1;

  function handleDragStart(_event: DragStartEvent) {
    setIsDraggingPad(true);
  }

  function handleDragEnd(event: DragEndEvent) {
    setIsDraggingPad(false);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = pads.findIndex((p) => p.id === active.id);
    const toIndex = pads.findIndex((p) => p.id === over.id);
    if (fromIndex !== -1 && toIndex !== -1 && activeScene) {
      reorderPads(activeScene.id, fromIndex, toIndex);
      setPage(() => Math.floor(toIndex / PADS_PER_PAGE));
    }
  }

  const sortableItems = useMemo(() => pads.map((p) => p.id), [pads]);

  // Hooks must be called unconditionally — before any early returns.
  useHotkeys(
    "shift+left",
    () => {
      if (safePage > 0) setPage((p) => p - 1);
      else setPage(() => totalPages - 1);
    },
    { preventDefault: true },
  );
  useHotkeys(
    "shift+right",
    () => {
      if (!isLastPage) setPage((p) => p + 1);
      else setPage(() => 0);
    },
    { preventDefault: true },
  );

  if (!activeScene) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <Empty className="flex-1 max-w-md max-h-60 border-none corrugated-background shadowed rounded-xl ">
          <EmptyHeader className="text-white">
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={LayersLogoIcon} />
            </EmptyMedia>
            <EmptyTitle>No scenes yet</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Button
              onClick={() => addScene()}
              className="gap-2 "
              variant="secondary"
            >
              <HugeiconsIcon icon={Add02Icon} size={16} />
              Add Scene
              <Kbd className="ml-1">{modKey} + N</Kbd>
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  if (pads.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <button
          onClick={() => openOverlay(OVERLAY_ID.PAD_CONFIG_DRAWER, "dialog")}
          className="aspect-square w-40 rounded-xl border-2 border-dashed border-foreground/40 bg-card/80 flex items-center justify-center hover:border-foreground/70 hover:bg-card transition-all cursor-pointer shadow-[3px_3px_0px_rgba(0,0,0,0.3)]"
          aria-label="Add pad"
        >
          <HugeiconsIcon
            icon={Add02Icon}
            size={48}
            className="text-foreground/60"
          />
        </button>
        <PadConfigDrawer sceneId={activeScene.id} />
      </div>
    );
  }

  const pagePads = pads.slice(
    safePage * PADS_PER_PAGE,
    (safePage + 1) * PADS_PER_PAGE,
  );

  const displayPads = isDraggingPad ? pads : pagePads;

  return (
    <div className="flex-1 flex flex-col min-h-0 p-4 gap-4">
      {/* Fade toolbar — hidden in edit mode */}
      {!editMode && (
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant={fadeMode.mode === "fade" ? "default" : "ghost"}
            size="sm"
            onClick={() => fadeMode.mode === "fade" ? fadeMode.cancel() : fadeMode.enterFade()}
            disabled={editMode}
            aria-label="Fade pad"
          >
            <HugeiconsIcon icon={VolumeHighIcon} size={16} />
            Fade
            <Kbd className="ml-1">F</Kbd>
          </Button>
          <Button
            variant={fadeMode.mode === "crossfade" ? "default" : "ghost"}
            size="sm"
            onClick={() => {
              if (fadeMode.mode === "crossfade") {
                if (fadeMode.canExecute) fadeMode.execute();
                else fadeMode.cancel();
              } else {
                fadeMode.enterCrossfade();
              }
            }}
            disabled={editMode || (fadeMode.mode !== "crossfade" && playingPadIds.length === 0)}
            aria-label="Crossfade pads"
          >
            <HugeiconsIcon icon={ShuffleIcon} size={16} />
            Crossfade
            <Kbd className="ml-1">X</Kbd>
          </Button>
          {fadeMode.statusLabel && (
            <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-black/50 text-white border border-white/20">
              {fadeMode.statusLabel}
            </span>
          )}
        </div>
      )}
      <DndContext
        sensors={editMode ? sensors : []}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        autoScroll={isDraggingPad}
      >
        <SortableContext items={sortableItems} strategy={rectSortingStrategy}>
          <div className={cn(
            "flex-1 min-h-0 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 auto-rows-fr gap-3",
            isDraggingPad && "overflow-y-auto",
          )}>
            {displayPads.map((pad) => (
              <PadButton
                key={pad.id}
                pad={pad}
                sceneId={activeScene.id}
                onEditClick={() => {
                  setEditingPad(pad);
                  openOverlay(OVERLAY_ID.PAD_CONFIG_DRAWER, "dialog");
                }}
                fadeVisual={fadeMode.getPadFadeVisual(pad.id)}
                onFadeTap={() => fadeMode.onPadTap(pad.id)}
              />
            ))}
            {isLastPage && !isDraggingPad && (
              <button
                onClick={() => openOverlay(OVERLAY_ID.PAD_CONFIG_DRAWER, "dialog")}
                className="w-full h-full rounded-xl border-2 border-dashed border-foreground/40 bg-card/80 flex items-center justify-center hover:border-foreground/70 hover:bg-card transition-all cursor-pointer shadow-[3px_3px_0px_rgba(0,0,0,0.3)]"
                aria-label="Add pad"
              >
                <HugeiconsIcon
                  icon={Add02Icon}
                  size={32}
                  className="text-foreground/60"
                />
              </button>
            )}
          </div>
        </SortableContext>
      </DndContext>

      {totalPages > 1 && !isDraggingPad && (
        <div className="flex items-center justify-center gap-3 shrink-0">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={safePage === 0}
            onClick={() => setPage((p) => p - 1)}
            aria-label="Previous page"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} size={16} />
          </Button>
          <span className="text-white tabular-nums [font-family:DeathLetter]">
            {safePage + 1} / {totalPages}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={isLastPage}
            onClick={() => setPage((p) => p + 1)}
            aria-label="Next page"
          >
            <HugeiconsIcon icon={ArrowRight01Icon} size={16} />
          </Button>
        </div>
      )}

      <PadConfigDrawer
        sceneId={activeScene.id}
        padId={editingPad?.id}
        initialConfig={
          editingPad
            ? {
                name: editingPad.name,
                layers: editingPad.layers,
                muteTargetPadIds: editingPad.muteTargetPadIds,
                muteGroupId: editingPad.muteGroupId,
                color: editingPad.color,
                icon: editingPad.icon,
                fadeDurationMs: editingPad.fadeDurationMs,
              }
            : undefined
        }
        onClose={() => setEditingPad(null)}
      />
    </div>
  );
}
