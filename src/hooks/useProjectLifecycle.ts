import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "sonner";
import { useProjectStore } from "@/state/projectStore";
import { useLibraryStore } from "@/state/libraryStore";
import { useProjectActions } from "@/contexts/ProjectActionsContext";
import { discardTemporaryProject } from "@/lib/project";
import { useUiStore, OVERLAY_ID, selectIsOverlayOpen } from "@/state/uiStore";
import { useWindowCloseHandler } from "@/hooks/useWindowCloseHandler";
import { WINDOW_CLOSE_DELAY } from "@/lib/constants";
import { applyProjectSoundReconcile } from "@/lib/project.reconcile";

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
  // loadSessionId increments only on loadProject, not on markAsPermanent (Save As).
  // Used as a stable per-session dedup key that doesn't rotate when folderPath changes.
  const loadSessionId = useProjectStore((s) => s.loadSessionId);
  const navigate = useNavigate();

  const missingSoundIds = useLibraryStore((s) => s.missingSoundIds);
  const lastNotifiedSessionId = useRef<number | null>(null);

  const { requestSaveAndThen } = useProjectActions();

  const showConfirmClose = useUiStore(selectIsOverlayOpen(OVERLAY_ID.CONFIRM_CLOSE_DIALOG));
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

  // Tracks whether the current close/discard was initiated intentionally by the user.
  // Set to true inside close handlers so the guard effect below suppresses the
  // false-alarm "No project loaded" toast and redirect that would otherwise fire
  // when the store is cleared before the window closes. Auto-resets on the next
  // project load so the guard re-arms correctly if the component survives a
  // project-switch without unmounting.
  const closingIntentionallyRef = useRef(false);

  const handleSaveAndClose = () => {
    closingIntentionallyRef.current = true;
    closeOverlay(OVERLAY_ID.CONFIRM_CLOSE_DIALOG);
    requestSaveAndThen(closeWindow);
  };

  const handleDiscardAndClose = async () => {
    closingIntentionallyRef.current = true;
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

  const cleanedSessionIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!project) return;
    if (cleanedSessionIdRef.current === loadSessionId) return;
    cleanedSessionIdRef.current = loadSessionId;

    applyProjectSoundReconcile();
  }, [project, loadSessionId]);

  // Notify user if missing sounds are used in the loaded project.
  // Fires at most once per project-load session — Save As (markAsPermanent) does
  // not increment loadSessionId and therefore does not re-trigger this toast.
  useEffect(() => {
    if (!project || missingSoundIds.size === 0) return;
    if (lastNotifiedSessionId.current === loadSessionId) return;
    lastNotifiedSessionId.current = loadSessionId;

    const usedSoundIds = new Set(
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
  }, [project, missingSoundIds, loadSessionId]);

  // Guard: project unexpectedly null while MainPage is mounted.
  // Re-arm the flag when a new project loads so the guard works across
  // project-switch flows that don't unmount this hook.
  // When the close is intentional, suppress both the error toast AND the
  // navigate — the close handlers drive their own navigation/window-close.
  useEffect(() => {
    if (project) {
      closingIntentionallyRef.current = false;
      return;
    }
    if (!closingIntentionallyRef.current) {
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
