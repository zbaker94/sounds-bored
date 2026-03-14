import { useProjectStore } from "@/state/projectStore";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useWindowCloseHandler } from "@/hooks/useWindowCloseHandler";
import { useSaveProjectAs } from "@/lib/project.queries";
import { discardTemporaryProject } from "@/lib/project";
import { SaveProjectDialog } from "@/components/modals/SaveProjectDialog";
import { ConfirmCloseDialog } from "@/components/modals/ConfirmCloseDialog";
import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WINDOW_CLOSE_DELAY } from "@/lib/constants";
import { toast } from "sonner";

export function MainPage() {
  const project = useProjectStore((s) => s.project);
  const folderPath = useProjectStore((s) => s.folderPath);
  const isTemporary = useProjectStore((s) => s.isTemporary);
  const isDirty = useProjectStore((s) => s.isDirty);
  const markAsPermanent = useProjectStore((s) => s.markAsPermanent);
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
    isTemporary || isDirty,
    handleCloseRequested
  );

  useEffect(() => {
    // Redirect to start screen if no project is loaded
    if (!project) {
      toast.error("No project loaded. Returning to start screen.");
      navigate("/");
    }
  }, [project, navigate]);

  const handleSave = async (projectName: string) => {
    if (!project || !folderPath) return;

    try {
      const result = await saveProjectMutation.mutateAsync({
        projectName,
        currentPath: folderPath,
        project,
      });

      if (result) {
        markAsPermanent({
          name: result.project.name,
          path: result.newPath,
          date: new Date().toISOString(),
        });
        setShowSaveDialog(false);

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
    if (isTemporary && folderPath) {
      try {
        await discardTemporaryProject(folderPath);
      } catch (error) {
        console.warn("Could not discard temporary project:", error);
      }
    }

    allowClose();

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

  if (!project) {
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
        defaultName={project.name}
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
