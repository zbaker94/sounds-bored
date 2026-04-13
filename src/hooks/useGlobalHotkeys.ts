import { useHotkeys } from "react-hotkeys-hook";
import { useUiStore, OVERLAY_ID } from "@/state/uiStore";
import { useProjectActions } from "@/contexts/ProjectActionsContext";
import { useProjectStore } from "@/state/projectStore";
import { useMultiFadeStore } from "@/state/multiFadeStore";

/**
 * All keyboard shortcuts for the main editor in one place.
 * Must be called inside ProjectActionsProvider.
 */
export function useGlobalHotkeys() {
  const { handleSaveClick, handleSaveAsMenuClick, handleExportClick } = useProjectActions();

  // Esc: toggle the menu drawer when nothing is open, otherwise close the topmost overlay.
  // enableOnFormTags: the global Esc handler owns escape for all overlays, including dialogs
  // with focused inputs (e.g. PadConfigDrawer's name field).
  // Exception: EXPORT_PROGRESS_DIALOG is non-dismissible — it owns its own Esc handling.
  // Also: Multi-fade mode owns escape — its useHotkeys handler in useMultiFadeMode
  // cancels the fade. Don't also open the menu drawer.
  useHotkeys("esc", () => {
    if (useMultiFadeStore.getState().active) return;
    const { overlayStack, closeOverlay, toggleOverlay } = useUiStore.getState();
    const top = overlayStack[overlayStack.length - 1];
    if (top) {
      if (top.id === OVERLAY_ID.EXPORT_PROGRESS_DIALOG) return;
      closeOverlay(top.id);
    } else {
      toggleOverlay(OVERLAY_ID.MENU_DRAWER, "drawer");
    }
  }, { enableOnFormTags: true });

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

  // Ctrl+Shift+S: Save As.
  useHotkeys("mod+shift+s", () => {
    if (!useUiStore.getState().isOverlayOpen(OVERLAY_ID.EXPORT_PROGRESS_DIALOG)) {
      handleSaveAsMenuClick();
    }
  }, {}, [handleSaveAsMenuClick]);

  // Ctrl+Shift+E: Export. No-op if export is already in progress.
  useHotkeys("mod+shift+e", () => {
    if (!useUiStore.getState().isOverlayOpen(OVERLAY_ID.EXPORT_PROGRESS_DIALOG)) {
      handleExportClick();
    }
  }, { preventDefault: true });

  // Mod+E: toggle edit mode.
  useHotkeys("mod+e", () => {
    useUiStore.getState().toggleEditMode();
  });

  // F or X in edit mode: exit edit mode and enter multi-fade with no pre-selected pad.
  // Both store mutations happen in the same synchronous call so React 18 batches them —
  // the useMultiFadeMode "cancel when editMode && active" effect sees editMode=false
  // in the same render and does not cancel.
  useHotkeys("f,x", () => {
    const { editMode, toggleEditMode } = useUiStore.getState();
    const { active: multiFadeActive, enterMultiFadeEmpty } = useMultiFadeStore.getState();
    if (!editMode || multiFadeActive) return;
    toggleEditMode();
    enterMultiFadeEmpty();
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
