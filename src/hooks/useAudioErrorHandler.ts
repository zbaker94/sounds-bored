// src/hooks/useAudioErrorHandler.ts
//
// Registers the audio engine's error bus handler once at app startup.
// Translates structured AudioErrorContext values into Sonner toast notifications
// and triggers library reconciliation when a missing-file error is reported.

import { useEffect } from "react";
import { toast } from "sonner";
import { setAudioErrorHandler } from "@/lib/audio/audioEvents";
import { refreshMissingState } from "@/lib/library.reconcile";

/**
 * Call this hook once inside MainPageInner (or another always-mounted component).
 * It wires the audio engine error bus to the UI notification layer, keeping
 * `sonner` and store side-effects out of `src/lib/audio/`.
 */
export function useAudioErrorHandler(): void {
  useEffect(() => {
    setAudioErrorHandler((err, { soundName, isMissingFile }) => {
      if (isMissingFile) {
        // Fire-and-forget: refresh missing-file state in the background so the Sounds
        // panel indicators update after the filesystem scan completes.
        // Intentionally not awaited. The AudioErrorHandler contract in audioEvents.ts
        // discards the return value (return type `void`), so awaiting here would only
        // delay the toast and any subsequent handler work — it would not backpressure
        // the audio engine caller. Blocking on a potentially slow filesystem scan is
        // also undesirable. The toast below fires immediately regardless of scan
        // completion; users who open the Sounds panel will see updated indicators once
        // the scan finishes.
        refreshMissingState().catch((err: unknown) => {
          // A failed refresh is non-fatal — the Sounds panel will show stale state
          // until the next successful reconcile. Log in dev so regressions are visible.
          if (import.meta.env.DEV) {
            console.warn("[useAudioErrorHandler] refreshMissingState failed:", err);
          }
        });
        toast.error(
          soundName
            ? `Failed to play "${soundName}" — file not found. Check the Sounds panel.`
            : "Playback error: file not found.",
        );
      } else {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(
          soundName
            ? `Failed to play "${soundName}": ${message}`
            : `Playback error: audio fade failed — ${message}`,
        );
      }
    });
  // Handler is registered once; no cleanup needed — the engine may emit errors
  // outside React's lifecycle (from Web Audio onended callbacks).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
