import { useEffect, useRef } from "react";
import { useProjectStore } from "@/state/projectStore";
import { saveProject } from "@/lib/project";
import { AUTOSAVE_INTERVAL } from "@/lib/constants";
import { toast } from "sonner";

/**
 * Hook to periodically save the current project.
 * Only serializes and saves when isDirty is true (or on the first tick after load).
 * The interval is stable across project mutations — only restarts when folderPath changes.
 */
export function useAutoSave(interval: number = AUTOSAVE_INTERVAL) {
  const folderPath = useProjectStore((s) => s.folderPath);
  const clearDirtyFlag = useProjectStore((s) => s.clearDirtyFlag);
  const projectRef = useRef(useProjectStore.getState().project);
  const isDirtyRef = useRef(useProjectStore.getState().isDirty);
  const lastSaveRef = useRef<string>("");

  // Keep refs current without triggering effect re-runs
  useEffect(() => {
    return useProjectStore.subscribe((state) => {
      projectRef.current = state.project;
      isDirtyRef.current = state.isDirty;
    });
  }, []);

  useEffect(() => {
    if (!folderPath) return;

    // Reset so first interval tick always saves the newly loaded project
    lastSaveRef.current = "";

    const saveCurrentProject = async () => {
      const project = projectRef.current;
      if (!project || !folderPath) return;

      // Skip if clean and not the first tick — avoids unnecessary JSON.stringify
      if (!isDirtyRef.current && lastSaveRef.current !== "") return;

      try {
        const projectJson = JSON.stringify(project);

        // Secondary guard: skip if data is identical to last save
        if (projectJson !== lastSaveRef.current) {
      toast.info("Auto-saving project...");

          await saveProject(folderPath, project);
          lastSaveRef.current = projectJson;
          clearDirtyFlag();
          toast.dismiss();
          toast.success("Project auto-saved successfully.");
        }
      } catch (error) {
        toast.error("Auto-save failed. Your changes may not be saved.");
        console.error("Auto-save error:", error);
      }
    };

    saveCurrentProject();

    const intervalId = setInterval(saveCurrentProject, interval);
    return () => clearInterval(intervalId);
  }, [folderPath, interval, clearDirtyFlag]);
}
