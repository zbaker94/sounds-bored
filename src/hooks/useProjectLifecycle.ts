import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "sonner";
import { useProjectStore } from "@/state/projectStore";
import { useLibraryStore } from "@/state/libraryStore";
import { useProjectActions } from "@/contexts/ProjectActionsContext";
import { discardTemporaryProject } from "@/lib/project";
import { useUiStore, OVERLAY_ID } from "@/state/uiStore";
import { useWindowCloseHandler } from "@/hooks/useWindowCloseHandler";
import { WINDOW_CLOSE_DELAY } from "@/lib/constants";

/**
 * Manages the window close lifecycle for MainPage:
 * - Window close interception with save/discard prompt
 * Hotkeys (Ctrl+S, Esc, Ctrl+Shift+M, etc.) live in useGlobalHotkeys.
 */
export function useProjectLifecycle() {
  const project = useProjectStore((s) => s.project);
  const folderPath = useProjectStore((s) => s.folderPath);
  const isTemporary = useProjectStore((s) => s.isTemporary);
  const isDirty = useProjectStore((s) => s.isDirty);
  const navigate = useNavigate();

  const missingSoundIds = useLibraryStore((s) => s.missingSoundIds);
  const lastNotifiedProjectKey = useRef<string | null>(null);

  const { requestSaveAndThen } = useProjectActions();

  const showConfirmClose = useUiStore((s) => s.isOverlayOpen(OVERLAY_ID.CONFIRM_CLOSE_DIALOG));
  const openOverlay = useUiStore((s) => s.openOverlay);
  const closeOverlay = useUiStore((s) => s.closeOverlay);

  const handleCloseRequested = useCallback(() => {
    openOverlay(OVERLAY_ID.CONFIRM_CLOSE_DIALOG, "dialog");
  }, [openOverlay]);

  const { allowClose } = useWindowCloseHandler(
    isTemporary || isDirty,
    handleCloseRequested,
  );

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
    closeOverlay(OVERLAY_ID.CONFIRM_CLOSE_DIALOG);
    requestSaveAndThen(closeWindow);
  };

  const handleDiscardAndClose = async () => {
    closeOverlay(OVERLAY_ID.CONFIRM_CLOSE_DIALOG);

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
    closeOverlay(OVERLAY_ID.CONFIRM_CLOSE_DIALOG);
  };

  // Notify user if missing sounds are used in the loaded project
  useEffect(() => {
    if (!project || missingSoundIds.size === 0) return;

    const projectKey = project.name + (project.lastSaved ?? "");
    if (lastNotifiedProjectKey.current === projectKey) return;
    lastNotifiedProjectKey.current = projectKey;

    const usedSoundIds = new globalThis.Set(
      project.scenes.flatMap((scene) =>
        scene.pads.flatMap((pad) =>
          pad.layers.flatMap((layer) =>
            layer.selection.type === "assigned"
              ? layer.selection.instances.map((i) => i.soundId)
              : [],
          ),
        ),
      ),
    );

    const missingUsedCount = [...usedSoundIds].filter((id) => missingSoundIds.has(id)).length;
    if (missingUsedCount > 0) {
      toast.warning(
        `${missingUsedCount} sound${missingUsedCount > 1 ? "s" : ""} used in this project are missing. Check the Sounds panel.`,
      );
    }
  }, [project, missingSoundIds]);

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
