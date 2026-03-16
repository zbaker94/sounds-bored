import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlayIcon, SmileDizzyIcon } from "@hugeicons/core-free-icons";
import { usePlaybackStore } from "@/state/playbackStore";
import { useCallback } from "react";

export function PlaySection() {
  const setIsPlaying = usePlaybackStore((s) => s.setIsPlaying);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);

  const togglePlay = useCallback(() => {
    setIsPlaying(!isPlaying);
  }, [isPlaying, setIsPlaying]);

  return (
    <div className="flex items-center p-1 md:pb-2">
      <Button variant={isPlaying ? "destructive" : "default"} size="icon-lg" className="size-11 md:size-9 p-0" onClick={togglePlay}>
        <HugeiconsIcon size={200} icon={isPlaying ? SmileDizzyIcon : PlayIcon} />
      </Button>
    </div>
  );
}
