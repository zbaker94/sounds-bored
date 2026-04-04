import { useMemo } from "react";
import { useProjectStore } from "@/state/projectStore";
import { Tabs, TabsList } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add02Icon } from "@hugeicons/core-free-icons";
import { SceneTab } from "./SceneTab";
import type { Scene } from "@/lib/schemas";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";
import { MenuDrawer } from "./MenuDrawer";
import { useHotkeys } from "react-hotkeys-hook";
import { modKey } from "@/lib/utils";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";

const EMPTY_SCENES: Scene[] = [];

export function SceneTabBar() {
  const scenes = useProjectStore((s) => s.project?.scenes ?? EMPTY_SCENES);
  const activeSceneId = useProjectStore((s) => s.activeSceneId);
  const setActiveSceneId = useProjectStore((s) => s.setActiveSceneId);
  const addScene = useProjectStore((s) => s.addScene);
  const reorderScenes = useProjectStore((s) => s.reorderScenes);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  const sceneIds = useMemo(() => scenes.map((s) => s.id), [scenes]);

  useHotkeys("mod+n", () => addScene());

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = scenes.findIndex((s) => s.id === active.id);
    const toIndex = scenes.findIndex((s) => s.id === over.id);
    if (fromIndex !== -1 && toIndex !== -1) reorderScenes(fromIndex, toIndex);
  }

  return (
    <div className="flex items-center gap-1 px-3 py-1 min-w-0">
      <MenuDrawer />

      {scenes.length > 0 && (
        <div className="min-w-0 max-w-[940px] overflow-x-auto overflow-y-hidden [scrollbar-gutter:stable]">
          <Tabs value={activeSceneId ?? ""} onValueChange={setActiveSceneId}>
            <TabsList variant="line">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={sceneIds}
                  strategy={horizontalListSortingStrategy}
                >
                  {scenes.map((scene) => (
                    <SceneTab key={scene.id} scene={scene} />
                  ))}
                </SortableContext>
              </DndContext>
            </TabsList>
          </Tabs>
        </div>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => addScene()}
            aria-label="Add scene"
            className="shadowed"
          >
            <HugeiconsIcon icon={Add02Icon} size={16} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>New Scene</p>
          <Kbd className="ml-2">{modKey} + N</Kbd>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
