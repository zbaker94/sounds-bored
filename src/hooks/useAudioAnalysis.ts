import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { z } from "zod";
import { useAnalysisStore } from "@/state/analysisStore";
import { useLibraryStore } from "@/state/libraryStore";
import { dispatchNextFromQueue, clearDispatchInFlight } from "@/lib/library.reconcile";
import { logError } from "@/lib/logger";
import { ANALYSIS_COMPLETE_EVENT, ANALYSIS_STARTED_EVENT } from "@/lib/constants";

const AnalysisCompletePayloadSchema = z.object({
  soundId: z.string(),
  loudnessLufs: z.number().finite().nullable(),
  error: z.string().nullable(),
});

export function useAudioAnalysis() {
  useEffect(() => {
    let cancelled = false;
    const unlisteners: (() => void)[] = [];

    function register(p: Promise<() => void>) {
      p.then((fn) => { if (cancelled) fn(); else unlisteners.push(fn); }).catch(() => {});
    }

    register(listen<unknown>(ANALYSIS_STARTED_EVENT, () => {
      clearDispatchInFlight();
    }));

    register(listen<unknown>(ANALYSIS_COMPLETE_EVENT, (event) => {
      const parsed = AnalysisCompletePayloadSchema.safeParse(event.payload);
      if (!parsed.success) {
        logError("Malformed analysis complete event", { payload: event.payload });
        // Best-effort recovery: record an error so the batch counter advances.
        const soundIdResult = z.object({ soundId: z.string() }).safeParse(event.payload);
        if (soundIdResult.success) {
          useAnalysisStore.getState().recordError(soundIdResult.data.soundId, "malformed analysis event");
        }
        void dispatchNextFromQueue();
        return;
      }

      const { soundId, loudnessLufs, error } = parsed.data;

      if (error) {
        logError("Audio analysis failed", { soundId, error });
        useAnalysisStore.getState().recordError(soundId, error);
      } else {
        // Pass loudnessLufs as-is: null = analysis ran but produced no value (prevents
        // infinite re-analysis on next boot); undefined path can't occur here since the
        // schema above returns number | null.
        useLibraryStore.getState().updateSoundAnalysis(soundId, { loudnessLufs });
        useAnalysisStore.getState().recordComplete(soundId);
      }

      void dispatchNextFromQueue();
      // Library persistence is handled by useAutoSave's interval-based dirty-flag check.
    }));

    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  }, []);
}
