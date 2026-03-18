import { createContext, useContext, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useProjectStore } from "@/state/projectStore";
import { useSaveProject, useSaveProjectAs } from "@/lib/project.queries";
import { SaveProjectDialog } from "@/components/modals/SaveProjectDialog";
import { ConfirmCloseDialog } from "@/components/modals/ConfirmCloseDialog";

interface ProjectActionsContextValue {
  /** True when there is something to save (dirty or temporary). */
  canSave: boolean;
  /** Ctrl+S behavior: in-place save for permanent projects, opens Save As dialog for temporary. */
  handleSaveClick: () => void;
  /** Navigate to path, prompting save/discard/cancel first if there are unsaved changes. */
  requestNavigateAway: (path: string) => void;
  /** Save (showing dialog if temporary), then call onSaved on success. Used by the window close flow. */
  requestSaveAndThen: (onSaved: () => void) => void;
}

const ProjectActionsContext = createContext<ProjectActionsContextValue | null>(null);

export function ProjectActionsProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();

  const project = useProjectStore((s) => s.project);
  const folderPath = useProjectStore((s) => s.folderPath);
  const isTemporary = useProjectStore((s) => s.isTemporary);
  const isDirty = useProjectStore((s) => s.isDirty);
  const markAsPermanent = useProjectStore((s) => s.markAsPermanent);

  const saveProjectMutation = useSaveProject();
  const saveProjectAsMutation = useSaveProjectAs();

  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showNavigateConfirm, setShowNavigateConfirm] = useState(false);
  const [pendingNavigatePath, setPendingNavigatePath] = useState<string | null>(null);

  // Callback to invoke after a successful save — set by requestSaveAndThen / navigate guard
  const onAfterSaveRef = useRef<(() => void) | null>(null);

  const canSave = isTemporary || isDirty;

  const handleSaveClick = useCallback(() => {
    if (!project) return;
    if (isTemporary) {
      setShowSaveDialog(true);
      return;
    }
    if (!isDirty || !folderPath) return;
    saveProjectMutation.mutate({ folderPath, project });
  }, [project, isTemporary, isDirty, folderPath, saveProjectMutation]);

  const requestSaveAndThen = useCallback((onSaved: () => void) => {
    if (!project) return;
    onAfterSaveRef.current = onSaved;
    if (isTemporary) {
      setShowSaveDialog(true);
      return;
    }
    if (folderPath) {
      saveProjectMutation.mutate({ folderPath, project }, {
        onSuccess: () => {
          const cb = onAfterSaveRef.current;
          onAfterSaveRef.current = null;
          cb?.();
        },
      });
    }
  }, [project, isTemporary, folderPath, saveProjectMutation]);

  const requestNavigateAway = useCallback((path: string) => {
    if (!canSave) {
      navigate(path);
      return;
    }
    setPendingNavigatePath(path);
    setShowNavigateConfirm(true);
  }, [canSave, navigate]);

  // --- Save dialog handlers ---

  const handleSaveAs = async (projectName: string) => {
    if (!project || !folderPath) return;
    try {
      const result = await saveProjectAsMutation.mutateAsync({
        projectName,
        currentPath: folderPath,
        project,
      });
      if (result) {
        markAsPermanent(
          { name: result.project.name, path: result.newPath, date: new Date().toISOString() },
          result.project,
        );
        setShowSaveDialog(false);
        const cb = onAfterSaveRef.current;
        onAfterSaveRef.current = null;
        cb?.();
      }
    } catch {
      toast.error("Failed to save project. Please try again.");
      onAfterSaveRef.current = null;
    }
  };

  const handleCancelSave = () => {
    setShowSaveDialog(false);
    onAfterSaveRef.current = null;
  };

  // --- Navigate confirm dialog handlers ---

  const handleNavigateSave = () => {
    setShowNavigateConfirm(false);
    if (pendingNavigatePath) {
      const path = pendingNavigatePath;
      setPendingNavigatePath(null);
      requestSaveAndThen(() => navigate(path));
    }
  };

  const handleNavigateDiscard = () => {
    setShowNavigateConfirm(false);
    if (pendingNavigatePath) {
      navigate(pendingNavigatePath);
      setPendingNavigatePath(null);
    }
  };

  const handleNavigateCancel = () => {
    setShowNavigateConfirm(false);
    setPendingNavigatePath(null);
  };

  return (
    <ProjectActionsContext.Provider value={{ canSave, handleSaveClick, requestNavigateAway, requestSaveAndThen }}>
      {children}
      <SaveProjectDialog
        isOpen={showSaveDialog}
        onSave={handleSaveAs}
        onCancel={handleCancelSave}
        defaultName={project?.name ?? ""}
        isPending={saveProjectAsMutation.isPending}
      />
      <ConfirmCloseDialog
        isOpen={showNavigateConfirm}
        description="You have unsaved changes. Do you want to save before leaving?"
        onSave={handleNavigateSave}
        onDiscard={handleNavigateDiscard}
        onCancel={handleNavigateCancel}
      />
    </ProjectActionsContext.Provider>
  );
}

export function useProjectActions() {
  const ctx = useContext(ProjectActionsContext);
  if (!ctx) throw new Error("useProjectActions must be used within ProjectActionsProvider");
  return ctx;
}
