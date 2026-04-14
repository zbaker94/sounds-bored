import { memo, useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Slider } from "@/components/ui/slider";
import type { Pad } from "@/lib/schemas";
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { useProjectStore } from "@/state/projectStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { usePlaybackStore } from "@/state/playbackStore";
import { setPadVolume } from "@/lib/audio/padPlayer";

interface PadButtonFadeOverlayProps {
  pad: Pad;
  sceneId: string;
}

/**
 * Renders the multi-fade slider overlay on a selected pad.
 *
 * Subscribes directly to multiFadeStore, projectStore, appSettingsStore, and
 * playbackStore so that this concern is fully isolated from PadButton. Returns
 * null when this pad is not selected in multi-fade mode.
 */
export const PadButtonFadeOverlay = memo(function PadButtonFadeOverlay({
  pad,
  sceneId,
}: PadButtonFadeOverlayProps) {
  const isPlaying = usePlaybackStore((s) => s.playingPadIds.has(pad.id));
  const isMultiFadeSelected = useMultiFadeStore((s) => s.active && s.selectedPads.has(pad.id));
  const multiFadeLevels = useMultiFadeStore((s) => {
    if (!s.active) return null;
    const entry = s.selectedPads.get(pad.id);
    return entry ? entry.levels : null;
  });
  const setMultiFadeLevels = useMultiFadeStore((s) => s.setMultiFadeLevels);

  const setPadFadeDuration = useProjectStore((s) => s.setPadFadeDuration);
  const globalFadeDurationMs = useAppSettingsStore((s) => s.settings?.globalFadeDurationMs);

  const resolvedFadeDuration = pad.fadeDurationMs ?? globalFadeDurationMs ?? 2000;
  const [displayDuration, setDisplayDuration] = useState(resolvedFadeDuration);
  useEffect(() => {
    setDisplayDuration(resolvedFadeDuration);
  }, [resolvedFadeDuration]);

  return (
    <AnimatePresence>
      {isMultiFadeSelected && multiFadeLevels && (
        <motion.div
          className="absolute bottom-0 left-0 right-0 z-20 px-2 pb-1.5 pt-0.5 bg-black/60 backdrop-blur-sm rounded-b-xl"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.15 }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Slider
            compact
            tooltipLabel={(v) => `${v}%`}
            value={[multiFadeLevels[0], multiFadeLevels[1]]}
            onValueChange={(v) => {
              if (isPlaying && v[1] !== multiFadeLevels[1]) {
                setPadVolume(pad.id, v[1] / 100);
              }
              setMultiFadeLevels(pad.id, [v[0], v[1]]);
            }}
            // Level changes persist immediately via onValueChange — no onPointerUp action needed.
            onPointerUp={() => {}}
            min={0}
            max={100}
            step={1}
            className="[&_[data-slot=slider-track]]:bg-white/20"
          />
          <div className="flex justify-between text-[9px] text-white/70 mt-0.5">
            <span>{isPlaying ? "end" : "start"}</span>
            <span>{isPlaying ? "start" : "end"}</span>
          </div>
          <Slider
            compact
            tooltipLabel={(v) => `${(v / 1000).toFixed(1)}s`}
            value={[displayDuration]}
            onValueChange={(v) => setDisplayDuration(v[0])}
            onPointerUp={() => setPadFadeDuration(sceneId, pad.id, displayDuration)}
            min={100}
            max={10000}
            step={100}
            className="mt-1.5 [&_[data-slot=slider-track]]:bg-white/20"
          />
          <div className="flex justify-between text-[9px] text-white/70 mt-0.5">
            <span>fade</span>
            <span>{(displayDuration / 1000).toFixed(1)}s</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});
