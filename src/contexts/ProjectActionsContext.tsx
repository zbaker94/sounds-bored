import { createContext, useContext, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useProjectStore } from "@/state/projectStore";
import { useLibraryStore } from "@/state/libraryStore";
import { useSaveProject, useSaveProjectAs, useExportProject } from "@/lib/project.queries";
import { discardTemporaryProject, ExportCancelledError } from "@/lib/project";
import { useUiStore, OVERLAY_ID } from "@/state/uiStore";
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
  /** Opens the Save As dialog unconditionally (works for both temp and permanent projects). */
  handleSaveAsMenuClick: () => void;
  /** Auto-saves then exports as a zip. Disabled when no project/folderPath. */
  handleExportClick: () => void;
  /** True while export is in progress (use to disable the Export button). */
  isExporting: boolean;
}

const ProjectActionsContext = createContext<ProjectActionsContextValue | null>(null);

export function ProjectActionsProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();

  const project = useProjectStore((s) => s.project);
  const folderPath = useProjectStore((s) => s.folderPath);
  const isTemporary = useProjectStore((s) => s.isTemporary);
  const isDirty = useProjectStore((s) => s.isDirty);
  const markAsPermanent = useProjectStore((s) => s.markAsPermanent);

  const sounds = useLibraryStore((s) => s.sounds);

  const saveProjectMutation = useSaveProject();
  const saveProjectAsMutation = useSaveProjectAs();
  const exportMutation = useExportProject();

  const showSaveDialog = useUiStore((s) => s.isOverlayOpen(OVERLAY_ID.SAVE_PROJECT_DIALOG));
  const showNavigateConfirm = useUiStore((s) => s.isOverlayOpen(OVERLAY_ID.CONFIRM_NAVIGATE_DIALOG));
  const openOverlay = useUiStore((s) => s.openOverlay);
  const closeOverlay = useUiStore((s) => s.closeOverlay);

  const [pendingNavigatePath, setPendingNavigatePath] = useState<string | null>(null);

  // Callback to invoke after a successful save — set by requestSaveAndThen / navigate guard
  const onAfterSaveRef = useRef<(() => void) | null>(null);

  const canSave = isTemporary || isDirty;

  const handleSaveClick = useCallback(() => {
    if (!project) return;
    if (isTemporary) {
      openOverlay(OVERLAY_ID.SAVE_PROJECT_DIALOG, "dialog");
      return;
    }
    if (!isDirty || !folderPath) return;
    saveProjectMutation.mutate({ folderPath, project }, {
      onSuccess: () => toast.success("Project saved"),
    });
  }, [project, isTemporary, isDirty, folderPath, saveProjectMutation, openOverlay]);

  const requestSaveAndThen = useCallback((onSaved: () => void) => {
    if (!project) return;
    onAfterSaveRef.current = onSaved;
    if (isTemporary) {
      openOverlay(OVERLAY_ID.SAVE_PROJECT_DIALOG, "dialog");
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
  }, [project, isTemporary, folderPath, saveProjectMutation, openOverlay]);

  const requestNavigateAway = useCallback((path: string) => {
    if (!canSave) {
      navigate(path);
      return;
    }
    setPendingNavigatePath(path);
    openOverlay(OVERLAY_ID.CONFIRM_NAVIGATE_DIALOG, "dialog");
  }, [canSave, navigate, openOverlay]);

  const handleSaveAsMenuClick = useCallback(() => {
    openOverlay(OVERLAY_ID.SAVE_PROJECT_DIALOG, "dialog");
  }, [openOverlay]);

  const handleExportClick = useCallback(() => {
    if (!project || !folderPath) return;
    saveProjectMutation.mutate({ folderPath, project }, {
      onSuccess: () => {
        const referencedSoundIds = new Set<string>();
        for (const scene of project.scenes) {
          for (const pad of scene.pads) {
            for (const layer of pad.layers) {
              if (layer.selection.type === "assigned") {
                for (const instance of layer.selection.instances) {
                  referencedSoundIds.add(instance.soundId);
                }
              }
            }
          }
        }
        const referencedSounds = sounds.filter((s) => referencedSoundIds.has(s.id));
        toast.promise(
          exportMutation.mutateAsync({ folderPath, project, referencedSounds }),
          {
            loading: "Exporting...",
            success: (zipPath) => `Exported to ${zipPath}`,
            error: (err) => err instanceof ExportCancelledError ? null : "Export failed. Please try again.",
          },
        );
      },
    });
  }, [project, folderPath, sounds, saveProjectMutation, exportMutation]);

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
        closeOverlay(OVERLAY_ID.SAVE_PROJECT_DIALOG);
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
    closeOverlay(OVERLAY_ID.SAVE_PROJECT_DIALOG);
    onAfterSaveRef.current = null;
  };

  // --- Navigate confirm dialog handlers ---

  const handleNavigateSave = () => {
    closeOverlay(OVERLAY_ID.CONFIRM_NAVIGATE_DIALOG);
    if (pendingNavigatePath) {
      const path = pendingNavigatePath;
      setPendingNavigatePath(null);
      requestSaveAndThen(() => navigate(path));
    }
  };

  const handleNavigateDiscard = async () => {
    closeOverlay(OVERLAY_ID.CONFIRM_NAVIGATE_DIALOG);
    if (pendingNavigatePath) {
      const path = pendingNavigatePath;
      setPendingNavigatePath(null);
      if (isTemporary && folderPath) {
        try {
          await discardTemporaryProject(folderPath);
        } catch {
          console.warn("Could not discard temporary project.");
        }
      }
      navigate(path);
    }
  };

  const handleNavigateCancel = () => {
    closeOverlay(OVERLAY_ID.CONFIRM_NAVIGATE_DIALOG);
    setPendingNavigatePath(null);
  };

  return (
    <ProjectActionsContext.Provider value={{ canSave, handleSaveClick, requestNavigateAway, requestSaveAndThen, handleSaveAsMenuClick, handleExportClick, isExporting: exportMutation.isPending }}>
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
