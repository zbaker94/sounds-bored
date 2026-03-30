import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import {SmileDizzyIcon } from "@hugeicons/core-free-icons";
import { usePlaybackStore } from "@/state/playbackStore";

export function PlaySection() {
  const stopAll = usePlaybackStore((s) => s.stopAll);
  const isPlaying = usePlaybackStore((s) => s.playingPadIds.length > 0);


  return (
    <div className="flex items-center p-1 md:pb-2">
      <Button disabled={!isPlaying} variant={"destructive"} size="icon-lg" className="size-11 md:size-9 p-0" onClick={() => stopAll()}>
        <HugeiconsIcon  icon={SmileDizzyIcon} />
      </Button>
    </div>
  );
}
