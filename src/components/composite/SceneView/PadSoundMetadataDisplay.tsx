import { memo, useEffect, useRef } from "react";
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
 * Inline sound metadata shown in the pad name slot when a sound starts playing.
 * Manages the auto-advance timer and fast-dismiss logic; visual animation is
 * handled by the AnimatePresence wrapper in PadFrontFace.
 *
 * - Subscribes to padDisplayStore.currentVoice[padId]
 * - Auto-advances after min(2500ms, durationMs) for one-shot pads
 * - Skips auto-advance for loop/hold pads (persists until interaction or pad stop)
 * - Fast-dismisses when isInteracting becomes true
 */
export const PadSoundMetadataDisplay = memo(function PadSoundMetadataDisplay({
  padId,
  isInteracting,
}: Props) {
  const currentVoice = usePadDisplayStore((s) => s.currentVoice[padId] ?? null);

  // Preserve the last non-null voice so the parent AnimatePresence exit animation has content
  // to fade out (currentVoice becomes null before the exit completes).
  const lastVoiceRef = useRef(currentVoice);
  if (currentVoice != null) lastVoiceRef.current = currentVoice;
  const displayVoice = lastVoiceRef.current;

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

    // Loop/hold: don't auto-advance — display persists until interaction or pad stop
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

  if (displayVoice == null) return null;

  return (
    <>
      <span data-testid="sound-name" className="line-clamp-1 break-words leading-tight text-center">
        {displayVoice.soundName}
      </span>
      <span data-testid="layer-info" className="text-xs leading-tight text-center opacity-70">
        {displayVoice.layerName ? `${displayVoice.layerName} • ` : ""}
        {displayVoice.playbackMode}
      </span>
      {displayVoice.durationMs != null && displayVoice.durationMs > 0 && (
        <span data-testid="duration" className="text-xs leading-tight text-center opacity-50">
          {formatDuration(displayVoice.durationMs)}
        </span>
      )}
    </>
  );
});
