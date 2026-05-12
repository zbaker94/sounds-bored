import { useEffect, useRef } from "react";
import { useDownloadStore, TERMINAL_STATUSES } from "@/state/downloadStore";
import { saveDownloadHistory } from "@/lib/downloads";
import { logError } from "@/lib/logger";
import type { DownloadJob } from "@/lib/schemas";

/** Call once within the project shell (MainPageInner) — multiple instances write duplicate saves per terminal transition. */
export function useDownloadHistorySync(): void {
  const lastKeyRef = useRef("");
  const pendingSaveRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const buildKey = (jobs: DownloadJob[]) =>
      jobs.map((j) => `${j.id}::${j.status}`).sort().join("|");

    const enqueue = (jobs: DownloadJob[]) => {
      pendingSaveRef.current = pendingSaveRef.current
        .then(() => saveDownloadHistory(jobs))
        .catch((err: unknown) =>
          logError("Failed to save download history", err instanceof Error ? err : new Error(String(err))),
        );
    };

    // Persist terminal jobs already in store on mount — covers interrupted downloads
    // reclassified as failed by loadDownloadHistory before this hook mounts.
    const initial = Object.values(useDownloadStore.getState().jobs).filter((j) =>
      TERMINAL_STATUSES.has(j.status),
    );
    if (initial.length > 0) {
      lastKeyRef.current = buildKey(initial);
      enqueue(initial);
    }

    const unsub = useDownloadStore.subscribe((state) => {
      const terminal = Object.values(state.jobs).filter((j) => TERMINAL_STATUSES.has(j.status));
      const key = buildKey(terminal);
      if (key === lastKeyRef.current) return;
      lastKeyRef.current = key;
      enqueue(terminal);
    });
    return unsub;
  }, []);
}
