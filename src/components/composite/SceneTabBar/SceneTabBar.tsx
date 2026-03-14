import { Scene } from "@/lib/schemas";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add02Icon } from "@hugeicons/core-free-icons";

interface SceneTabBarProps {
  scenes: Scene[];
  activeSceneId: string | null;
  onSceneChange: (sceneId: string) => void;
  onAddScene: () => void;
}

export function SceneTabBar({
  scenes,
  activeSceneId,
  onSceneChange,
  onAddScene,
}: SceneTabBarProps) {
  return (
    <div className="flex items-center gap-1 border-b px-3 py-1">
      <Tabs value={activeSceneId ?? undefined} onValueChange={onSceneChange}>
        <TabsList variant="line">
          {scenes.map((scene) => (
            <TabsTrigger
              key={scene.id}
              value={scene.id}
              onClick={() => onSceneChange(scene.id)}
            >
              {scene.name}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onAddScene}
        aria-label="Add scene"
      >
        <HugeiconsIcon icon={Add02Icon} size={16} />
      </Button>
    </div>
  );
}
