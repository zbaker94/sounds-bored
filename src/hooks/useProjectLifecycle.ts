import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useHotkeys } from "react-hotkeys-hook";
import { toast } from "sonner";
import { useProjectStore } from "@/state/projectStore";
import { useSaveProject } from "@/lib/project.queries";
import { useProjectActions } from "@/contexts/ProjectActionsContext";
import { discardTemporaryProject } from "@/lib/project";
import { useWindowCloseHandler } from "@/hooks/useWindowCloseHandler";
import { WINDOW_CLOSE_DELAY } from "@/lib/constants";

/**
 * Manages the window close lifecycle for MainPage:
 * - Ctrl+S hotkey (delegates to ProjectActionsProvider)
 * - Window close interception with save/discard prompt
 */
export function useProjectLifecycle() {
  const project = useProjectStore((s) => s.project);
  const folderPath = useProjectStore((s) => s.folderPath);
  const isTemporary = useProjectStore((s) => s.isTemporary);
  const isDirty = useProjectStore((s) => s.isDirty);
  const navigate = useNavigate();

  const saveProjectMutation = useSaveProject();
  const { handleSaveClick, requestSaveAndThen } = useProjectActions();

  const [showConfirmClose, setShowConfirmClose] = useState(false);

  const handleCloseRequested = useCallback(() => {
    setShowConfirmClose(true);
  }, []);

  const { allowClose } = useWindowCloseHandler(
    isTemporary || isDirty,
    handleCloseRequested,
  );

  useHotkeys("ctrl+s, meta+s", handleSaveClick);

  const closeWindow = useCallback(() => {
    allowClose();
    setTimeout(async () => {
      try {
        const appWindow = getCurrentWindow();
        await appWindow.close();
      } catch (error) {
        console.error("Failed to close window:", error);
      }
    }, WINDOW_CLOSE_DELAY);
  }, [allowClose]);

  const handleSaveAndClose = () => {
    setShowConfirmClose(false);
    requestSaveAndThen(closeWindow);
  };

  const handleDiscardAndClose = async () => {
    setShowConfirmClose(false);

    if (isTemporary && folderPath) {
      try {
        await discardTemporaryProject(folderPath);
      } catch {
        console.warn("Could not discard temporary project.");
      }
    }

    closeWindow();
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
    showConfirmClose,
    handleSaveAndClose,
    handleDiscardAndClose,
    handleCancelClose,
  };
}
