import { useProjectStore } from "@/state/projectStore";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add02Icon, ClipboardIcon, FolderExportIcon, Hamburger01Icon, HomeIcon, SaveIcon } from "@hugeicons/core-free-icons";
import type { Scene } from "@/lib/schemas";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Drawer, DrawerContent, DrawerHeader, DrawerTrigger } from "@/components/ui/drawer";
import { Separator } from "@/components/ui/separator";
import { Kbd } from "@/components/ui/kbd";

const EMPTY_SCENES: Scene[] = [];

export function SceneTabBar() {
  const scenes = useProjectStore((s) => s.project?.scenes ?? EMPTY_SCENES);
  const activeSceneId = useProjectStore((s) => s.activeSceneId);
  const setActiveSceneId = useProjectStore((s) => s.setActiveSceneId);
  const addScene = useProjectStore((s) => s.addScene);

  const isDirty = useProjectStore((s) => s.isDirty);

  return (
    <div className="flex items-center gap-1 px-3 py-1 min-w-0">
      <Drawer direction="left">
        <DrawerTrigger>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Open Menu"
            className="shadowed"
          >
            <HugeiconsIcon icon={Hamburger01Icon} size={16} />
          </Button>
        </DrawerTrigger>
        <DrawerContent className="w-64">
          <DrawerHeader>
              <h1 className="text-lg font-semibold">Menu</h1>
          </DrawerHeader>
          <Button disabled={!isDirty} variant="secondary" className="w-full mb-2" onClick={() => null}>
            <HugeiconsIcon icon={SaveIcon} size={16} />
            Save
            <Kbd className="ml-auto">Ctrl + S</Kbd>
          </Button>
          <Button variant="secondary" className="w-full" onClick={() => null}>
            <HugeiconsIcon icon={ClipboardIcon} size={16} />
            Save As
            <Kbd className="ml-auto">Ctrl + Shift + S</Kbd>
          </Button>
          <Separator />
          <Button variant="secondary" className="w-full mt-2" onClick={() => null}>
            <HugeiconsIcon icon={FolderExportIcon} size={16} />
            Export
            <Kbd className="ml-auto">Ctrl + X</Kbd>
          </Button>
          <Separator />
          <Button variant="default" className="w-full mt-2" onClick={() => null}>
            <HugeiconsIcon icon={HomeIcon} size={16} />
            Return to Main Menu
          </Button>
        </DrawerContent>
      </Drawer>

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
          <Kbd className="ml-2">Ctrl + N</Kbd>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
