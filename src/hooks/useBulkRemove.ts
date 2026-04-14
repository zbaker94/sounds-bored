import { useState, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { useLibraryStore } from "@/state/libraryStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { useUiStore } from "@/state/uiStore";
import { useAppSettings, useSaveAppSettings } from "@/lib/appSettings.queries";
import { useSaveCurrentLibrary } from "@/lib/library.queries";
import { refreshMissingState } from "@/lib/library.reconcile";
import { evictBuffer } from "@/lib/audio/bufferCache";
import { evictStreamingElement } from "@/lib/audio/streamingCache";
import { EMPTY_GLOBAL_FOLDERS } from "@/lib/constants";

/**
 * Encapsulates bulk-remove flows for missing sounds and folders:
 *  - handleRemoveAllMissingSounds: removes every sound currently flagged missing
 *  - handleRemoveAllMissingFolders: removes every missing folder (skipping any
 *    folder assigned as the download or import destination) plus their sounds
 *
 * Each handler evicts audio buffers/streaming elements, persists the library,
 * then re-checks missing status so the UI stays in sync.
 *
 * Dialog open/close state lives in `useUiStore` so any component in the tree
 * can trigger the confirmation dialogs without prop-threading.
 */
export function useBulkRemove(): {
  isBulkRemoving: boolean;
  handleRemoveAllMissingSounds: () => Promise<void>;
  handleRemoveAllMissingFolders: () => Promise<void>;
} {
  const [isBulkRemoving, setIsBulkRemoving] = useState(false);

  const sounds = useLibraryStore((s) => s.sounds);
  const missingSoundIds = useLibraryStore((s) => s.missingSoundIds);
  const missingFolderIds = useLibraryStore((s) => s.missingFolderIds);
  const updateLibrary = useLibraryStore((s) => s.updateLibrary);

  const { data: settings } = useAppSettings();
  const { saveCurrentLibrary } = useSaveCurrentLibrary();
  const { mutateAsync: saveSettings } = useSaveAppSettings();

  const folders = settings?.globalFolders ?? EMPTY_GLOBAL_FOLDERS;

  const allMissingSounds = useMemo(
    () => sounds.filter((s) => missingSoundIds.has(s.id)),
    [sounds, missingSoundIds],
  );

  const allMissingFolders = useMemo(
    () => folders.filter((f) => missingFolderIds.has(f.id)),
    [folders, missingFolderIds],
  );

  const handleRemoveAllMissingSounds = useCallback(async () => {
    if (!settings) return;
    setIsBulkRemoving(true);
    try {
      const idsToRemove = new globalThis.Set(allMissingSounds.map((s) => s.id));
      for (const id of idsToRemove) {
        evictBuffer(id);
        evictStreamingElement(id);
      }
      updateLibrary((draft) => {
        draft.sounds = draft.sounds.filter((s) => !idsToRemove.has(s.id));
      });
      await saveCurrentLibrary();
      await refreshMissingState(settings.globalFolders);
      toast.success(
        `${idsToRemove.size} missing sound${idsToRemove.size > 1 ? "s" : ""} removed`,
      );
    } catch {
      toast.error("Failed to remove missing sounds");
    } finally {
      setIsBulkRemoving(false);
      useUiStore.getState().setConfirmRemoveMissingSoundsOpen(false);
    }
  }, [settings, allMissingSounds, updateLibrary, saveCurrentLibrary]);

  const handleRemoveAllMissingFolders = useCallback(async () => {
    if (!settings) return;
    setIsBulkRemoving(true);
    try {
      const storeSettings = useAppSettingsStore.getState().settings;
      const assignedIds = new globalThis.Set(
        [
          storeSettings?.downloadFolderId,
          storeSettings?.importFolderId,
        ].filter(Boolean) as string[],
      );
      const safeToRemove = allMissingFolders.filter((f) => !assignedIds.has(f.id));
      const skippedCount = allMissingFolders.length - safeToRemove.length;
      const folderIdsToRemove = new globalThis.Set(safeToRemove.map((f) => f.id));
      if (folderIdsToRemove.size === 0) {
        if (skippedCount > 0) {
          toast.warning(
            `${skippedCount} folder${skippedCount > 1 ? "s" : ""} skipped — assigned as download or import destination`,
          );
        }
        return;
      }
      const updatedSettings = {
        ...settings,
        globalFolders: settings.globalFolders.filter(
          (f) => !folderIdsToRemove.has(f.id),
        ),
      };
      await saveSettings(updatedSettings);
      const soundIdsToRemove = new globalThis.Set(
        sounds
          .filter((s) => s.folderId && folderIdsToRemove.has(s.folderId))
          .map((s) => s.id),
      );
      for (const id of soundIdsToRemove) {
        evictBuffer(id);
        evictStreamingElement(id);
      }
      updateLibrary((draft) => {
        draft.sounds = draft.sounds.filter((s) => !soundIdsToRemove.has(s.id));
      });
      await saveCurrentLibrary();
      await refreshMissingState(updatedSettings.globalFolders);
      toast.success(
        `${folderIdsToRemove.size} missing folder${folderIdsToRemove.size > 1 ? "s" : ""} and ${soundIdsToRemove.size} sound${soundIdsToRemove.size !== 1 ? "s" : ""} removed`,
      );
      if (skippedCount > 0) {
        toast.warning(
          `${skippedCount} folder${skippedCount > 1 ? "s" : ""} skipped — assigned as download or import destination`,
        );
      }
    } catch {
      toast.error("Failed to remove missing folders");
    } finally {
      setIsBulkRemoving(false);
      useUiStore.getState().setConfirmRemoveMissingFoldersOpen(false);
    }
  }, [settings, sounds, allMissingFolders, updateLibrary, saveCurrentLibrary, saveSettings]);

  return {
    isBulkRemoving,
    handleRemoveAllMissingSounds,
    handleRemoveAllMissingFolders,
  };
}
