import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useProjectStore } from "@/state/projectStore";
import { useLibraryStore } from "@/state/libraryStore";
import { saveProject } from "@/lib/project";
import { saveCurrentLibraryAndClearDirty } from "@/lib/library";
import { AUTOSAVE_INTERVAL } from "@/lib/constants";

/**
 * Show the auto-save failure toast at most once per minute even if auto-save
 * keeps failing (fires every 30s). Prevents spam when the underlying problem
 * (disk full, permissions, disconnected drive) persists across many ticks.
 */
const AUTO_SAVE_ERROR_DEBOUNCE_MS = 60_000;

/**
 * Hook to periodically save the current project and library.
 * Only saves when isDirty is true. The interval is stable across project mutations
 * — only restarts when folderPath changes.
 *
 * Missing-status checks (`refreshMissingState`) are NOT performed here.
 * They are triggered on specific events instead (project load, audio errors,
 * manual reconcile) to avoid O(library size) filesystem scans every 30 seconds.
 * Consequence: if a user deletes a sound file externally while the app is open,
 * the Sounds panel will not show it as missing until they next attempt playback,
 * preview, or manual reconcile. This is an intentional UX tradeoff.
 */
export function useAutoSave(interval: number = AUTOSAVE_INTERVAL) {
  const folderPath = useProjectStore((s) => s.folderPath);
  const isTemporary = useProjectStore((s) => s.isTemporary);
  const projectRef = useRef(useProjectStore.getState().project);
  const isDirtyRef = useRef(useProjectStore.getState().isDirty);
  const isProjectSavePendingRef = useRef(false);
  const isLibrarySavePendingRef = useRef(false);

  // Timestamp (ms) of the most recent auto-save error toast. Used to debounce
  // repeated failure toasts — without this, a persistent write failure would
  // surface a toast every 30s.
  const lastAutoSaveErrorRef = useRef<number>(0);

  // Keep refs current without triggering effect re-runs
  useEffect(() => {
    return useProjectStore.subscribe((state) => {
      projectRef.current = state.project;
      isDirtyRef.current = state.isDirty;
    });
  }, []);

  useEffect(() => {
    if (!folderPath || isTemporary) return;

    const notifyAutoSaveFailure = () => {
      const now = Date.now();
      if (now - lastAutoSaveErrorRef.current < AUTO_SAVE_ERROR_DEBOUNCE_MS) return;
      lastAutoSaveErrorRef.current = now;
      toast.error("Auto-save failed — your changes may not be saved to disk.");
    };

    const saveCurrentProject = () => {
      const project = projectRef.current;
      if (!project || !folderPath) return;
      if (!isDirtyRef.current) return;
      if (isProjectSavePendingRef.current) return;

      isProjectSavePendingRef.current = true;
      saveProject(folderPath, project)
        .then(() => {
          useProjectStore.getState().clearDirtyFlag();
        })
        .catch((error: unknown) => {
          console.error("Failed to save project:", error);
          notifyAutoSaveFailure();
        })
        .finally(() => {
          isProjectSavePendingRef.current = false;
        });
    };

    const saveLibrary = () => {
      const { isDirty } = useLibraryStore.getState();
      if (!isDirty) return;
      if (isLibrarySavePendingRef.current) return;

      isLibrarySavePendingRef.current = true;
      saveCurrentLibraryAndClearDirty()
        .catch((error: unknown) => {
          console.error("Failed to save library:", error);
          notifyAutoSaveFailure();
        })
        .finally(() => {
          isLibrarySavePendingRef.current = false;
        });
    };

    saveCurrentProject();
    saveLibrary();

    const intervalId = setInterval(() => {
      saveCurrentProject();
      saveLibrary();
    }, interval);
    return () => clearInterval(intervalId);
  }, [folderPath, isTemporary, interval]);
}
