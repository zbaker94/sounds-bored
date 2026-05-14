import { createContext, useContext, useState, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { pickFolder } from "@/lib/scope";
import { useProjectStore } from "@/state/projectStore";
import { useLibraryStore } from "@/state/libraryStore";
import { useSaveProject, useSaveProjectAs } from "@/lib/project.queries";
import { discardTemporaryProject, saveProject, buildExportZipName } from "@/lib/project";
import { useUiStore, OVERLAY_ID } from "@/state/uiStore";
import { resolveReferencedSounds, countMissingReferencedSounds, buildSoundMapJson } from "@/lib/export";

type ExportStatus = "idle" | "copying" | "zipping" | "done" | "error";

interface SaveDialogValue {
  defaultName: string;
  isPending: boolean;
  onSave: (projectName: string) => Promise<void>;
  onCancel: () => void;
}

interface NavigateDialogValue {
  onSave: () => void;
  onDiscard: () => void | Promise<void>;
  onCancel: () => void;
}

interface ExportDialogValue {
  status: ExportStatus;
  onCancel: () => Promise<void>;
}

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
  saveDialog: SaveDialogValue;
  navigateDialog: NavigateDialogValue;
  exportDialog: ExportDialogValue;
}

const ProjectActionsContext = createContext<ProjectActionsContextValue | null>(null);

type ExportPayload = { jobId: string; status: string; zipPath?: string; error?: string };

function makeExportEventHandler(
  jobId: string,
  zipName: string,
  setExportStatus: (s: ExportStatus) => void,
  closeOverlay: (id: string) => void,
  exportUnlisten: React.MutableRefObject<(() => void) | null>,
  exportJobId: React.MutableRefObject<string | null>,
): (event: { payload: ExportPayload }) => void {
  const cleanup = () => {
    exportUnlisten.current?.();
    exportUnlisten.current = null;
    exportJobId.current = null;
  };
  return ({ payload }) => {
    if (payload.jobId !== jobId) return;
    if (payload.status === "copying") { setExportStatus("copying"); return; }
    if (payload.status === "zipping") { setExportStatus("zipping"); return; }
    cleanup();
    if (payload.status === "done") {
      setExportStatus("done");
      setTimeout(() => { closeOverlay(OVERLAY_ID.EXPORT_PROGRESS_DIALOG); setExportStatus("idle"); toast.success(`Exported: ${payload.zipPath ?? zipName}`); }, 1200);
    } else if (payload.status === "cancelled") {
      closeOverlay(OVERLAY_ID.EXPORT_PROGRESS_DIALOG);
      setExportStatus("idle");
    } else if (payload.status === "error") {
      setExportStatus("error");
      toast.error(`Export failed: ${payload.error ?? "unknown error"}`);
      setTimeout(() => { closeOverlay(OVERLAY_ID.EXPORT_PROGRESS_DIALOG); setExportStatus("idle"); }, 2000);
    }
  };
}

