import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useHotkeys } from "react-hotkeys-hook";
import { toast } from "sonner";
import { useProjectStore } from "@/state/projectStore";
import { useSaveProject, useSaveProjectAs } from "@/lib/project.queries";
import { discardTemporaryProject } from "@/lib/project";
import { useWindowCloseHandler } from "@/hooks/useWindowCloseHandler";
import { WINDOW_CLOSE_DELAY } from "@/lib/constants";

/**
 * Manages the full project save/close lifecycle for MainPage:
 * - Ctrl+S hotkey (in-place save or open Save As dialog for temporary projects)
 * - Save As dialog flow (temporary → permanent)
 * - Window close interception with save/discard prompt
 */
export function useProjectLifecycle() {
  const project = useProjectStore((s) => s.project);
  const folderPath = useProjectStore((s) => s.folderPath);
  const isTemporary = useProjectStore((s) => s.isTemporary);
  const isDirty = useProjectStore((s) => s.isDirty);
  const markAsPermanent = useProjectStore((s) => s.markAsPermanent);
  const navigate = useNavigate();

  const saveProjectMutation = useSaveProject();
  const saveProjectAsMutation = useSaveProjectAs();

  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showConfirmClose, setShowConfirmClose] = useState(false);
  const [shouldCloseAfterSave, setShouldCloseAfterSave] = useState(false);

  const handleCloseRequested = useCallback(() => {
    setShowConfirmClose(true);
  }, []);

  const { allowClose } = useWindowCloseHandler(
    isTemporary || isDirty,
    handleCloseRequested,
  );

  // Ctrl+S: in-place save for permanent projects, Save As dialog for temporary
  useHotkeys("ctrl+s, meta+s", () => {
    if (!project) return;

    if (isTemporary) {
      setShowSaveDialog(true);
      return;
    }

    if (!isDirty) return;

    if (folderPath) {
      saveProjectMutation.mutate({ folderPath, project });
    }
  });

  // Save As flow — used for temporary projects converting to permanent
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
    } catch {
      toast.error("Failed to save project. Please try again.");
      setShouldCloseAfterSave(false);
    }
  };

  const handleCancelSave = () => {
    setShowSaveDialog(false);
    setShouldCloseAfterSave(false);
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
      } catch {
        console.warn("Could not discard temporary project.");
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

  // Redirect to start screen if project is unloaded from under us
  useEffect(() => {
    if (!project) {
      toast.error("No project loaded. Returning to start screen.");
      navigate("/");
    }
  }, [project, navigate]);

  return {
    showSaveDialog,
    showConfirmClose,
    isSaveAsPending: saveProjectAsMutation.isPending,
    defaultSaveName: project?.name ?? "",
    handleSave,
    handleCancelSave,
    handleSaveAndClose,
    handleDiscardAndClose,
    handleCancelClose,
  };
}
