import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { SmileDizzyIcon } from "@hugeicons/core-free-icons";
import { usePlaybackStore } from "@/state/playbackStore";
import { stopAllPads } from "@/lib/audio/padPlayer";
import { stopPreview } from "@/lib/audio/preview";

export function PlaySection() {
  const isPlaying = usePlaybackStore((s) => s.playingPadIds.length > 0 || s.isPreviewPlaying);

  return (
    <div className="flex items-center p-1 md:pb-2">
      <Button disabled={!isPlaying} variant="destructive" size="sidebar" onClick={() => { stopAllPads(); stopPreview(); }}>
        <HugeiconsIcon icon={SmileDizzyIcon} />
      </Button>
    </div>
  );
}
