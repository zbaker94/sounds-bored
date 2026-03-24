import { useState, useMemo } from "react";
import { useProjectStore } from "@/state/projectStore";
import { useUiStore, OVERLAY_ID } from "@/state/uiStore";
import { PadButton } from "./PadButton";
import { PadConfigDrawer } from "../PadConfigDrawer/PadConfigDrawer";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add02Icon, ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { useHotkeys } from "react-hotkeys-hook";

const PADS_PER_PAGE = 12;

export function SceneView() {
  const activeSceneId = useProjectStore((s) => s.activeSceneId);
  const project = useProjectStore((s) => s.project);
  const openOverlay = useUiStore((s) => s.openOverlay);
  const [pageByScene, setPageByScene] = useState<Record<string, number>>({});

  const activeScene = useMemo(
    () => project?.scenes.find((s) => s.id === activeSceneId) ?? null,
    [project, activeSceneId]
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
  const totalPages = Math.max(1, Math.ceil(pads.length / PADS_PER_PAGE));
  const safePage = Math.min(page, totalPages - 1);
  const isLastPage = safePage === totalPages - 1;

  // Hooks must be called unconditionally — before any early returns.
  useHotkeys("shift+left", () => { if (safePage > 0) setPage((p) => p - 1); else setPage(() => totalPages - 1); }, { preventDefault: true });
  useHotkeys("shift+right", () => { if (!isLastPage) setPage((p) => p + 1); else setPage(() => 0); }, { preventDefault: true });

  if (!activeScene) {
    return <div className="flex-1" />;
  }

  if (pads.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <button
          onClick={() => openOverlay(OVERLAY_ID.PAD_CONFIG_DRAWER, "dialog")}
          className="aspect-square w-40 rounded-xl border-2 border-dashed border-foreground/40 bg-card/80 flex items-center justify-center hover:border-foreground/70 hover:bg-card transition-all cursor-pointer shadow-[3px_3px_0px_rgba(0,0,0,0.3)]"
          aria-label="Add pad"
        >
          <HugeiconsIcon icon={Add02Icon} size={48} className="text-foreground/60" />
        </button>
        <PadConfigDrawer sceneId={activeScene.id} />
      </div>
    );
  }

  const pagePads = pads.slice(safePage * PADS_PER_PAGE, (safePage + 1) * PADS_PER_PAGE);

  return (
    <div className="flex-1 flex flex-col min-h-0 p-4 gap-4">
      <div className="flex-1 min-h-0 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 auto-rows-fr gap-3">
        {pagePads.map((pad) => (
          <PadButton key={pad.id} pad={pad} />
        ))}
        {isLastPage && (
          <button
            onClick={() => openOverlay(OVERLAY_ID.PAD_CONFIG_DRAWER, "dialog")}
            className="w-full h-full rounded-xl border-2 border-dashed border-foreground/40 bg-card/80 flex items-center justify-center hover:border-foreground/70 hover:bg-card transition-all cursor-pointer shadow-[3px_3px_0px_rgba(0,0,0,0.3)]"
            aria-label="Add pad"
          >
            <HugeiconsIcon icon={Add02Icon} size={32} className="text-foreground/60" />
          </button>
        )}
      </div>

      {totalPages > 1 && (
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

      <PadConfigDrawer sceneId={activeScene.id} />
    </div>
  );
}
