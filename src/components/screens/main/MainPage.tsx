import { useCurrentProject } from "@/state/historyStore.tsx";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useWindowCloseHandler } from "@/hooks/useWindowCloseHandler";
import { useSaveProjectAs } from "@/lib/project.queries";
import { SaveProjectDialog } from "@/components/modals/SaveProjectDialog";
import { ConfirmCloseDialog } from "@/components/modals/ConfirmCloseDialog";
import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { remove } from "@tauri-apps/plugin-fs";
import { WINDOW_CLOSE_DELAY, APP_FOLDER } from "@/lib/constants";

export function MainPage() {
  const { currentProject, markAsSaved } = useCurrentProject();
  const navigate = useNavigate();
  const saveProjectMutation = useSaveProjectAs();
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showConfirmClose, setShowConfirmClose] = useState(false);
  const [shouldCloseAfterSave, setShouldCloseAfterSave] = useState(false);

  // Enable auto-save for the current project
  useAutoSave();

  // Memoize the close requested callback to prevent effect re-runs
  const handleCloseRequested = useCallback(() => {
    setShowConfirmClose(true);
  }, []);

  // Handle window close requests
  const { allowClose } = useWindowCloseHandler(
    !currentProject?.isSaved,
    handleCloseRequested
  );

  useEffect(() => {
    // Redirect to start screen if no project is loaded
    if (!currentProject) {
      navigate("/");
    }
  }, [currentProject, navigate]);

  const handleSave = async (projectName: string) => {
    if (!currentProject) return;

    try {
      const result = await saveProjectMutation.mutateAsync({
        projectName,
        currentPath: currentProject.historyEntry.path,
      });

      if (result) {
        // Update the current project with the new path and mark as saved
        markAsSaved({
          name: result.project.name,
          path: result.newPath,
          date: new Date().toISOString(),
        });
        setShowSaveDialog(false);

        // If we should close after save, do it now
        if (shouldCloseAfterSave) {
          allowClose();
          setTimeout(async () => {
            const appWindow = getCurrentWindow();
            await appWindow.close();
          }, WINDOW_CLOSE_DELAY);
        }
      }
    } catch (error) {
      console.error("Failed to save project:", error);
      setShouldCloseAfterSave(false);
    }
  };

  const handleSaveAndClose = () => {
    setShowConfirmClose(false);
    setShouldCloseAfterSave(true);
    setShowSaveDialog(true);
  };

  const handleDiscardAndClose = async () => {
    try {
      // If project is unsaved, clean up the temporary folder
      if (currentProject && !currentProject.isSaved) {
        // Double-check it's a temp folder before deleting
        if (currentProject.historyEntry.path.includes(APP_FOLDER)) {
          try {
            await remove(currentProject.historyEntry.path, { recursive: true });
          } catch (error) {
            console.error("Failed to remove temporary folder:", error);
            // Continue even if deletion fails
          }
        }
      }
    } catch (error) {
      console.error("Error in cleanup:", error);
    }

    // Set the flag to allow close, then close
    allowClose();

    // Small delay to ensure the flag is set before close is triggered
    setTimeout(async () => {
      try {
        const appWindow = getCurrentWindow();
        await appWindow.close();
      } catch (error) {
        console.error("Failed to close window:", error);
      }
    }, WINDOW_CLOSE_DELAY);
  };

  const handleCancelClose = () => {
    setShowConfirmClose(false);
  };

  if (!currentProject) {
    return null;
  }

  return (
    <>
      <SaveProjectDialog
        isOpen={showSaveDialog}
        onSave={handleSave}
        onCancel={() => {
          setShowSaveDialog(false);
          setShouldCloseAfterSave(false);
        }}
        defaultName={currentProject.project.name}
        isPending={saveProjectMutation.isPending}
      />

      <ConfirmCloseDialog
        isOpen={showConfirmClose}
        onSave={handleSaveAndClose}
        onDiscard={handleDiscardAndClose}
        onCancel={handleCancelClose}
      />
    </>
  );
}
