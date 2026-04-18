import { useProjectActions } from "@/contexts/ProjectActionsContext";
import { useUiStore, OVERLAY_ID, selectIsOverlayOpen } from "@/state/uiStore";
import { SaveProjectDialog } from "@/components/modals/SaveProjectDialog";
import { ConfirmCloseDialog } from "@/components/modals/ConfirmCloseDialog";
import { ExportProgressDialog } from "@/components/modals/ExportProgressDialog";

export function ProjectDialogs() {
  const { saveDialog, navigateDialog, exportDialog } = useProjectActions();
  const showSaveDialog = useUiStore(selectIsOverlayOpen(OVERLAY_ID.SAVE_PROJECT_DIALOG));
  const showNavigateConfirm = useUiStore(selectIsOverlayOpen(OVERLAY_ID.CONFIRM_NAVIGATE_DIALOG));
  const showExportDialog = useUiStore(selectIsOverlayOpen(OVERLAY_ID.EXPORT_PROGRESS_DIALOG));

  return (
    <>
      <SaveProjectDialog
        isOpen={showSaveDialog}
        onSave={saveDialog.onSave}
        onCancel={saveDialog.onCancel}
        defaultName={saveDialog.defaultName}
        isPending={saveDialog.isPending}
      />
      <ConfirmCloseDialog
        isOpen={showNavigateConfirm}
        description="You have unsaved changes. Do you want to save before leaving?"
        onSave={navigateDialog.onSave}
        onDiscard={navigateDialog.onDiscard}
        onCancel={navigateDialog.onCancel}
      />
      <ExportProgressDialog
        isOpen={showExportDialog}
        status={exportDialog.status}
        onCancel={exportDialog.onCancel}
      />
    </>
  );
}
