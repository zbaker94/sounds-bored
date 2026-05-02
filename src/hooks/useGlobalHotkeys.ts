import { useHotkeys } from "react-hotkeys-hook";
import { useUiStore, OVERLAY_ID } from "@/state/uiStore";
import { useProjectActions } from "@/contexts/ProjectActionsContext";
import { useProjectStore } from "@/state/projectStore";
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { executeFadeTap } from "@/lib/audio";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { buildPadMap, createDefaultStoreLayer } from "@/lib/padDefaults";
import type { PadConfig } from "@/lib/schemas";
import { PADS_PER_PAGE } from "@/lib/constants";

function enterMultiFadeFromHoverHotkey(): void {
  const { editMode, hoveredPadId, editingPadId, fadePopoverPadId } = useUiStore.getState();
  if (useMultiFadeStore.getState().active) return;
  if (editMode) return;
  if (!hoveredPadId || editingPadId || fadePopoverPadId) return;
  const scenes = useProjectStore.getState().project?.scenes ?? [];
  const pad = buildPadMap(scenes).get(hoveredPadId);
  useMultiFadeStore.getState().enterMultiFade(hoveredPadId, pad?.volume ?? 100, pad?.fadeTargetVol ?? 0);
}

function executeHoveredPadFade(
  hoveredPadId: string,
  fadePopoverPadId: string | null,
  fadePopoverTarget: number | null,
  setFadePopoverPadId: (id: string | null) => void,
  globalFadeDurationMs?: number,
): void {
  if (fadePopoverPadId !== hoveredPadId) {
    setFadePopoverPadId(hoveredPadId);
    return;
  }
  const project = useProjectStore.getState().project;
  const pad = buildPadMap(project?.scenes ?? []).get(hoveredPadId);
  if (!pad) return;
  if (fadePopoverTarget !== null) {
    const scene = project?.scenes.find((s) => s.pads.some((p) => p.id === hoveredPadId));
    if (scene) useProjectStore.getState().setPadFadeTarget(scene.id, hoveredPadId, fadePopoverTarget);
  }
  const effectivePad = fadePopoverTarget !== null ? { ...pad, fadeTargetVol: fadePopoverTarget } : pad;
  executeFadeTap(effectivePad, globalFadeDurationMs);
  setFadePopoverPadId(null);
}

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

  // F: configure/execute a fade on the relevant pad.
  //
  // Behavior matrix:
  //   multi-fade already active                                       → no-op (useMultiFadeSideEffects owns F)
  //   edit mode with editingPadId set                                 → execute fade for editingPadId immediately
  //                                                                     (do NOT exit edit mode, do NOT enter multi-fade)
  //   normal mode, hovering, fadePopoverPadId === hoveredPadId        → execute fade then close popover
  //   normal mode, hovering, no popover open                          → open popover for hovered pad (no fade yet)
  //   normal mode, not hovering                                       → no-op
  //
  // enableOnFormTags: the pad backside contains a fade-duration <Slider> (Radix renders
  // role="slider"), which is in react-hotkeys-hook's default form-tag block list.
  // Without this flag, pressing F while the slider thumb has focus is swallowed.
  useHotkeys("f", () => {
    if (useMultiFadeStore.getState().active) return;
    const { editMode, hoveredPadId, editingPadId, fadePopoverPadId, fadePopoverTarget, setFadePopoverPadId } = useUiStore.getState();
    const globalFadeDurationMs = useAppSettingsStore.getState().settings?.globalFadeDurationMs;

    // Edit mode with a pad being edited: immediately execute that pad's configured fade.
    if (editMode && editingPadId) {
      const pad = buildPadMap(useProjectStore.getState().project?.scenes ?? []).get(editingPadId);
      if (pad) executeFadeTap(pad, globalFadeDurationMs);
      return;
    }

    if (editMode || !hoveredPadId) return;

    // Normal mode: popover already open → execute fade + close popover.
    // Normal mode: no popover open → open popover for the hovered pad (no fade yet).
    executeHoveredPadFade(hoveredPadId, fadePopoverPadId, fadePopoverTarget, setFadePopoverPadId, globalFadeDurationMs);
  }, { enableOnFormTags: true });

  // X: enter multi-fade mode pre-selecting the hovered pad (mirrors X in the context popover).
  //
  // Behavior matrix:
  //   multi-fade already active           → handled by useMultiFadeMode's own hotkey; no-op here
  //   edit mode                           → no-op (edit mode and multi-fade must not co-exist)
  //   normal mode, hovering, no popover   → enter multi-fade pre-selecting the hovered pad
  //   normal mode, hovering, popover open → no-op (user is interacting with fade popover)
  //   normal mode, not hovering           → no-op
  //
  // enableOnFormTags: same reasoning as F above — the fade-level <Slider> in the
  // multi-fade overlay should not swallow this hotkey.
  useHotkeys("x", () => enterMultiFadeFromHoverHotkey(), { enableOnFormTags: true });

  // Shift+Left: previous page of the active scene's pad grid (wraps to last page).
  useHotkeys("shift+left", () => {
    const { activeSceneId } = useProjectStore.getState();
    const { pageByScene, setScenePage } = useUiStore.getState();
    if (!activeSceneId) return;
    const pads = useProjectStore.getState().project?.scenes.find((s) => s.id === activeSceneId)?.pads ?? [];
    const totalPages = Math.max(1, Math.ceil(pads.length / PADS_PER_PAGE));
    const page = pageByScene[activeSceneId] ?? 0;
    const safePage = Math.min(page, totalPages - 1);
    setScenePage(activeSceneId, safePage > 0 ? safePage - 1 : totalPages - 1);
  }, { preventDefault: true });

  // Shift+Right: next page of the active scene's pad grid (wraps to first page).
  useHotkeys("shift+right", () => {
    const { activeSceneId } = useProjectStore.getState();
    const { pageByScene, setScenePage } = useUiStore.getState();
    if (!activeSceneId) return;
    const pads = useProjectStore.getState().project?.scenes.find((s) => s.id === activeSceneId)?.pads ?? [];
    const totalPages = Math.max(1, Math.ceil(pads.length / PADS_PER_PAGE));
    const page = pageByScene[activeSceneId] ?? 0;
    const safePage = Math.min(page, totalPages - 1);
    setScenePage(activeSceneId, safePage < totalPages - 1 ? safePage + 1 : 0);
  }, { preventDefault: true });

  // Mod+Shift+N: add a new pad to the active scene, navigate to its page, and flip it into edit mode.
  useHotkeys("mod+shift+n", () => {
    const { project, activeSceneId, addPad } = useProjectStore.getState();
    const { setEditingPadId, setScenePage } = useUiStore.getState();
    if (!activeSceneId || !project?.scenes.some((s) => s.id === activeSceneId)) return;
    const newId = crypto.randomUUID();
    const config: PadConfig = {
      name: "",
      layers: [createDefaultStoreLayer()],
      muteTargetPadIds: [],
    };
    addPad(activeSceneId, config, newId);
    const updatedScene = useProjectStore.getState().project?.scenes.find((s) => s.id === activeSceneId);
    if (updatedScene) {
      setScenePage(activeSceneId, Math.floor((updatedScene.pads.length - 1) / PADS_PER_PAGE));
    }
    setTimeout(() => setEditingPadId(newId), 0);
  }, { preventDefault: true });

  // 1-9: jump directly to scene by index.
  useHotkeys("1,2,3,4,5,6,7,8,9", (e) => {
    const { project, setActiveSceneId } = useProjectStore.getState();
    const scenes = project?.scenes ?? [];
    const idx = parseInt(e.key) - 1;
    if (idx < scenes.length) setActiveSceneId(scenes[idx].id);
  });

  // Alt+Left/Right: navigate between scenes with wrapping.
  // Bare Left/Right are intentionally NOT registered — they conflict with
  // arrow-key behavior in text inputs, comboboxes, sliders, and radio groups
  // (see issue #67). Alt avoids those conflicts for standard form elements
  // because react-hotkeys-hook's default form-tag guard suppresses firing
  // when focus is inside <input>/<textarea>/<select>.
  // Known tradeoffs:
  //   • macOS: Option+Arrow is word-caret navigation — but only in form inputs
  //     that the guard already protects, so no actual collision in practice.
  //   • Tauri webview: Alt+Left is the Chromium "Back" shortcut; we suppress
  //     it via preventDefault: true (the app has no in-webview history anyway).
  // Guard idx === -1: when activeSceneId is null or stale, fall back to the first scene.
  useHotkeys("alt+left", () => {
    const { project, activeSceneId, setActiveSceneId } = useProjectStore.getState();
    const scenes = project?.scenes ?? [];
    if (scenes.length < 2) return;
    const idx = scenes.findIndex((s) => s.id === activeSceneId);
    if (idx === -1) { setActiveSceneId(scenes[0].id); return; }
    setActiveSceneId(scenes[(idx - 1 + scenes.length) % scenes.length].id);
  }, { preventDefault: true /* suppress webview Alt+Left = Back */ });

  useHotkeys("alt+right", () => {
    const { project, activeSceneId, setActiveSceneId } = useProjectStore.getState();
    const scenes = project?.scenes ?? [];
    if (scenes.length < 2) return;
    const idx = scenes.findIndex((s) => s.id === activeSceneId);
    if (idx === -1) { setActiveSceneId(scenes[0].id); return; }
    setActiveSceneId(scenes[(idx + 1) % scenes.length].id);
  }, { preventDefault: true /* suppress webview Alt+Right = Forward */ });
}
