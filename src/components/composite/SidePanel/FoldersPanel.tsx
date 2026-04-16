import { useState, useMemo, useEffect } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { exists, remove } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Folder01Icon,
  FolderOpenIcon,
  ChevronRight,
  Add01Icon,
  Alert02Icon,
  Delete02Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TruncatedPath } from "@/components/ui/truncated-path";
import { useLibraryStore } from "@/state/libraryStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { useSaveAppSettings } from "@/lib/appSettings.queries";
import { useSaveCurrentLibrary } from "@/lib/library.queries";
import { checkMissingStatus } from "@/lib/library.reconcile";
import { evictBuffer } from "@/lib/audio/bufferCache";
import { evictStreamingElement } from "@/lib/audio/streamingCache";
import { useAddFolder } from "@/hooks/useAddFolder";
import { useResolveFolderQueue } from "@/hooks/useResolveFolderQueue";
import { useReconcileLibrary } from "@/hooks/useReconcileLibrary";
import { useProjectStore } from "@/state/projectStore";
import { useUiStore, OVERLAY_ID } from "@/state/uiStore";
import { getAffectedPads, type AffectedPad } from "@/lib/projectSoundReconcile";
import { ResolveMissingFolderDialog } from "@/components/modals/ResolveMissingFolderDialog";
import { EMPTY_GLOBAL_FOLDERS } from "@/lib/constants";
import { cn } from "@/lib/utils";

const panelClass =
  "backdrop-blur-sm hover:backdrop-blur-lg bg-black/50 rounded-lg";

interface FoldersPanelProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  searchQuery: string;
}

