import { useState, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { Pad } from "@/lib/schemas";
import { useProjectStore } from "@/state/projectStore";
import { useUiStore, OVERLAY_ID } from "@/state/uiStore";
import { PadButton } from "./PadButton";
import { MultiFadePill } from "./MultiFadePill";
import { PadConfigDrawer } from "../PadConfigDrawer/PadConfigDrawer";
import { useMultiFadeMode } from "@/hooks/useMultiFadeMode";
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
} from "@hugeicons/core-free-icons";
import { useMultiFadeStore } from "@/state/multiFadeStore";
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

const addPadButtonClass =
  "rounded-xl border-2 border-dashed border-foreground/40 bg-card/80 flex items-center justify-center hover:border-foreground/70 hover:bg-card transition-all cursor-pointer shadow-[3px_3px_0px_rgba(0,0,0,0.3)]";

export function SceneView() {
  // Register multi-fade hotkeys (escape=cancel, enter=execute)
  useMultiFadeMode();

  // Split into two selectors + useMemo so the O(n) .find() scan only runs when
  // scenes or activeSceneId actually changes. Notably, isDirty (toggled on every
  // auto-save) lives outside project, so it does not produce a new scenes reference
  // and won't trigger the scan — unlike a single inline selector which always scans.
  const scenes = useProjectStore((s) => s.project?.scenes ?? []);
  const activeSceneId = useProjectStore((s) => s.activeSceneId);
  const activeScene = useMemo(
    () => scenes.find((sc) => sc.id === activeSceneId) ?? null,
    [scenes, activeSceneId],
  );
  const openOverlay = useUiStore((s) => s.openOverlay);
  const [pageByScene, setPageByScene] = useState<Record<string, number>>({});
  const [editingPad, setEditingPad] = useState<Pad | null>(null);

  const addScene = useProjectStore((s) => s.addScene);
  const reorderPads = useProjectStore((s) => s.reorderPads);
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
  const multiFadeActive = useMultiFadeStore((s) => s.active);

  const handleEditClick = useCallback((pad: Pad) => {
    setEditingPad(pad);
    openOverlay(OVERLAY_ID.PAD_CONFIG_DRAWER, "dialog");
  }, [openOverlay]);

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
          className={cn("aspect-square w-40", addPadButtonClass)}
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
    <div className="flex-1 flex flex-col min-h-0 p-4 gap-4 relative">
      <DndContext
        sensors={sensors}
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
            {displayPads.map((pad, i) => (
              <motion.div
                key={pad.id}
                className="w-full h-full"
                initial={isDraggingPad ? false : { opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.15, delay: isDraggingPad ? 0 : i * 0.03 }}
              >
                <PadButton
                  pad={pad}
                  sceneId={activeScene.id}
                  index={i}
                  onEditClick={handleEditClick}
                />
              </motion.div>
            ))}
            {isLastPage && !isDraggingPad && (
              <motion.div
                className="w-full h-full"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.15, delay: displayPads.length * 0.03 }}
              >
                <button
                  onClick={() => openOverlay(OVERLAY_ID.PAD_CONFIG_DRAWER, "dialog")}
                  className={cn("w-full h-full", addPadButtonClass)}
                  aria-label="Add pad"
                >
                  <HugeiconsIcon
                    icon={Add02Icon}
                    size={32}
                    className="text-foreground/60"
                  />
                </button>
              </motion.div>
            )}
          </div>
        </SortableContext>
      </DndContext>

      <AnimatePresence>
        {multiFadeActive && (
          <div key="multi-fade-pill" className="flex justify-center shrink-0">
            <MultiFadePill />
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {totalPages > 1 && !isDraggingPad && (
          <motion.div
            key="page-nav"
            className="flex items-center justify-center gap-3 shrink-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={safePage === 0}
              onClick={() => setPage((p) => p - 1)}
              aria-label="Previous page"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={16} />
            </Button>
            <span className="text-white tabular-nums font-deathletter">
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
          </motion.div>
        )}
      </AnimatePresence>

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
