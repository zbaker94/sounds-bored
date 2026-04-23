import { useEffect, useRef } from "react";
import { Navigate } from "react-router-dom";
import { useProjectStore } from "@/state/projectStore";
import { clearAllAudioState } from "@/lib/audio/audioState";
import { clearAllBuffers } from "@/lib/audio/bufferCache";
import { clearAllStreamingElements, clearAllSizeCache } from "@/lib/audio/streamingCache";
import { stopAudioTick } from "@/lib/audio/audioTick";
import { SceneTabBar } from "@/components/composite/SceneTabBar/SceneTabBar";
import { SceneView } from "@/components/composite/SceneView/SceneView";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useProjectLifecycle } from "@/hooks/useProjectLifecycle";
import { useGlobalHotkeys } from "@/hooks/useGlobalHotkeys";
import { useReconcileLibrary } from "@/hooks/useReconcileLibrary";
import { useAudioErrorHandler } from "@/hooks/useAudioErrorHandler";
import { useDownloadEventListener } from "@/lib/ytdlp.queries";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { useDownloadStore, TERMINAL_STATUSES } from "@/state/downloadStore";
import { saveDownloadHistory } from "@/lib/downloads";
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
  useAudioErrorHandler();
  const downloadFolderId = useAppSettingsStore((s) => s.settings?.downloadFolderId);
  useDownloadEventListener(downloadFolderId);

  const jobs = useDownloadStore((s) => s.jobs);
  const lastSavedTerminalRef = useRef("");
  useEffect(() => {
    const terminal = Object.values(jobs).filter((j) => TERMINAL_STATUSES.has(j.status));
    const serialized = JSON.stringify(terminal.map((j) => j.id + j.status));
    if (serialized === lastSavedTerminalRef.current) return;
    lastSavedTerminalRef.current = serialized;
    void saveDownloadHistory(terminal);
  }, [jobs]);

  const { reconcile } = useReconcileLibrary();

  useEffect(() => {
    return () => {
      stopAudioTick();
      clearAllAudioState();
      // Release decoded PCM memory from the closed project and discard pre-buffered
      // HTMLAudioElements so they do not accumulate across project switches.
      // These caches live outside audioState's pure-state-container boundary, so
      // the orchestrating caller (this component) owns clearing them.
      clearAllBuffers();
      clearAllStreamingElements();
      clearAllSizeCache();
    };
  }, []);

  useEffect(() => {
    reconcile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
