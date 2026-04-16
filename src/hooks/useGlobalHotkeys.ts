import { useHotkeys } from "react-hotkeys-hook";
import { useUiStore, OVERLAY_ID } from "@/state/uiStore";
import { useProjectActions } from "@/contexts/ProjectActionsContext";
import { useProjectStore } from "@/state/projectStore";
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { usePlaybackStore } from "@/state/playbackStore";
import { isPadActive } from "@/lib/audio/audioState";
import { fadePadWithLevels, resolveFadeDuration } from "@/lib/audio/padPlayer";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { toast } from "sonner";

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

  // Shared edit-mode exit handler for F and X hotkeys.
  // Both Zustand set() calls notify subscribers synchronously, so by the time React's deferred
  // effects run, editMode=false and active=true are already committed — the useMultiFadeMode
  // "cancel when editMode && active" effect sees both at once and does not cancel.
  function exitEditModeWithHover(hoveredPadId: string | null) {
    useUiStore.getState().toggleEditMode();
    const { enterMultiFade, enterMultiFadeEmpty } = useMultiFadeStore.getState();
    if (hoveredPadId) {
      const playing = isPadActive(hoveredPadId);
      const vol = usePlaybackStore.getState().padVolumes[hoveredPadId] ?? 1.0;
      enterMultiFade(hoveredPadId, playing, vol);
    } else {
      enterMultiFadeEmpty();
    }
  }

  // F: immediate single fade on the hovered pad (mirrors F in the context popover).
  //
  // Behavior matrix:
  //   multi-fade already active           → handled by useMultiFadeMode's own hotkey; no-op here
  //   edit mode, hovering a pad           → exit edit mode + enter multi-fade for that pad
  //   edit mode, not hovering             → exit edit mode + enter multi-fade empty
  //   normal mode, hovering, no popover   → single-fade the hovered pad immediately
  //   normal mode, hovering, popover open → no-op (user is interacting with context popover)
  //   normal mode, not hovering           → no-op
  //
  // enableOnFormTags: the pad backside contains a fade-duration <Slider> (Radix renders
  // role="slider"), which is in react-hotkeys-hook's default form-tag block list.
  // Without this flag, pressing F while the slider thumb has focus is swallowed.
  useHotkeys("f", () => {
    const { editMode, hoveredPadId, padPopoverOpenId } = useUiStore.getState();
    if (useMultiFadeStore.getState().active) return;

    if (editMode) {
      exitEditModeWithHover(hoveredPadId);
      return;
    }

    // Normal mode: single-fade the hovered pad if no context popover is open
    if (hoveredPadId && !padPopoverOpenId) {
      const pads = useProjectStore.getState().project?.scenes.flatMap((s) => s.pads) ?? [];
      const pad = pads.find((p) => p.id === hoveredPadId);
      if (!pad) return;
      const vol = usePlaybackStore.getState().padVolumes[hoveredPadId] ?? 1.0;
      const globalFadeDurationMs = useAppSettingsStore.getState().settings?.globalFadeDurationMs;
      const duration = resolveFadeDuration(pad, globalFadeDurationMs);
      fadePadWithLevels(pad, duration, 0, vol).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`Playback error: audio fade failed — ${message}`);
      });
    }
  }, { enableOnFormTags: true });

  // X: enter multi-fade mode pre-selecting the hovered pad (mirrors X in the context popover).
  //
  // Behavior matrix:
  //   multi-fade already active           → handled by useMultiFadeMode's own hotkey; no-op here
  //   edit mode, hovering a pad           → exit edit mode + enter multi-fade for that pad
  //   edit mode, not hovering             → exit edit mode + enter multi-fade empty
  //   normal mode, hovering, no popover   → enter multi-fade pre-selecting the hovered pad
  //   normal mode, hovering, popover open → no-op (user is interacting with context popover)
  //   normal mode, not hovering           → no-op
  //
  // enableOnFormTags: same reasoning as F above — the fade-level <Slider> in the
  // multi-fade overlay should not swallow this hotkey.
  useHotkeys("x", () => {
    const { editMode, hoveredPadId, padPopoverOpenId } = useUiStore.getState();
    if (useMultiFadeStore.getState().active) return;

    if (editMode) {
      exitEditModeWithHover(hoveredPadId);
      return;
    }

    // Normal mode: enter multi-fade if hovering a pad and no context popover is open
    if (hoveredPadId && !padPopoverOpenId) {
      const playing = isPadActive(hoveredPadId);
      const vol = usePlaybackStore.getState().padVolumes[hoveredPadId] ?? 1.0;
      useMultiFadeStore.getState().enterMultiFade(hoveredPadId, playing, vol);
    }
  }, { enableOnFormTags: true });

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
