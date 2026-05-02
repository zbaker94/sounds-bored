import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useUiStore, OVERLAY_ID, selectIsOverlayOpen } from "@/state/uiStore";
import { useBulkRemove } from "@/hooks/useBulkRemove";

/**
 * Renders the two "Remove All Missing" confirmation dialogs triggered by
 * the amber banners in FoldersPanel / SoundList. Self-contained: pulls
 * bulk-remove state/handlers from useBulkRemove() and dialog open/close
 * flags from useUiStore directly — no prop threading.
 */
export function ConfirmRemoveMissingDialog() {
  const confirmRemoveSoundsOpen = useUiStore(selectIsOverlayOpen(OVERLAY_ID.CONFIRM_REMOVE_MISSING_SOUNDS));
  const confirmRemoveFoldersOpen = useUiStore(selectIsOverlayOpen(OVERLAY_ID.CONFIRM_REMOVE_MISSING_FOLDERS));
  const closeOverlay = useUiStore((s) => s.closeOverlay);

  const {
    isBulkRemoving,
    allMissingSounds,
    allMissingFolders,
    affectedSoundsCount,
    handleRemoveAllMissingSounds,
    handleRemoveAllMissingFolders,
  } = useBulkRemove();

  return (
    <>
      <Dialog
        open={confirmRemoveSoundsOpen}
        onOpenChange={(open) => { if (!open) closeOverlay(OVERLAY_ID.CONFIRM_REMOVE_MISSING_SOUNDS); }}
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
              onClick={() => closeOverlay(OVERLAY_ID.CONFIRM_REMOVE_MISSING_SOUNDS)}
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
        onOpenChange={(open) => { if (!open) closeOverlay(OVERLAY_ID.CONFIRM_REMOVE_MISSING_FOLDERS); }}
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
              onClick={() => closeOverlay(OVERLAY_ID.CONFIRM_REMOVE_MISSING_FOLDERS)}
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
