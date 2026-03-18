import { useProjectStore } from "@/state/projectStore";
import { SceneTabBar } from "@/components/composite/SceneTabBar/SceneTabBar";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useWindowCloseHandler } from "@/hooks/useWindowCloseHandler";
import { useSaveProject, useSaveProjectAs } from "@/lib/project.queries";
import { discardTemporaryProject } from "@/lib/project";
import { SaveProjectDialog } from "@/components/modals/SaveProjectDialog";
import { ConfirmCloseDialog } from "@/components/modals/ConfirmCloseDialog";
import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WINDOW_CLOSE_DELAY } from "@/lib/constants";
import { toast } from "sonner";
import { SidePanel } from "@/components/composite/SidePanel/SidePanel";

import { useHotkeys } from 'react-hotkeys-hook';

export function MainPage() {
  const project = useProjectStore((s) => s.project);
  const folderPath = useProjectStore((s) => s.folderPath);
  const isTemporary = useProjectStore((s) => s.isTemporary);
  const isDirty = useProjectStore((s) => s.isDirty);
  const markAsPermanent = useProjectStore((s) => s.markAsPermanent);
  const navigate = useNavigate();
  const saveProjectAsMutation = useSaveProjectAs();
  const saveProjectMutation = useSaveProject();
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showConfirmClose, setShowConfirmClose] = useState(false);
  const [shouldCloseAfterSave, setShouldCloseAfterSave] = useState(false);

  // Register hotkeys for managing project
  useHotkeys('ctrl+s, meta+s', () => {
    if (!project) return;

    if (isTemporary) {
      setShowSaveDialog(true);
      return;
    }

    if(!isDirty) {
      return;
    }

    if (folderPath) {
      saveProjectMutation.mutate({ folderPath, project });
    }
  });


  // Enable auto-save for the current project
  useAutoSave();

  // Memoize the close requested callback to prevent effect re-runs
  const handleCloseRequested = useCallback(() => {
    setShowConfirmClose(true);
  }, []);

  // Handle window close requests
  const { allowClose } = useWindowCloseHandler(
    isTemporary || isDirty,
    handleCloseRequested,
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
      const result = await saveProjectAsMutation.mutateAsync({
        projectName,
        currentPath: folderPath,
        project,
      });

      if (result) {
        markAsPermanent(
          {
            name: result.project.name,
            path: result.newPath,
            date: new Date().toISOString(),
          },
          result.project,
        );
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
      toast.error("Failed to save project. Please try again.");
      setShouldCloseAfterSave(false);
    }
  };

  const handleSaveAndClose = () => {
    setShowConfirmClose(false);

    if (isTemporary) {
      setShouldCloseAfterSave(true);
      setShowSaveDialog(true);
      return;
    }

    if (folderPath && project) {
      saveProjectMutation.mutate({ folderPath, project }, {
        onSuccess: () => {
          allowClose();
          setTimeout(async () => {
            const appWindow = getCurrentWindow();
            await appWindow.close();
          }, WINDOW_CLOSE_DELAY);
        },
      });
    }
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
      <div id="main-page" className="w-full h-screen flex flex-col md:flex-row">
        <div className="flex flex-col flex-1 min-h-0 min-w-0">
          <SceneTabBar />
        </div>
        <SidePanel />
      </div>
      <SaveProjectDialog
        isOpen={showSaveDialog}
        onSave={handleSave}
        onCancel={() => {
          setShowSaveDialog(false);
          setShouldCloseAfterSave(false);
        }}
        defaultName={project.name}
        isPending={saveProjectAsMutation.isPending}
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
