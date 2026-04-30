import { useState, useRef, memo } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Pad } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";
import { HugeiconsIcon } from "@hugeicons/react";
import { VolumeHighIcon } from "@hugeicons/core-free-icons";
import { useProjectStore } from "@/state/projectStore";
import { usePlaybackStore } from "@/state/playbackStore";
import { setPadVolume } from "@/lib/audio/padPlayer";
import { PadLabeledSlider } from "./PadLabeledSlider";

export interface PadFadeControlsProps {
  pad: Pad;
  sceneId: string;
  isPlaying: boolean;
  isFading: boolean;
  isReversing: boolean;
  globalFadeDurationMs: number;
  onFade: () => void;
  onStopFade: () => void;
  onReverse: () => void;
}

export const PadFadeControls = memo(function PadFadeControls({
  pad,
  sceneId,
  isPlaying,
  isFading,
  isReversing,
  globalFadeDurationMs,
  onFade,
  onStopFade,
  onReverse,
}: PadFadeControlsProps) {
  const liveVolume = usePlaybackStore((s) => s.padVolumes[pad.id]);
  const fadeDuration = pad.fadeDurationMs ?? globalFadeDurationMs;

  const padVolumePct = pad.volume ?? 100;
  const liveVolumePct = liveVolume !== undefined ? Math.round(liveVolume * 100) : padVolumePct;
  const [localVolume, setLocalVolume] = useState<number | null>(null);
  const volumeSliderValue = localVolume ?? liveVolumePct;
  const volumeDragStartRef = useRef<number | null>(null);

  const fadeTargetPct = pad.fadeTargetVol ?? 0;
  const [localFadeTarget, setLocalFadeTarget] = useState<number | null>(null);
  const fadeTargetSliderValue = localFadeTarget ?? fadeTargetPct;

  const [localFadeDuration, setLocalFadeDuration] = useState<number | null>(null);
  const fadeDurationSliderValue = localFadeDuration ?? fadeDuration;

  const isEqualVolume = isPlaying ? liveVolumePct === fadeTargetPct : fadeTargetPct === 0;
  const isFadeOut = !isEqualVolume && isPlaying && fadeTargetPct < liveVolumePct;

  return (
    <div className="flex flex-col gap-1.5 flex-shrink-0">
      <AnimatePresence initial={false}>
        {isPlaying && (
          <motion.div
            key="current-volume"
            className="flex flex-col gap-1.5 overflow-hidden"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Current volume</span>
              <span className="tabular-nums">{volumeSliderValue}%</span>
            </div>
            <Slider
              compact
              tooltipLabel={(v) => `${v}%`}
              value={[volumeSliderValue]}
              onThumbPointerDown={() => { volumeDragStartRef.current = volumeSliderValue; }}
              onValueChange={([v]) => {
                setLocalVolume(v);
                setPadVolume(pad.id, v / 100);
              }}
              onValueCommit={([v]) => {
                const moved = volumeDragStartRef.current === null || v !== volumeDragStartRef.current;
                volumeDragStartRef.current = null;
                setLocalVolume(null);
                if (moved) useProjectStore.getState().setPadVolume(sceneId, pad.id, v);
              }}
              min={0} max={100} step={1}
            />
          </motion.div>
        )}
      </AnimatePresence>
      <PadLabeledSlider
        label="Fade target"
        value={fadeTargetSliderValue}
        min={0} max={100} step={1}
        formatValue={(v) => `${v}%`}
        onValueChange={(v) => setLocalFadeTarget(v)}
        onValueCommit={(v) => {
          setLocalFadeTarget(null);
          useProjectStore.getState().setPadFadeTarget(sceneId, pad.id, v);
        }}
      />
      <PadLabeledSlider
        label="Duration"
        value={fadeDurationSliderValue}
        min={100} max={10000} step={100}
        formatValue={(v) => `${(v / 1000).toFixed(1)}s`}
        onValueChange={(v) => setLocalFadeDuration(v)}
        onValueCommit={(v) => {
          setLocalFadeDuration(null);
          useProjectStore.getState().setPadFadeDuration(sceneId, pad.id, v);
        }}
      />
      {pad.fadeDurationMs !== undefined ? (
        <button
          type="button"
          className="text-muted-foreground underline self-start"
          onClick={() => useProjectStore.getState().setPadFadeDuration(sceneId, pad.id, undefined)}
        >
          Reset to default
        </button>
      ) : (
        <p className="text-muted-foreground">Global default ({(globalFadeDurationMs / 1000).toFixed(1)}s)</p>
      )}
      <div className="flex items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            {isFading ? (
              <Button size="sm" variant="secondary" onClick={onStopFade} className="flex-1">
                <HugeiconsIcon icon={VolumeHighIcon} size={14} />
                Stop Fade
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={onFade} disabled={isEqualVolume} className="flex-1">
                <HugeiconsIcon icon={VolumeHighIcon} size={14} />
                {isEqualVolume ? "Fade" : isFadeOut ? "Fade Out" : "Fade In"}
              </Button>
            )}
          </TooltipTrigger>
          <TooltipContent><Kbd>F</Kbd></TooltipContent>
        </Tooltip>
        <AnimatePresence>
          {isFading && !isReversing && (
            <motion.div
              key="reverse"
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.15 }}
              className="flex-shrink-0"
            >
              <Button size="sm" variant="secondary" onClick={onReverse} className="whitespace-nowrap">
                Reverse
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
});
