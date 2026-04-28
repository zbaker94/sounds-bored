import { useProjectHistory, useSaveProjectHistory } from "@/lib/history.queries";
import { useLoadProject, useLoadProjectFromPath, useCreateProject } from "@/lib/project.queries";
import { useProjectStore } from "@/state/projectStore";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useState, useCallback } from "react";
import { Project, ProjectHistoryEntry } from "@/lib/schemas";
import logo from "@/assets/sleeping knight-emblem.gif";
import { openPath } from "@tauri-apps/plugin-opener";
import { exists, remove } from "@tauri-apps/plugin-fs";
import { restorePathScope } from "@/lib/scope";
import { HugeiconsIcon } from "@hugeicons/react";
import { FolderOpenIcon, Settings01Icon, Delete02Icon, FolderRemoveIcon } from "@hugeicons/core-free-icons";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useUiStore, OVERLAY_ID } from "@/state/uiStore";

export function StartScreen() {
  const { data: recentProjects = [], isLoading, error } = useProjectHistory();
  const loadProject = useProjectStore((s) => s.loadProject);
  const loadProjectMutation = useLoadProject();
  const loadProjectFromPathMutation = useLoadProjectFromPath();
  const createProjectMutation = useCreateProject();
  const navigate = useNavigate();
  const saveHistoryMutation = useSaveProjectHistory();
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [confirmDeleteEntry, setConfirmDeleteEntry] = useState<ProjectHistoryEntry | null>(null);
  const [isDeletingFromDisk, setIsDeletingFromDisk] = useState(false);
  const openOverlay = useUiStore((s) => s.openOverlay);

  // Common logic for navigating to main page after loading/creating a project
  const navigateToProject = useCallback((result: { project: Project, folderPath: string }, isTemporary: boolean) => {
    loadProject(
      { name: result.project.name, path: result.folderPath, date: new Date().toISOString() },
      result.project,
      isTemporary
    );
    navigate("/main");
  }, [loadProject, navigate]);

  const handleLoad = async (entry: ProjectHistoryEntry) => {
    try {
      const result = await loadProjectFromPathMutation.mutateAsync(entry.path);
      if (result) {
        navigateToProject(result, false); // Existing projects are in permanent locations
      }
    } catch (error) {
      toast.error("Failed to load project. The file may be missing or corrupted.");
    }
  };

  const handleLoadProject = async () => {
    const result = await loadProjectMutation.mutateAsync();
    if (result) {
      navigateToProject(result, false); // Existing projects are in permanent locations
    }
  };

  const handleOpenProjectInExplorer = async (entry: ProjectHistoryEntry) => {
    try {
      await restorePathScope(entry.path);
      const pathExists = await exists(entry.path);
      if (!pathExists) {
        toast.error("Project folder no longer exists at this location.");
        return;
      }
      await openPath(entry.path);
    } catch {
      toast.error("Could not open project folder.");
    }
  };

  const handleRemoveFromHistory = async (entry: ProjectHistoryEntry) => {
    try {
      const updated = recentProjects.filter((p) => p.path !== entry.path);
      await saveHistoryMutation.mutateAsync(updated);
    } catch {
      toast.error("Could not remove project from history.");
    }
  };

  const handleDeleteFromDisk = async () => {
    const entry = confirmDeleteEntry;
    if (!entry) return;
    const currentPath = useProjectStore.getState().folderPath;
    if (currentPath && entry.path === currentPath) {
      toast.error("Cannot delete the currently loaded project.");
      setConfirmDeleteEntry(null);
      return;
    }
    setIsDeletingFromDisk(true);
    try {
      await restorePathScope(entry.path);
      const pathExists = await exists(entry.path);
      if (pathExists) {
        await remove(entry.path, { recursive: true });
      }
      const updated = recentProjects.filter((p) => p.path !== entry.path);
      await saveHistoryMutation.mutateAsync(updated);
      setConfirmDeleteEntry(null);
      toast.success(`"${entry.name}" deleted from disk.`);
    } catch {
      toast.error(`Could not delete "${entry.name}" from disk.`);
    } finally {
      setIsDeletingFromDisk(false);
    }
  };

  const handleCreateProject = async () => {
    setIsCreatingProject(true);

    try {
      const result = await createProjectMutation.mutateAsync(undefined);
      navigateToProject(result, true); // New projects start in temporary location
    } catch (error) {
      toast.error("Failed to create project. Please try again.");
    } finally {
      setIsCreatingProject(false);
    }
  };

  return (
    <div className="relative flex flex-col items-center justify-center min-h-screen backdrop-blur-xs">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Settings"
        className="absolute top-4 right-4"
        onClick={() => openOverlay(OVERLAY_ID.SETTINGS_DIALOG, "dialog")}
      >
        <HugeiconsIcon icon={Settings01Icon} size={16} />
      </Button>
      <img src={logo} alt="Sounds Bored Logo" className="mb-8 w-48" style={{filter: "drop-shadow(6px 8px 0px #000000)"}} />
      <h1 className="text-center mb-8 tracking-widest text-4xl text-secondary" style={{filter: "drop-shadow(6px 8px 0px #000000)"}}>
        SOUNDS BORED
      </h1>
      <Card className="w-full max-w-md shadowed">
        <CardContent>
          <div className="flex flex-col gap-4">
            <Button
              variant="default"
              className="w-full"
              onClick={handleCreateProject}
              disabled={isCreatingProject || createProjectMutation.isPending}
            >
              {isCreatingProject || createProjectMutation.isPending ? "Creating..." : "Create New Project"}
            </Button>
            <Button
              variant="secondary"
              className="w-full"
              onClick={handleLoadProject}
              disabled={loadProjectMutation.isPending}
            >
              {loadProjectMutation.isPending ? "Loading..." : "Load Project"}
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card className="w-full max-w-md mt-8 shadowed">
        <CardHeader>
          <h2 className="font-semibold">Recent Projects</h2>
        </CardHeader>
        <CardContent>
              {isLoading && <div>Loading...</div>}
              {error && <div className="text-destructive">{error.message}</div>}
              {recentProjects.length === 0 && !isLoading && <div>No recent projects found.</div>}
              <ul className="space-y-2">
                {recentProjects.map((entry) => (
                  <li key={entry.path} className="flex items-center justify-between">
                    <span>
                      <span className="font-medium">{entry.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{new Date(entry.date).toLocaleString()}</span>
                    </span>
                    <div className="flex items-center gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleOpenProjectInExplorer(entry); }} aria-label={`Open folder for ${entry.name}`}>
                            <HugeiconsIcon icon={FolderOpenIcon} size={16} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Open in Explorer</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="sm" disabled={saveHistoryMutation.isPending} onClick={(e) => { e.stopPropagation(); handleRemoveFromHistory(entry); }} aria-label={`Remove ${entry.name} from history`}>
                            <HugeiconsIcon icon={Delete02Icon} size={16} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Remove from recent list</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setConfirmDeleteEntry(entry); }} aria-label={`Delete ${entry.name} from disk`}>
                            <HugeiconsIcon icon={FolderRemoveIcon} size={16} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Delete from disk</TooltipContent>
                      </Tooltip>
                      <Button size="sm" onClick={() => handleLoad(entry)}>Load</Button>
                    </div>
                  </li>
                ))}
              </ul>
        </CardContent>
      </Card>
      <Dialog open={confirmDeleteEntry !== null} onOpenChange={(open) => { if (!open && !isDeletingFromDisk) setConfirmDeleteEntry(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Project from Disk</DialogTitle>
            <DialogDescription>
              Permanently delete <strong>{confirmDeleteEntry?.name}</strong> and all its contents from disk? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmDeleteEntry(null)} disabled={isDeletingFromDisk}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteFromDisk} disabled={isDeletingFromDisk}>
              {isDeletingFromDisk ? "Deleting..." : "Delete from Disk"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
