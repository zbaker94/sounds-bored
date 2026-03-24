import { useProjectStore } from "@/state/projectStore";
import { SceneTabBar } from "@/components/composite/SceneTabBar/SceneTabBar";
import { SceneView } from "@/components/composite/SceneView/SceneView";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useProjectLifecycle } from "@/hooks/useProjectLifecycle";
import { useGlobalHotkeys } from "@/hooks/useGlobalHotkeys";
import { ConfirmCloseDialog } from "@/components/modals/ConfirmCloseDialog";
import { SidePanel } from "@/components/composite/SidePanel/SidePanel";
import { ProjectActionsProvider } from "@/contexts/ProjectActionsContext";

export function MainPage() {
  const project = useProjectStore((s) => s.project);

  if (!project) {
    return null;
  }

  return (
    <ProjectActionsProvider>
      <MainPageInner />
    </ProjectActionsProvider>
  );
}

function MainPageInner() {
  useAutoSave();
  useGlobalHotkeys();

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
