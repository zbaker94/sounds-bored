import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { Sound, PadConfig } from "@/lib/schemas";
import { useProjectStore } from "@/state/projectStore";
import { useUiStore } from "@/state/uiStore";
import { PadButton } from "./PadButton";
import { PAD_STAGGER_MS, padEnterAnimation } from "./padAnimations";
import { MultiFadePill } from "./MultiFadePill";
import { createDefaultStoreLayer } from "@/lib/padDefaults";
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
import { useLibraryStore } from "@/state/libraryStore";
import { preloadStreamingAudio, LARGE_FILE_THRESHOLD_BYTES } from "@/lib/audio/streamingCache";
import { resolveLayerSounds } from "@/lib/audio/resolveSounds";
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
  useMultiFadeMode();

  // Split into two selectors + useMemo so the O(n) .find() scan only runs when
  // scenes or activeSceneId actually changes. Notably, isDirty (toggled on every
  // auto-save) lives outside project, so it does not produce a new scenes reference
  // and won't trigger the scan — unlike a single inline selector which always scans.
  const scenes = useProjectStore((s) => s.project?.scenes ?? []);
  const activeSceneId = useUiStore((s) => s.activeSceneId);
  const activeScene = useMemo(
    () => scenes.find((sc) => sc.id === activeSceneId) ?? null,
    [scenes, activeSceneId],
  );
  const librarySounds = useLibraryStore((s) => s.sounds);
  const addPad = useProjectStore((s) => s.addPad);
  const setEditingPadId = useUiStore((s) => s.setEditingPadId);

  // Pre-warm HTMLAudioElements for large sounds so the browser has already
  // buffered the file by the time the user triggers the pad.
  // Uses fileSizeBytes (in schema) for a synchronous size check — no HEAD
  // request. Tag/set selections are resolved against the current library.
  //
  // Perf: Immer replaces the scenes array reference on every project write
  // (e.g. volume tweaks, pad renames), so this effect fires for every mutation
  // even when the set of large sounds to preload hasn't changed. We guard with
  // a ref-based early-exit: compute the set of large sound IDs referenced by
  // the active scene and bail out if it's identical to the previous run.
  const prevPreloadIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!activeScene) return;
    const isLarge = (s: Sound) =>
      s.fileSizeBytes !== undefined && s.fileSizeBytes >= LARGE_FILE_THRESHOLD_BYTES;

    // First pass: collect IDs of large sounds that would be preloaded.
    const newIds = new Set<string>();
    const toPreload: Sound[] = [];
    for (const pad of activeScene.pads) {
      for (const layer of pad.layers) {
        for (const sound of resolveLayerSounds(layer, librarySounds)) {
          if (sound.filePath && isLarge(sound) && !newIds.has(sound.id)) {
            newIds.add(sound.id);
            toPreload.push(sound);
          }
        }
      }
    }

    // Early-exit when the referenced large-sound set hasn't changed.
    // Equal size + every newId in prev ⇒ sets are identical (both are deduplicated).
    const prev = prevPreloadIdsRef.current;
    if (prev.size === newIds.size) {
      let identical = true;
      for (const id of newIds) {
        if (!prev.has(id)) {
          identical = false;
          break;
        }
      }
      if (identical) return;
    }

    prevPreloadIdsRef.current = newIds;
    for (const sound of toPreload) {
      preloadStreamingAudio(sound);
    }
  }, [activeScene, librarySounds]);

  const [pageByScene, setPageByScene] = useState<Record<string, number>>({});

  const addScene = useProjectStore((s) => s.addScene);
  const reorderPads = useProjectStore((s) => s.reorderPads);
  const [isDraggingPad, setIsDraggingPad] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  const page = activeScene ? (pageByScene[activeScene.id] ?? 0) : 0;

  const setPage = useCallback((updater: (prev: number) => number) => {
    if (!activeScene) return;
    setPageByScene((prev) => ({
      ...prev,
      [activeScene.id]: updater(prev[activeScene.id] ?? 0),
    }));
  }, [activeScene]);

  const pads = activeScene?.pads ?? [];
  const multiFadeActive = useMultiFadeStore((s) => s.active);

  const handleAddPad = useCallback(() => {
    if (!activeSceneId) return;
    const newId = crypto.randomUUID();
    const config: PadConfig = {
      name: "",
      layers: [createDefaultStoreLayer()],
      muteTargetPadIds: [],
      fadeLowVol: 0,
      fadeHighVol: 1,
    };
    addPad(activeSceneId, config, newId);
    setEditingPadId(newId);
  }, [activeSceneId, addPad, setEditingPadId]);

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
          onClick={handleAddPad}
          className={cn("aspect-square w-40", addPadButtonClass)}
          aria-label="Add pad"
        >
          <HugeiconsIcon
            icon={Add02Icon}
            size={48}
            className="text-foreground/60"
          />
        </button>
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
              <div
                key={pad.id}
                className="w-full h-full"
                style={isDraggingPad ? undefined : {
                  animation: padEnterAnimation(i * PAD_STAGGER_MS),
                }}
              >
                <PadButton
                  pad={pad}
                  sceneId={activeScene.id}
                  index={i}
                />
              </div>
            ))}
            {isLastPage && !isDraggingPad && (
              <div
                className="w-full h-full"
                style={{ animation: padEnterAnimation(displayPads.length * PAD_STAGGER_MS) }}
              >
                <button
                  onClick={handleAddPad}
                  className={cn("w-full h-full", addPadButtonClass)}
                  aria-label="Add pad"
                >
                  <HugeiconsIcon
                    icon={Add02Icon}
                    size={32}
                    className="text-foreground/60"
                  />
                </button>
              </div>
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

    </div>
  );
}
