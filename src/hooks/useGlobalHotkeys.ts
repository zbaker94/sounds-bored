import { useHotkeys } from "react-hotkeys-hook";
import { useUiStore, OVERLAY_ID } from "@/state/uiStore";
import { useProjectActions } from "@/contexts/ProjectActionsContext";
import { useProjectStore } from "@/state/projectStore";

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

  // Mod+Shift+N: open the pad config drawer for the active scene.
  useHotkeys("mod+shift+n", () => {
    const { project, activeSceneId } = useProjectStore.getState();
    if (activeSceneId && project?.scenes.some((s) => s.id === activeSceneId)) {
      useUiStore.getState().openOverlay(OVERLAY_ID.PAD_CONFIG_DRAWER, "dialog");
    }
  });

  // 1-9: jump directly to scene by index.
  useHotkeys("1,2,3,4,5,6,7,8,9", (e) => {
    const { project, setActiveSceneId } = useProjectStore.getState();
    const scenes = project?.scenes ?? [];
    const idx = parseInt(e.key) - 1;
    if (idx < scenes.length) setActiveSceneId(scenes[idx].id);
  });

  // Shift+Left/Right: navigate between scenes with wrapping.
  useHotkeys("left", () => {
    const { project, activeSceneId, setActiveSceneId } = useProjectStore.getState();
    const scenes = project?.scenes ?? [];
    if (scenes.length < 2) return;
    const idx = scenes.findIndex((s) => s.id === activeSceneId);
    setActiveSceneId(scenes[(idx - 1 + scenes.length) % scenes.length].id);
  }, { preventDefault: true });

  useHotkeys("right", () => {
    const { project, activeSceneId, setActiveSceneId } = useProjectStore.getState();
    const scenes = project?.scenes ?? [];
    if (scenes.length < 2) return;
    const idx = scenes.findIndex((s) => s.id === activeSceneId);
    setActiveSceneId(scenes[(idx + 1) % scenes.length].id);
  }, { preventDefault: true });
}
