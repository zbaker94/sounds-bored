import { useEffect, useRef } from "react";
import { Navigate } from "react-router-dom";
import { useProjectStore } from "@/state/projectStore";
import { usePlaybackStore } from "@/state/playbackStore";
import { usePadDisplayStore } from "@/state/padDisplayStore";
import { clearAllAudioState, clearAllBuffers, clearAllStreamingElements, clearAllSizeCache, stopAudioTick, stopPreview } from "@/lib/audio";
import { SceneTabBar } from "@/components/composite/SceneTabBar/SceneTabBar";
import { SceneView } from "@/components/composite/SceneView/SceneView";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useProjectLifecycle } from "@/hooks/useProjectLifecycle";
import { useProjectSoundReconcileOnLoad } from "@/hooks/useProjectSoundReconcileOnLoad";
import { useMissingSoundsNotification } from "@/hooks/useMissingSoundsNotification";
import { useGlobalHotkeys } from "@/hooks/useGlobalHotkeys";
import { useReconcileLibrary } from "@/hooks/useReconcileLibrary";
import { useAudioErrorHandler } from "@/hooks/useAudioErrorHandler";
import { useDownloadEventListener } from "@/hooks/useDownloadEventListener";
import { useDownloadHistorySync } from "@/hooks/useDownloadHistorySync";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { ConfirmCloseDialog } from "@/components/modals/ConfirmCloseDialog";
import { SidePanel } from "@/components/composite/SidePanel/SidePanel";
import { ProjectActionsProvider } from "@/contexts/ProjectActionsContext";
import { ProjectDialogs } from "@/components/modals/ProjectDialogs";

export function MainPage() {
  const project = useProjectStore((s) => s.project);

  if (!project) {
    return <Navigate to="/" replace />;
  }

  return (
    <ProjectActionsProvider>
      <MainPageInner />
      <ProjectDialogs />
    </ProjectActionsProvider>
  );
}

function MainPageInner() {
  useAutoSave();
  useGlobalHotkeys();
  useProjectSoundReconcileOnLoad();
  useMissingSoundsNotification();
  useAudioErrorHandler();
  const downloadFolderId = useAppSettingsStore((s) => s.settings?.downloadFolderId);
  useDownloadEventListener(downloadFolderId);
  useDownloadHistorySync();

  const { reconcile } = useReconcileLibrary();
  // Ref-wrap reconcile so the mount-only effect below always calls the latest
  // version without needing reconcile in its deps (which would retrigger on
  // every settings change — e.g. on each drag step of the fade slider).
  const reconcileRef = useRef(reconcile);
  useEffect(() => {
    reconcileRef.current = reconcile;
  }, [reconcile]);

  useEffect(() => {
    return () => {
      stopAudioTick();
      clearAllAudioState();
      usePlaybackStore.getState().clearAllPlayingPads();
      usePadDisplayStore.getState().clearAllPadDisplays();
      // Stop any active sound preview. preview.ts manages its own module-level
      // state (currentSource, previewRafId) outside clearAllAudioState's scope,
      // so it must be torn down explicitly here.
      stopPreview();
      // Release decoded PCM memory from the closed project and discard pre-buffered
      // HTMLAudioElements so they do not accumulate across project switches.
      // These caches live outside audioState's pure-state-container boundary, so
      // the orchestrating caller (this component) owns clearing them.
      clearAllBuffers();
      clearAllStreamingElements();
      clearAllSizeCache();
    };
  }, []);

  // Mount-time reconcile. The singleton guard in useReconcileLibrary prevents
  // duplicate runs if reconcile fires more than once.
  useEffect(() => {
    reconcileRef.current();
  }, []);

  const {
    showConfirmClose,
    handleSaveAndClose,
    handleDiscardAndClose,
    handleCancelClose,
  } = useProjectLifecycle();

  return (
    <>
      <div id="main-page" className="w-full h-screen flex flex-col md:flex-row">
        <div className="flex flex-col flex-1 min-h-0 min-w-0">
          <SceneTabBar />
          <SceneView />
        </div>
        <SidePanel />
      </div>
      <ConfirmCloseDialog
        isOpen={showConfirmClose}
        onSave={handleSaveAndClose}
        onDiscard={handleDiscardAndClose}
        onCancel={handleCancelClose}
      />
    </>
  );
}
