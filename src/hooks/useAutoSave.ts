import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useProjectStore } from "@/state/projectStore";
import { useLibraryStore } from "@/state/libraryStore";
import { useSaveProject } from "@/lib/project.queries";
import { useSaveCurrentLibrary } from "@/lib/library.queries";
import { refreshMissingState } from "@/lib/library.reconcile";
import { AUTOSAVE_INTERVAL } from "@/lib/constants";

/**
 * Show the auto-save failure toast at most once per minute even if auto-save
 * keeps failing (fires every 30s). Prevents spam when the underlying problem
 * (disk full, permissions, disconnected drive) persists across many ticks.
 */
const AUTO_SAVE_ERROR_DEBOUNCE_MS = 60_000;

/**
 * Hook to periodically save the current project.
 * Only saves when isDirty is true. The interval is stable across project mutations
 * — only restarts when folderPath changes.
 */
export function useAutoSave(interval: number = AUTOSAVE_INTERVAL) {
  const folderPath = useProjectStore((s) => s.folderPath);
  const isTemporary = useProjectStore((s) => s.isTemporary);
  const projectRef = useRef(useProjectStore.getState().project);
  const isDirtyRef = useRef(useProjectStore.getState().isDirty);
  const lastSaveRef = useRef<string>("");
  const saveProjectMutation = useSaveProject();

  const lastLibrarySaveRef = useRef<string>("");
  const { saveCurrentLibrarySync } = useSaveCurrentLibrary();

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

      const projectJson = JSON.stringify(project);

      // Secondary guard: skip if data is identical to last save
      if (projectJson === lastSaveRef.current) return;

      saveProjectMutation.mutate({ folderPath, project }, {
        onSuccess: () => { lastSaveRef.current = projectJson; },
        // Do NOT clear the dirty flag on failure — the hook should keep retrying
        // on the next interval tick so the project is saved once the underlying
        // problem (disk full, permission issue, missing drive) is resolved.
        onError: notifyAutoSaveFailure,
      });
    };

    const saveLibrary = () => {
      const { sounds, tags, sets, isDirty } = useLibraryStore.getState();
      if (!isDirty) return;

      const libraryJson = JSON.stringify({ sounds, tags, sets });
      if (libraryJson === lastLibrarySaveRef.current) return;

      saveCurrentLibrarySync({
        onSuccess: () => { lastLibrarySaveRef.current = libraryJson; },
        onError: notifyAutoSaveFailure,
      });
    };

    saveCurrentProject();
    saveLibrary();
    void refreshMissingState();

    const intervalId = setInterval(() => {
      saveCurrentProject();
      saveLibrary();
      void refreshMissingState();
    }, interval);
    return () => clearInterval(intervalId);
  }, [folderPath, isTemporary, interval, saveCurrentLibrarySync]);
}
