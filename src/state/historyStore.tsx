import React, { createContext, useContext, useState } from "react";
import { ProjectHistoryEntry, Project } from "@/lib/schemas";

interface CurrentProjectData {
  historyEntry: ProjectHistoryEntry;
  project: Project;
  isSaved: boolean; // Tracks whether the project has been saved to a permanent location
}

interface CurrentProjectContextType {
  currentProject: CurrentProjectData | null;
  setCurrentProject: (historyEntry: ProjectHistoryEntry, project?: Project, isSaved?: boolean) => void;
  updateProject: (project: Project) => void;
  markAsSaved: (historyEntry: ProjectHistoryEntry) => void;
}

const CurrentProjectContext = createContext<CurrentProjectContextType | undefined>(undefined);

export const CurrentProjectProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentProject, setCurrentProjectState] = useState<CurrentProjectData | null>(null);

  const setCurrentProject = (historyEntry: ProjectHistoryEntry, project?: Project, isSaved = false) => {
    setCurrentProjectState({
      historyEntry,
      project: project || { name: historyEntry.name },
      isSaved,
    });
  };

  const updateProject = (project: Project) => {
    if (currentProject) {
      setCurrentProjectState({
        ...currentProject,
        project,
      });
    }
  };

  const markAsSaved = (historyEntry: ProjectHistoryEntry) => {
    if (currentProject) {
      setCurrentProjectState({
        ...currentProject,
        historyEntry,
        isSaved: true,
      });
    }
  };

  return (
    <CurrentProjectContext.Provider value={{ currentProject, setCurrentProject, updateProject, markAsSaved }}>
      {children}
    </CurrentProjectContext.Provider>
  );
};

export function useCurrentProject() {
  const ctx = useContext(CurrentProjectContext);
  if (!ctx) throw new Error("useCurrentProject must be used within a CurrentProjectProvider");
  return ctx;
}