export function FoldersPanel({
  selectedId,
  onSelect,
  searchQuery,
}: FoldersPanelProps) {
  const sounds = useLibraryStore((s) => s.sounds);
  const updateLibrary = useLibraryStore((s) => s.updateLibrary);
  const missingFolderIds = useLibraryStore((s) => s.missingFolderIds);
  const project = useProjectStore((s) => s.project);

  const settings = useAppSettingsStore((s) => s.settings);
  const folders = settings?.globalFolders ?? EMPTY_GLOBAL_FOLDERS;

  const removeGlobalFolder = useAppSettingsStore((s) => s.removeGlobalFolder);
  const { saveCurrentLibrary } = useSaveCurrentLibrary();
  const { mutateAsync: saveSettings } = useSaveAppSettings();

  const { isAddingFolder, handleAddFolder } = useAddFolder();
  const {
    folderDialogQueue,
    setFolderDialogQueue,
    handleFolderDialogResolved,
    handleFolderDialogClose,
  } = useResolveFolderQueue();
  const { reconcile, isReconciling } = useReconcileLibrary();

  // Mount-time reconcile — co-located with the Refresh button's reconcile call.
  // The singleton guard in useReconcileLibrary prevents duplicate runs.
  useEffect(() => {
    reconcile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedFolder = useMemo(
    () => folders.find((f) => f.id === selectedId) ?? null,
    [folders, selectedId],
  );

  const isSelectedFolderAssigned =
    !!selectedId &&
    (selectedId === settings?.downloadFolderId ||
      selectedId === settings?.importFolderId);

  const filteredFolders = useMemo(() => {
    if (!searchQuery) return folders;
    const q = searchQuery.toLowerCase();
    return folders.filter(
      (f) =>
        f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q),
    );
  }, [folders, searchQuery]);

  const allMissingFolders = useMemo(
    () => folders.filter((f) => missingFolderIds.has(f.id)),
    [folders, missingFolderIds],
  );

  const [confirmDeleteFolderOpen, setConfirmDeleteFolderOpen] = useState(false);
  const [isDeletingFolder, setIsDeletingFolder] = useState(false);
  const [affectedPadsForFolderDelete, setAffectedPadsForFolderDelete] =
    useState<AffectedPad[]>([]);

  function handleSelect(id: string) {
    if (selectedId === id) {
      onSelect(null);
      return;
    }
    onSelect(id);
  }

  async function handleOpenFolderInExplorer() {
    if (!selectedFolder) return;
    try {
      const folderExists = await exists(selectedFolder.path);
      if (!folderExists) {
        toast.error("Folder no longer exists on disk");
        return;
      }
      await openPath(selectedFolder.path);
    } catch {
      toast.error("Failed to open folder");
    }
  }

  async function handleDeleteFolderFromDisk() {
    if (!selectedFolder) return;
    const storeSettings = useAppSettingsStore.getState().settings;
    if (!storeSettings) return;
    if (
      storeSettings.downloadFolderId === selectedFolder.id ||
      storeSettings.importFolderId === selectedFolder.id
    ) {
      toast.error(
        "Cannot delete: folder is assigned as download or import destination",
      );
      setConfirmDeleteFolderOpen(false);
      return;
    }
    const folderId = selectedFolder.id;
    const folderName = selectedFolder.name;
    const folderPath = selectedFolder.path;
    setIsDeletingFolder(true);
    try {
      const folderSoundIds = sounds
        .filter((s) => s.folderId === folderId)
        .map((s) => s.id);
      for (const id of folderSoundIds) {
        evictBuffer(id);
        evictStreamingElement(id);
      }
      updateLibrary((draft) => {
        draft.sounds = draft.sounds.filter((s) => s.folderId !== folderId);
      });
      removeGlobalFolder(folderId);
      const settingsAfterRemove = useAppSettingsStore.getState().settings;
      if (settingsAfterRemove) {
        await saveSettings(settingsAfterRemove);
      }
      await saveCurrentLibrary();
      const updatedFolders =
        useAppSettingsStore.getState().settings?.globalFolders ?? [];
      const latest = useLibraryStore.getState();
      const missingResult = await checkMissingStatus(
        updatedFolders,
        latest.sounds,
      );
      useLibraryStore
        .getState()
        .setMissingState(
          missingResult.missingSoundIds,
          missingResult.missingFolderIds,
          missingResult.unknownSoundIds,
          missingResult.unknownFolderIds,
        );
      const folderExists = await exists(folderPath);
      if (folderExists) {
        await remove(folderPath, { recursive: true });
      }
      onSelect(null);
      toast.success(`Folder "${folderName}" deleted from disk`);
    } catch {
      toast.error("Failed to delete folder from disk");
    } finally {
      setIsDeletingFolder(false);
      setConfirmDeleteFolderOpen(false);
    }
  }

  function handleRequestDeleteFolder() {
    if (selectedFolder && project) {
      const folderSoundIds = new globalThis.Set(
        sounds
          .filter((s) => s.folderId === selectedFolder.id)
          .map((s) => s.id),
      );
      setAffectedPadsForFolderDelete(getAffectedPads(project, folderSoundIds));
    } else {
      setAffectedPadsForFolderDelete([]);
    }
    setConfirmDeleteFolderOpen(true);
  }

  return (
    <div
      className={cn(
        panelClass,
        "flex-1 border border-white overflow-y-auto flex flex-col",
      )}
    >
      <div className="sticky top-0 z-10 flex items-center gap-2 p-2 bg-black/70 backdrop-blur-sm border-b border-white/20 shrink-0">
        <Button
          variant="secondary"
          size="sm"
          className="h-7 text-xs px-2"
          onClick={reconcile}
          disabled={isReconciling}
          aria-label="Refresh folders"
        >
          <HugeiconsIcon
            icon={RefreshIcon}
            size={12}
            className={isReconciling ? "animate-spin" : undefined}
          />
          {isReconciling ? "Scanning..." : "Refresh"}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="h-7 text-xs px-2"
          onClick={handleAddFolder}
          disabled={isAddingFolder}
        >
          <HugeiconsIcon icon={Add01Icon} size={12} />
          {isAddingFolder ? "Adding..." : "Add Folder"}
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                variant="secondary"
                size="sm"
                className="h-7 text-xs px-2"
                disabled={selectedFolder === null}
                onClick={handleOpenFolderInExplorer}
              >
                <HugeiconsIcon icon={FolderOpenIcon} size={12} />
                Open
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>Open in Explorer</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                variant="secondary"
                size="sm"
                className="h-7 text-xs px-2"
                disabled={selectedFolder === null || isSelectedFolderAssigned}
                onClick={handleRequestDeleteFolder}
              >
                <HugeiconsIcon icon={Delete02Icon} size={12} />
                Delete
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {isSelectedFolderAssigned
              ? "Cannot delete: folder is assigned as download or import destination"
              : "Delete folder from disk"}
          </TooltipContent>
        </Tooltip>
      </div>
      {allMissingFolders.length > 0 && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-amber-400 text-xs shrink-0">
          <HugeiconsIcon icon={Alert02Icon} size={12} />
          <span>
            {allMissingFolders.length} folder
            {allMissingFolders.length > 1 ? "s" : ""} missing
          </span>
          <div className="ml-auto flex gap-1">
            <button
              className="px-1.5 py-0.5 rounded hover:bg-amber-500/20 transition-colors"
              onClick={() =>
                useUiStore
                  .getState()
                  .openOverlay(OVERLAY_ID.CONFIRM_REMOVE_MISSING_FOLDERS, "dialog")
              }
            >
              Remove All
            </button>
            <button
              className="px-1.5 py-0.5 rounded hover:bg-amber-500/20 transition-colors"
              onClick={() => setFolderDialogQueue([...allMissingFolders])}
            >
              Review →
            </button>
          </div>
        </div>
      )}
      <div className="p-2 flex-1">
        {filteredFolders.map((folder) => {
          const isFolderMissing = missingFolderIds.has(folder.id);
          return (
            <Item
              key={folder.id}
              variant="panel"
              className={cn(selectedId === folder.id && "bg-white/20")}
              onClick={() => {
                if (isFolderMissing) {
                  setFolderDialogQueue([folder]);
                } else {
                  handleSelect(folder.id);
                }
              }}
            >
              <ItemMedia>
                <HugeiconsIcon
                  icon={isFolderMissing ? Alert02Icon : Folder01Icon}
                  size={14}
                  className={isFolderMissing ? "text-destructive" : undefined}
                />
              </ItemMedia>
              <ItemContent>
                <ItemTitle
                  className={isFolderMissing ? "text-destructive" : undefined}
                >
                  {folder.name}
                </ItemTitle>
                <ItemDescription className="text-white/40">
                  <TruncatedPath path={folder.path} />
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                {isFolderMissing ? (
                  <HugeiconsIcon
                    icon={Alert02Icon}
                    className="size-4 text-destructive"
                  />
                ) : (
                  <HugeiconsIcon icon={ChevronRight} className="size-4" />
                )}
              </ItemActions>
            </Item>
          );
        })}
        {folders.length === 0 && !searchQuery && (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon
                  icon={Folder01Icon}
                  className="text-black/70"
                />
              </EmptyMedia>
              <EmptyTitle className="text-white/70">
                No folders yet...
              </EmptyTitle>
            </EmptyHeader>
            <EmptyDescription className="text-white/50">
              Add a folder to watch for audio files. Folders must be within
              Music, Documents, Downloads, or Desktop.
            </EmptyDescription>
            <EmptyContent className="flex-row justify-center">
              <Button
                variant="outline"
                className="text-white/70"
                onClick={handleAddFolder}
                disabled={isAddingFolder}
              >
                Add Folder
              </Button>
            </EmptyContent>
          </Empty>
        )}
      </div>
      <ResolveMissingFolderDialog
        folder={folderDialogQueue[0] ?? null}
        onResolved={handleFolderDialogResolved}
        onClose={handleFolderDialogClose}
      />
      <Dialog
        open={confirmDeleteFolderOpen}
        onOpenChange={setConfirmDeleteFolderOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Folder from Disk</DialogTitle>
            <DialogDescription>
              This will permanently delete the folder{" "}
              <strong>{selectedFolder?.name ?? ""}</strong> and ALL files inside
              it from disk, and remove all associated sounds from your library.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {affectedPadsForFolderDelete.length > 0 && (
            <div className="text-sm space-y-1">
              <p className="font-medium text-amber-400">
                Affects this project:
              </p>
              <ul className="space-y-0.5 text-muted-foreground">
                {affectedPadsForFolderDelete.map((ap, i) => (
                  <li key={i}>
                    <span className="text-foreground">"{ap.padName}"</span> (
                    {ap.sceneName}) — Layer
                    {ap.layerIndices.length > 1 ? "s" : ""}{" "}
                    {ap.layerIndices.join(", ")}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmDeleteFolderOpen(false)}
              disabled={isDeletingFolder}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteFolderFromDisk}
              disabled={isDeletingFolder}
            >
              {isDeletingFolder ? "Deleting..." : "Delete from Disk"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
