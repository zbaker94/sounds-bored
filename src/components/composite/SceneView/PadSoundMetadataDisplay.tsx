import { memo, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { usePadDisplayStore } from "@/state/padDisplayStore";

interface Props {
  padId: string;
  isInteracting: boolean;
}

const AUTO_ADVANCE_MAX_MS = 2500;

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Animated overlay shown on the front face of a pad when a sound starts playing.
 *
 * - Subscribes to padDisplayStore.currentVoice[padId]
 * - Auto-advances after min(2500ms, durationMs) for one-shot pads
 * - Skips auto-advance for loop/hold pads (overlay persists until interaction or pad stop)
 * - Fast-dismisses when isInteracting becomes true
 */
export const PadSoundMetadataDisplay = memo(function PadSoundMetadataDisplay({
  padId,
  isInteracting,
}: Props) {
  const currentVoice = usePadDisplayStore((s) => s.currentVoice[padId] ?? null);

  // Single consolidated effect: handles auto-advance timer, fast-dismiss, and loop/hold skip.
  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (autoAdvanceTimerRef.current !== null) {
      clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    if (currentVoice == null) return;

    // Fast-dismiss takes priority — no need to start a timer
    if (isInteracting) {
      usePadDisplayStore.getState().shiftVoice(padId);
      return;
    }

    // Loop/hold: don't auto-advance — overlay persists until interaction or pad stop
    if (currentVoice.playbackMode === "loop" || currentVoice.playbackMode === "hold") {
      return;
    }

    const dur = currentVoice.durationMs;
    const delayMs = (dur != null && dur > 0) ? Math.min(AUTO_ADVANCE_MAX_MS, dur) : AUTO_ADVANCE_MAX_MS;
    autoAdvanceTimerRef.current = setTimeout(() => {
      autoAdvanceTimerRef.current = null;
      usePadDisplayStore.getState().shiftVoice(padId);
    }, delayMs);
    return () => {
      if (autoAdvanceTimerRef.current !== null) {
        clearTimeout(autoAdvanceTimerRef.current);
        autoAdvanceTimerRef.current = null;
      }
    };
  }, [currentVoice, padId, isInteracting]);

  return (
    <AnimatePresence>
      {currentVoice != null && (
        <motion.div
          key={currentVoice.seq}
          className="absolute inset-0 z-20 flex flex-col items-center justify-center pointer-events-none"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4, transition: { duration: 0.15 } }}
          transition={{ duration: 0.2 }}
        >
          <div className="bg-black/70 rounded-lg px-2 py-1 max-w-full flex flex-col items-center">
            <span
              data-testid="sound-name"
              className="text-xs font-semibold text-white truncate max-w-full"
            >
              {currentVoice.soundName}
            </span>
            <span data-testid="layer-info" className="text-[10px] text-white/70">
              {currentVoice.layerName ? `${currentVoice.layerName} • ` : ""}
              {currentVoice.playbackMode}
            </span>
            {currentVoice.durationMs !== undefined && (
              <span data-testid="duration" className="text-[10px] text-white/50">
                {formatDuration(currentVoice.durationMs)}
              </span>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});
