import { useProjectStore } from "@/state/projectStore";
import { SceneTabBar } from "@/components/composite/SceneTabBar/SceneTabBar";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useProjectLifecycle } from "@/hooks/useProjectLifecycle";
import { SaveProjectDialog } from "@/components/modals/SaveProjectDialog";
import { ConfirmCloseDialog } from "@/components/modals/ConfirmCloseDialog";
import { SidePanel } from "@/components/composite/SidePanel/SidePanel";

export function MainPage() {
  const project = useProjectStore((s) => s.project);

  useAutoSave();

  const {
    showSaveDialog,
    showConfirmClose,
    isSaveAsPending,
    defaultSaveName,
    handleSave,
    handleCancelSave,
    handleSaveAndClose,
    handleDiscardAndClose,
    handleCancelClose,
  } = useProjectLifecycle();

  if (!project) {
    return null;
  }

  return (
    <>
      <div id="main-page" className="w-full h-screen flex flex-col md:flex-row">
        <div className="flex flex-col flex-1 min-h-0 min-w-0">
          <SceneTabBar />
        </div>
        <SidePanel />
      </div>
      <SaveProjectDialog
        isOpen={showSaveDialog}
        onSave={handleSave}
        onCancel={handleCancelSave}
        defaultName={defaultSaveName}
        isPending={isSaveAsPending}
      />
      <ConfirmCloseDialog
        isOpen={showConfirmClose}
        onSave={handleSaveAndClose}
        onDiscard={handleDiscardAndClose}
        onCancel={handleCancelClose}
      />
    </>
  );
}
