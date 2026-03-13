import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  selectAndLoadProject,
  createNewProject,
  saveProjectAs,
  loadProjectFromPath,
  ProjectNotFoundError,
  ProjectValidationError,
} from "./project";
import { toast } from "sonner";
import { addOrUpdateProjectInHistory, addSavedProjectToHistory } from "./history.helpers";
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
    onSuccess: async (data) => {
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

export function useSaveProjectAs() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectName, currentPath }: { projectName: string; currentPath: string }) =>
      saveProjectAs(projectName, currentPath),
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
          toast.success("Project Saved", {
            description: `Successfully saved "${data.project.name}"`,
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
    onError: (error) => {
      if (error instanceof ProjectNotFoundError) {
        toast.error("Project Not Found", {
          description: "The project file could not be found.",
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
