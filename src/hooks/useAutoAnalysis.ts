import { useEffect, useRef } from "react";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { useLibraryStore } from "@/state/libraryStore";
import { useAnalysisStore } from "@/state/analysisStore";
import { scheduleAnalysisForUnanalyzed } from "@/lib/library.reconcile";

export function useAutoAnalysis() {
  const autoAnalysis = useAppSettingsStore((s) => s.settings?.autoAnalysis ?? false);
  const settingsLoaded = useAppSettingsStore((s) => s.settings !== null);
  const prevRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (!settingsLoaded) return;

    const prev = prevRef.current;
    prevRef.current = autoAnalysis;

    if (prev === null) {
      // Settings just loaded — boot-time analysis is handled by useBootLoader.
      return;
    }

    if (autoAnalysis && !prev) {
      if (useAnalysisStore.getState().status === "idle") {
        void scheduleAnalysisForUnanalyzed(useLibraryStore.getState().sounds);
      }
    } else if (!autoAnalysis && prev) {
      useAnalysisStore.getState().cancelQueue();
    }
  }, [autoAnalysis, settingsLoaded]);
}
