import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  selectAndLoadProject,
  createNewProject,
  saveProject,
  saveProjectAs,
  loadProjectFromPath,
  ProjectNotFoundError,
  ProjectValidationError,
} from "./project";
import type { Project } from "./schemas";
import { toast } from "sonner";
import { useProjectStore } from "@/state/projectStore";
import { addOrUpdateProjectInHistory, addSavedProjectToHistory, removeProjectFromHistory } from "./history.helpers";
import { APP_FOLDER } from "./constants";

export function useLoadProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: selectAndLoadProject,
    onSuccess: async (data) => {
      if (data) {
        try {
          await addOrUpdateProjectInHistory(data.project.name, data.folderPath);
          queryClient.invalidateQueries({ queryKey: ["projectHistory"] });

          toast.success("Project Loaded", {
            description: `Successfully loaded "${data.project.name}"`,
          });
        } catch (error) {
          console.error("Failed to update project history:", error);
          toast.success("Project Loaded", {
            description: `Successfully loaded "${data.project.name}"`,
          });
        }
      }
    },
    onError: (error) => {
      if (error instanceof ProjectNotFoundError) {
        toast.error("Project Not Found", {
          description: "No project.json file found in the selected folder.",
        });
      } else if (error instanceof ProjectValidationError) {
        toast.error("Invalid Project", {
          description: error.message,
        });
      } else {
        toast.error("Error", {
          description: "Failed to load project. Please try again.",
        });
        console.error("Failed to load project:", error);
      }
    },
  });
}

export function useCreateProject() {
  return useMutation({
    mutationFn: createNewProject,
    onSuccess: async () => {
      toast.success("Project Created", {
        description: `New project created. Remember to save!`,
      });
    },
    onError: (error) => {
      toast.error("Error", {
        description: error instanceof Error ? error.message : "Failed to create project. Please try again.",
      });
      console.error("Failed to create project:", error);
    },
  });
}

export function useSaveProject() {
  const clearDirtyFlag = useProjectStore((s) => s.clearDirtyFlag);

  return useMutation({
    mutationFn: ({ folderPath, project }: { folderPath: string; project: Project }) =>
      saveProject(folderPath, project),
    onSuccess: () => {
      clearDirtyFlag();
      toast.success("Project saved");
    },
    onError: (error) => {
      toast.error("Failed to save project. Please try again.");
      console.error("Failed to save project:", error);
    },
  });
}

export function useSaveProjectAs() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectName, currentPath, project }: { projectName: string; currentPath: string; project: Project }) =>
      saveProjectAs(projectName, currentPath, project),
    onSuccess: async (data) => {
      if (data) {
        try {
          await addSavedProjectToHistory(data.project.name, data.newPath, APP_FOLDER);
          queryClient.invalidateQueries({ queryKey: ["projectHistory"] });

          toast.success("Project Saved", {
            description: `Successfully saved "${data.project.name}"`,
          });
        } catch (error) {
          console.error("Failed to update project history:", error);
          toast.warning("Project Saved", {
            description: "File saved but history could not be updated.",
          });
        }
      }
    },
    onError: (error) => {
      toast.error("Error", {
        description: error instanceof Error ? error.message : "Failed to save project. Please try again.",
      });
      console.error("Failed to save project:", error);
    },
  });
}

/**
 * Hook to load a project from a specific path (e.g., from recent projects)
 */
export function useLoadProjectFromPath() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: loadProjectFromPath,
    onSuccess: async (data) => {
      if (data) {
        try {
          await addOrUpdateProjectInHistory(data.project.name, data.folderPath);
          queryClient.invalidateQueries({ queryKey: ["projectHistory"] });

          toast.success("Project Loaded", {
            description: `Successfully loaded "${data.project.name}"`,
          });
        } catch (error) {
          console.error("Failed to update project history:", error);
          toast.success("Project Loaded", {
            description: `Successfully loaded "${data.project.name}"`,
          });
        }
      }
    },
    onError: async (error, variables) => {
      if (error instanceof ProjectNotFoundError) {
        // Remove the missing project from history
        try {
          await removeProjectFromHistory(variables);
          queryClient.invalidateQueries({ queryKey: ["projectHistory"] });
        } catch (historyError) {
          console.error("Failed to remove project from history:", historyError);
        }

        toast.error("Project Not Found", {
          description: "The project file could not be found. Removed from recent projects.",
        });
      } else if (error instanceof ProjectValidationError) {
        toast.error("Invalid Project", {
          description: error.message,
        });
      } else {
        toast.error("Error", {
          description: "Failed to load project. Please try again.",
        });
        console.error("Failed to load project:", error);
      }
    },
  });
}
