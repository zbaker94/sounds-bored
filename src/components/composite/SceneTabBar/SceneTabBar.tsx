import { useProjectStore } from "@/state/projectStore";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add02Icon } from "@hugeicons/core-free-icons";
import type { Scene } from "@/lib/schemas";

const EMPTY_SCENES: Scene[] = [];

export function SceneTabBar() {
  const scenes = useProjectStore((s) => s.project?.scenes ?? EMPTY_SCENES);
  const activeSceneId = useProjectStore((s) => s.activeSceneId);
  const setActiveSceneId = useProjectStore((s) => s.setActiveSceneId);
  const addScene = useProjectStore((s) => s.addScene);

  return (
    <div className="flex items-center gap-1 border-b px-3 py-1">
      <Tabs value={activeSceneId ?? ""} onValueChange={setActiveSceneId}>
        <TabsList variant="line">
          {scenes.map((scene) => (
            <TabsTrigger key={scene.id} value={scene.id}>
              {scene.name}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => addScene()}
        aria-label="Add scene"
      >
        <HugeiconsIcon icon={Add02Icon} size={16} />
      </Button>
    </div>
  );
}
