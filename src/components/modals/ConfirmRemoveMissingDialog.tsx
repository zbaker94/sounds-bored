import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLibraryStore } from "@/state/libraryStore";
import { useUiStore } from "@/state/uiStore";
import { useAppSettings } from "@/lib/appSettings.queries";
import { useBulkRemove } from "@/hooks/useBulkRemove";
import { EMPTY_GLOBAL_FOLDERS } from "@/lib/constants";

/**
 * Renders the two "Remove All Missing" confirmation dialogs triggered by
 * the amber banners in FoldersPanel / SoundList. Self-contained: pulls
 * bulk-remove state/handlers from useBulkRemove() and dialog open/close
 * flags from useUiStore directly — no prop threading.
 */
export function ConfirmRemoveMissingDialog() {
  const sounds = useLibraryStore((s) => s.sounds);
  const missingSoundIds = useLibraryStore((s) => s.missingSoundIds);
  const missingFolderIds = useLibraryStore((s) => s.missingFolderIds);

  const { data: settings } = useAppSettings();
  const folders = settings?.globalFolders ?? EMPTY_GLOBAL_FOLDERS;

  const confirmRemoveSoundsOpen = useUiStore(
    (s) => s.confirmRemoveMissingSoundsOpen,
  );
  const confirmRemoveFoldersOpen = useUiStore(
    (s) => s.confirmRemoveMissingFoldersOpen,
  );
  const setConfirmRemoveSoundsOpen = useUiStore(
    (s) => s.setConfirmRemoveMissingSoundsOpen,
  );
  const setConfirmRemoveFoldersOpen = useUiStore(
    (s) => s.setConfirmRemoveMissingFoldersOpen,
  );

  const {
    isBulkRemoving,
    handleRemoveAllMissingSounds,
    handleRemoveAllMissingFolders,
  } = useBulkRemove();

  const allMissingSounds = useMemo(
    () => sounds.filter((s) => missingSoundIds.has(s.id)),
    [sounds, missingSoundIds],
  );

  const allMissingFolders = useMemo(
    () => folders.filter((f) => missingFolderIds.has(f.id)),
    [folders, missingFolderIds],
  );

  const affectedSoundsCount = useMemo(
    () =>
      sounds.filter((s) => s.folderId && missingFolderIds.has(s.folderId))
        .length,
    [sounds, missingFolderIds],
  );

  return (
    <>
      <Dialog
        open={confirmRemoveSoundsOpen}
        onOpenChange={setConfirmRemoveSoundsOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove All Missing Sounds</DialogTitle>
            <DialogDescription>
              Remove all <strong>{allMissingSounds.length}</strong> missing
              sound{allMissingSounds.length > 1 ? "s" : ""} from your library?
              Their files are already gone — this just cleans up the library
              entries. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmRemoveSoundsOpen(false)}
              disabled={isBulkRemoving}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRemoveAllMissingSounds}
              disabled={isBulkRemoving}
            >
              {isBulkRemoving
                ? "Removing..."
                : `Remove ${allMissingSounds.length} Sound${allMissingSounds.length > 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={confirmRemoveFoldersOpen}
        onOpenChange={setConfirmRemoveFoldersOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove All Missing Folders</DialogTitle>
            <DialogDescription>
              Remove all <strong>{allMissingFolders.length}</strong> missing
              folder{allMissingFolders.length > 1 ? "s" : ""} from your
              library? This will also remove all sounds associated with{" "}
              {allMissingFolders.length > 1 ? "those folders" : "that folder"}{" "}
              (
              <strong>
                {affectedSoundsCount} sound
                {affectedSoundsCount !== 1 ? "s" : ""}
              </strong>
              ). This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmRemoveFoldersOpen(false)}
              disabled={isBulkRemoving}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRemoveAllMissingFolders}
              disabled={isBulkRemoving}
            >
              {isBulkRemoving
                ? "Removing..."
                : `Remove ${allMissingFolders.length} Folder${allMissingFolders.length > 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
