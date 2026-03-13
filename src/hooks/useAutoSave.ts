import { useEffect, useRef } from "react";
import { useCurrentProject } from "@/state/currentProjectStore.tsx";
import { saveProject } from "@/lib/project";
import { AUTOSAVE_INTERVAL } from "@/lib/constants";

/**
 * Hook to periodically save the current project
 * @param interval - Save interval in milliseconds (default: 30 seconds)
 */
export function useAutoSave(interval: number = AUTOSAVE_INTERVAL) {
  const { currentProject, clearDirtyFlag } = useCurrentProject();
  const lastSaveRef = useRef<string>("");

  useEffect(() => {
    if (!currentProject) return;

    const saveCurrentProject = async () => {
      try {
        const projectJson = JSON.stringify(currentProject.project);

        // Only save if the project has changed
        if (projectJson !== lastSaveRef.current) {
          await saveProject(currentProject.historyEntry.path, currentProject.project);
          lastSaveRef.current = projectJson;

          // Clear dirty flag after successful save to disk
          // Note: This does NOT change isSaved - project may still be in temp location
          clearDirtyFlag();
        }
      } catch (error) {
        console.error("Failed to auto-save project:", error);
      }
    };

    // Save immediately on mount
    saveCurrentProject();

    // Set up periodic saving
    const intervalId = setInterval(saveCurrentProject, interval);

    return () => {
      clearInterval(intervalId);
    };
  }, [currentProject, interval, clearDirtyFlag]);
}
