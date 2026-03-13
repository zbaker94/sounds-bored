import React, { createContext, useContext, useState } from "react";
import { ProjectHistoryEntry, Project } from "@/lib/schemas";

interface CurrentProjectData {
  historyEntry: ProjectHistoryEntry;
  project: Project;
  isTemporary: boolean; // Tracks whether the project is in a temporary location (true) or permanent (false)
  isDirty: boolean; // Tracks whether the project has been modified since last disk write
}

interface CurrentProjectContextType {
  currentProject: CurrentProjectData | null;
  setCurrentProject: (historyEntry: ProjectHistoryEntry, project?: Project, isTemporary?: boolean) => void;
  updateProject: (project: Project) => void;
  clearDirtyFlag: () => void;
  markAsPermanent: (historyEntry: ProjectHistoryEntry) => void;
  hasUnsavedChanges: () => boolean;
}

const CurrentProjectContext = createContext<CurrentProjectContextType | undefined>(undefined);

export const CurrentProjectProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentProject, setCurrentProjectState] = useState<CurrentProjectData | null>(null);

  const setCurrentProject = (historyEntry: ProjectHistoryEntry, project?: Project, isTemporary = true) => {
    setCurrentProjectState({
      historyEntry,
      project: project || { name: historyEntry.name },
      isTemporary,
      isDirty: false, // Always start with clean state when loading a project
    });
  };

  const updateProject = (project: Project) => {
    if (currentProject) {
      setCurrentProjectState({
        ...currentProject,
        project,
        isDirty: true, // Mark as dirty when project is updated
      });
    }
  };

  const clearDirtyFlag = () => {
    if (currentProject) {
      setCurrentProjectState({
        ...currentProject,
        isDirty: false, // Clear dirty flag after auto-save to disk
        // NOTE: isTemporary remains unchanged - still in temp location if it was before
      });
    }
  };

  const markAsPermanent = (historyEntry: ProjectHistoryEntry) => {
    if (currentProject) {
      setCurrentProjectState({
        ...currentProject,
        historyEntry,
        isTemporary: false, // Project is now in a permanent location
        isDirty: false, // Clear dirty flag after saving
      });
    }
  };

  const hasUnsavedChanges = () => {
    if (!currentProject) {
      return false;
    }
    // Has unsaved changes if: in temporary location OR has been modified since last disk write
    return currentProject.isTemporary || currentProject.isDirty;
  };

  return (
    <CurrentProjectContext.Provider value={{ currentProject, setCurrentProject, updateProject, clearDirtyFlag, markAsPermanent, hasUnsavedChanges }}>
      {children}
    </CurrentProjectContext.Provider>
  );
};

export function useCurrentProject() {
  const ctx = useContext(CurrentProjectContext);
  if (!ctx) throw new Error("useCurrentProject must be used within a CurrentProjectProvider");
  return ctx;
}
