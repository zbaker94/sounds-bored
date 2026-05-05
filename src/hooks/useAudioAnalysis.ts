import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { z } from "zod";
import { useAnalysisStore } from "@/state/analysisStore";
import { useLibraryStore } from "@/state/libraryStore";
import { dispatchNextFromQueue } from "@/lib/library.reconcile";
import { logError } from "@/lib/logger";
import { resolveGenre } from "@/lib/genreTaxonomy";
import { ANALYSIS_COMPLETE_EVENT, ANALYSIS_STARTED_EVENT } from "@/lib/constants";

const AnalysisCompletePayloadSchema = z.object({
  soundId: z.string(),
  loudnessLufs: z.number().finite().nullable(),
  genre: z.string().nullable(),
  mood: z.string().nullable(),
  error: z.string().nullable(),
});

const AnalysisStartedPayloadSchema = z.object({ soundId: z.string() });

export function useAudioAnalysis() {
  useEffect(() => {
    let cancelled = false;
    const unlisteners: (() => void)[] = [];

    function register(p: Promise<() => void>) {
      p.then((fn) => { if (cancelled) fn(); else unlisteners.push(fn); }).catch(() => {});
    }

    register(listen<unknown>(ANALYSIS_STARTED_EVENT, (event) => {
      const parsed = AnalysisStartedPayloadSchema.safeParse(event.payload);
      if (parsed.success) useAnalysisStore.getState().recordStarted(parsed.data.soundId);
    }));

    register(listen<unknown>(ANALYSIS_COMPLETE_EVENT, (event) => {
      const parsed = AnalysisCompletePayloadSchema.safeParse(event.payload);
      if (!parsed.success) return;

      const { soundId, loudnessLufs, genre, mood, error } = parsed.data;

      if (error) {
        logError("Audio analysis failed", { soundId, error });
        useAnalysisStore.getState().recordError(soundId, error);
      } else {
        useLibraryStore.getState().updateSoundAnalysis(soundId, {
          loudnessLufs: loudnessLufs ?? undefined,
          genre: genre != null ? resolveGenre(genre) : undefined,
          mood: mood ?? undefined,
        });
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
