import { usePlaybackStore } from "@/state/playbackStore";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { HugeiconsIcon } from "@hugeicons/react";
import { HeadphonesIcon, HeadphoneMuteIcon } from "@hugeicons/core-free-icons";
import { useCallback, useMemo, useRef } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";
import { useIsMd } from "@/hooks/useBreakpoint";
import { modKey } from "@/lib/utils";

export function VolumeSection() {
  const isMd = useIsMd();
    const tooltipSide = useMemo(() => (isMd ? "left" : "top"), [isMd]);

  const masterVolume = usePlaybackStore((s) => s.masterVolume);
  const setMasterVolume = usePlaybackStore((s) => s.setMasterVolume);
  const preMuteVolume = useRef<number>(100);

  const handleMuteToggle = useCallback(() => {
    if (masterVolume > 0) {
      preMuteVolume.current = masterVolume;
      setMasterVolume(0);
    } else {
      setMasterVolume(preMuteVolume.current <= 10 ? 100 : preMuteVolume.current);
    }
  }, [masterVolume, setMasterVolume]);

  return (
    <div className="flex-1 md:flex-none flex flex-row items-center justify-center gap-2 md:flex-col">
      <Slider
        orientation="horizontal"
        value={[masterVolume]}
        onValueChange={(vals) => setMasterVolume(vals[0])}
        max={100}
        min={0}
        className="w-42 md:hidden"
      />
      <Slider
        orientation="vertical"
        value={[masterVolume]}
        onValueChange={(vals) => setMasterVolume(vals[0])}
        max={100}
        min={0}
        className="hidden md:flex"
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="default"
            size="sidebar"
            onClick={handleMuteToggle}
          >
            {masterVolume > 0 ? (
              <HugeiconsIcon icon={HeadphonesIcon} />
            ) : (
              <HugeiconsIcon icon={HeadphoneMuteIcon} />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side={tooltipSide}>
          <p>{masterVolume > 0 ? "Mute" : "Unmute"}</p>
          <Kbd>{modKey}+M</Kbd>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
