import { useEffect, useRef } from "react";
import { useProjectStore } from "@/state/projectStore";
import { useSaveProject } from "@/lib/project.queries";
import { AUTOSAVE_INTERVAL } from "@/lib/constants";

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

  // Keep refs current without triggering effect re-runs
  useEffect(() => {
    return useProjectStore.subscribe((state) => {
      projectRef.current = state.project;
      isDirtyRef.current = state.isDirty;
    });
  }, []);

  useEffect(() => {
    if (!folderPath || isTemporary) return;

    const saveCurrentProject = () => {
      const project = projectRef.current;
      if (!project || !folderPath) return;
      if (!isDirtyRef.current) return;

      const projectJson = JSON.stringify(project);

      // Secondary guard: skip if data is identical to last save
      if (projectJson === lastSaveRef.current) return;

      saveProjectMutation.mutate({ folderPath, project }, {
        onSuccess: () => { lastSaveRef.current = projectJson; },
      });
    };

    saveCurrentProject();

    const intervalId = setInterval(saveCurrentProject, interval);
    return () => clearInterval(intervalId);
  }, [folderPath, isTemporary, interval]);
}
