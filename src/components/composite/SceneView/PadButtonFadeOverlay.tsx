import { memo, useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { Pad } from "@/lib/schemas";
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { useProjectStore } from "@/state/projectStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { usePlaybackStore } from "@/state/playbackStore";
import { setPadVolume } from "@/lib/audio/padPlayer";
import { PadOverlaySlider } from "./PadOverlaySlider";

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
 *
 * levels[0] = current playback volume (0–100)
 * levels[1] = fade target volume (0–100)
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
          className="absolute bottom-0 left-0 right-0 z-20 px-2 pb-1.5 pt-0.5 bg-black/60 backdrop-blur-sm rounded-b-xl flex flex-col gap-1.5"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.15 }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <PadOverlaySlider
            label="volume"
            value={multiFadeLevels[0]}
            formatValue={(v) => `${v}%`}
            onValueChange={(v) => {
              if (isPlaying) setPadVolume(pad.id, v / 100);
              setMultiFadeLevels(pad.id, [v, multiFadeLevels[1]]);
            }}
            onValueCommit={(v) => useProjectStore.getState().setPadVolume(sceneId, pad.id, v)}
            min={0}
            max={100}
            step={1}
            sliderClassName="[&_[data-slot=slider-track]]:bg-white/20"
          />
          <PadOverlaySlider
            label="target"
            value={multiFadeLevels[1]}
            formatValue={(v) => `${v}%`}
            onValueChange={(v) => setMultiFadeLevels(pad.id, [multiFadeLevels[0], v])}
            onValueCommit={(v) => useProjectStore.getState().setPadFadeTarget(sceneId, pad.id, v)}
            min={0}
            max={100}
            step={1}
            sliderClassName="[&_[data-slot=slider-track]]:bg-white/20"
          />
          <PadOverlaySlider
            label="fade"
            value={displayDuration}
            formatValue={(v) => `${(v / 1000).toFixed(1)}s`}
            onValueChange={(v) => setDisplayDuration(v)}
            onValueCommit={(v) => useProjectStore.getState().setPadFadeDuration(sceneId, pad.id, v)}
            min={100}
            max={10000}
            step={100}
            sliderClassName="[&_[data-slot=slider-track]]:bg-white/20"
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
});
