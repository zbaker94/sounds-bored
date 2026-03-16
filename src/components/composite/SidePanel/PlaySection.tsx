import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlayIcon, StopIcon } from "@hugeicons/core-free-icons";
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
      <Button variant="default" size="icon" className="size-11 md:size-9" onClick={togglePlay}>
        <HugeiconsIcon icon={isPlaying ? StopIcon : PlayIcon} />
      </Button>
    </div>
  );
}
