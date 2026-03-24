import { useHotkeys } from "react-hotkeys-hook";
import { useUiStore, OVERLAY_ID } from "@/state/uiStore";
import { useProjectActions } from "@/contexts/ProjectActionsContext";

/**
 * All keyboard shortcuts for the main editor in one place.
 * Must be called inside ProjectActionsProvider.
 */
export function useGlobalHotkeys() {
  const { handleSaveClick } = useProjectActions();

  // Esc: toggle the menu drawer when nothing is open, otherwise close the topmost overlay.
  useHotkeys("esc", () => {
    const { overlayStack, closeOverlay, toggleOverlay } = useUiStore.getState();
    const top = overlayStack[overlayStack.length - 1];
    if (top) {
      closeOverlay(top.id);
    } else {
      toggleOverlay(OVERLAY_ID.MENU_DRAWER, "drawer");
    }
  });

  // Ctrl+Shift+M: toggle the sounds panel, but not when another overlay is on top.
  useHotkeys("mod+shift+m", () => {
    const { hasOpenOverlay, isTopOverlay, toggleOverlay } = useUiStore.getState();
    if (!hasOpenOverlay() || isTopOverlay(OVERLAY_ID.SOUNDS_PANEL)) {
      toggleOverlay(OVERLAY_ID.SOUNDS_PANEL, "dialog");
    }
  });

  // Ctrl+S: save, but not when the Save dialog is already open.
  useHotkeys("mod+s", () => {
    if (!useUiStore.getState().isTopOverlay(OVERLAY_ID.SAVE_PROJECT_DIALOG)) {
      handleSaveClick();
    }
  });
}
