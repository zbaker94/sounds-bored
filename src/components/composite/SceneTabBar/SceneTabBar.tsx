import { useProjectStore } from "@/state/projectStore";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add02Icon } from "@hugeicons/core-free-icons";
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

const EMPTY_SCENES: Scene[] = [];

export function SceneTabBar() {
  const scenes = useProjectStore((s) => s.project?.scenes ?? EMPTY_SCENES);
  const activeSceneId = useProjectStore((s) => s.activeSceneId);
  const setActiveSceneId = useProjectStore((s) => s.setActiveSceneId);
  const addScene = useProjectStore((s) => s.addScene);

  // new scene hotkey
  useHotkeys("mod+n", () => addScene());

  return (
    <div className="flex items-center gap-1 px-3 py-1 min-w-0">
      <MenuDrawer />

      {scenes.length > 0 && (
        <div className="min-w-0 max-w-[940px] overflow-x-auto overflow-y-hidden [scrollbar-gutter:stable]">
          <Tabs value={activeSceneId ?? ""} onValueChange={setActiveSceneId}>
            <TabsList variant="line">
              {scenes.map((scene) => (
                <TabsTrigger key={scene.id} value={scene.id}>
                  {scene.name}
                </TabsTrigger>
              ))}
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