export function ProjectActionsProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();

  const project = useProjectStore((s) => s.project);
  const folderPath = useProjectStore((s) => s.folderPath);
  const isTemporary = useProjectStore((s) => s.isTemporary);
  const isDirty = useProjectStore((s) => s.isDirty);
  const markAsPermanent = useProjectStore((s) => s.markAsPermanent);

  const saveProjectMutation = useSaveProject();
  const saveProjectAsMutation = useSaveProjectAs();

  const openOverlay = useUiStore((s) => s.openOverlay);
  const closeOverlay = useUiStore((s) => s.closeOverlay);

  const [pendingNavigatePath, setPendingNavigatePath] = useState<string | null>(null);

  // Callback to invoke after a successful save — set by requestSaveAndThen / navigate guard
  const onAfterSaveRef = useRef<(() => void) | null>(null);

  // Export state
  const [exportStatus, setExportStatus] = useState<ExportStatus>("idle");
  const exportJobId = useRef<string | null>(null);
  const exportUnlisten = useRef<(() => void) | null>(null);

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
      onError: () => toast.error("Failed to save project. Please try again."),
    });
  }, [project, isTemporary, isDirty, folderPath, saveProjectMutation.mutate, openOverlay]);

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
        onError: () => {
          // Leave onAfterSaveRef intact — the follow-up action (e.g. window close)
          // is cancelled because we did not successfully save.
          onAfterSaveRef.current = null;
          toast.error("Failed to save project. Please try again.");
        },
      });
    }
  }, [project, isTemporary, folderPath, saveProjectMutation.mutate, openOverlay]);

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

  const handleExportClick = useCallback(async () => {
    // Read project data via getState() to avoid stale closure issues when triggered via hotkey.
    // All other values used below (setExportStatus, openOverlay, closeOverlay, refs) are stable.
    const { project, folderPath, clearDirtyFlag } = useProjectStore.getState();
    const { sounds } = useLibraryStore.getState();

    if (!project || !folderPath) return;

    // 1. Auto-save directly — avoids TanStack Query mutation state in the closure
    try {
      await saveProject(folderPath, project);
      clearDirtyFlag();
    } catch {
      toast.error("Export failed: could not save project.");
      return;
    }

    const referencedSounds = resolveReferencedSounds(project, sounds);
    const missingCount = countMissingReferencedSounds(project, sounds);

    // 3. Open folder picker
    const destPath = await pickFolder({ title: "Select Export Destination", canCreateDirectories: true });
    if (!destPath) return;

    if (missingCount > 0) {
      toast.warning(`${missingCount} referenced sound${missingCount === 1 ? "" : "s"} could not be included (file${missingCount === 1 ? "" : "s"} missing).`);
    }

    // 4. Build sound map: { soundId: "sounds/filename" }
    const { json: soundMapJson, collisions } = buildSoundMapJson(referencedSounds);
    if (collisions.length > 0) {
      toast.warning(
        `${collisions.length} sound file name${collisions.length === 1 ? "" : "s"} conflict${collisions.length === 1 ? "s" : ""} — some audio may not export correctly: ${collisions.slice(0, 3).join(", ")}${collisions.length > 3 ? "…" : ""}`
      );
    }

    // 5. Build zip name and job id
    const zipName = buildExportZipName(project.name);
    const jobId = crypto.randomUUID();
    exportJobId.current = jobId;

    // 6. Show dialog
    openOverlay(OVERLAY_ID.EXPORT_PROGRESS_DIALOG, "dialog");
    setExportStatus("copying");

    // 7. Start listening for progress events
    const handler = makeExportEventHandler(jobId, zipName, setExportStatus, closeOverlay, exportUnlisten, exportJobId);
    const unlistenFn = await listen<ExportPayload>("export://progress", handler);
    exportUnlisten.current = unlistenFn;

    // 8. Invoke the export command (returns immediately — progress via events)
    try {
      await invoke("export_project", {
        sourcePath: folderPath,
        extraSoundPaths: referencedSounds.map((s) => s.filePath),
        destPath,
        zipName,
        soundMapJson,
        jobId,
      });
    } catch {
      unlistenFn();
      exportUnlisten.current = null;
      exportJobId.current = null;
      closeOverlay(OVERLAY_ID.EXPORT_PROGRESS_DIALOG);
      setExportStatus("idle");
      toast.error("Export failed. Please try again.");
    }
  // openOverlay and closeOverlay are stable Zustand actions; setExportStatus is a stable React setter.
  // All project data is read via getState() above, so no project/folderPath/sounds deps needed.
  }, [openOverlay, closeOverlay]);

  const handleCancelExport = useCallback(async () => {
    if (!exportJobId.current) return;
    try {
      await invoke("cancel_export", { jobId: exportJobId.current });
    } catch {
      // best-effort cancel; the event listener will still clean up
    }
  }, []);

  // --- Save dialog handlers ---

  const handleSaveAs = useCallback(async (projectName: string) => {
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
  }, [project, folderPath, saveProjectAsMutation.mutateAsync, markAsPermanent, closeOverlay]);

  const handleCancelSave = useCallback(() => {
    closeOverlay(OVERLAY_ID.SAVE_PROJECT_DIALOG);
    onAfterSaveRef.current = null;
  }, [closeOverlay]);

  // --- Navigate confirm dialog handlers ---

  const handleNavigateSave = useCallback(() => {
    closeOverlay(OVERLAY_ID.CONFIRM_NAVIGATE_DIALOG);
    if (pendingNavigatePath) {
      const path = pendingNavigatePath;
      setPendingNavigatePath(null);
      requestSaveAndThen(() => navigate(path));
    }
  }, [pendingNavigatePath, closeOverlay, requestSaveAndThen, navigate]);

  const handleNavigateDiscard = useCallback(async () => {
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
  }, [pendingNavigatePath, closeOverlay, isTemporary, folderPath, navigate]);

  const handleNavigateCancel = useCallback(() => {
    closeOverlay(OVERLAY_ID.CONFIRM_NAVIGATE_DIALOG);
    setPendingNavigatePath(null);
  }, [closeOverlay]);

  const saveDialog = useMemo<SaveDialogValue>(() => ({
    defaultName: project?.name ?? "",
    isPending: saveProjectAsMutation.isPending,
    onSave: handleSaveAs,
    onCancel: handleCancelSave,
  }), [project?.name, saveProjectAsMutation.isPending, handleSaveAs, handleCancelSave]);

  const navigateDialog = useMemo<NavigateDialogValue>(() => ({
    onSave: handleNavigateSave,
    onDiscard: handleNavigateDiscard,
    onCancel: handleNavigateCancel,
  }), [handleNavigateSave, handleNavigateDiscard, handleNavigateCancel]);

  const exportDialog = useMemo<ExportDialogValue>(() => ({
    status: exportStatus,
    onCancel: handleCancelExport,
  }), [exportStatus, handleCancelExport]);

  const contextValue = useMemo<ProjectActionsContextValue>(() => ({
    canSave,
    handleSaveClick,
    requestNavigateAway,
    requestSaveAndThen,
    handleSaveAsMenuClick,
    handleExportClick,
    saveDialog,
    navigateDialog,
    exportDialog,
  }), [canSave, handleSaveClick, requestNavigateAway, requestSaveAndThen, handleSaveAsMenuClick, handleExportClick, saveDialog, navigateDialog, exportDialog]);

  return (
    <ProjectActionsContext.Provider value={contextValue}>
      {children}
    </ProjectActionsContext.Provider>
  );
}

export function useProjectActions() {
  const ctx = useContext(ProjectActionsContext);
  if (!ctx) throw new Error("useProjectActions must be used within ProjectActionsProvider");
  return ctx;
}
