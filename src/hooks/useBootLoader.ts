import { useEffect, useRef } from "react";
import { useAppSettings } from "@/lib/appSettings.queries";
import { useGlobalLibrary, useSaveCurrentLibrary } from "@/lib/library.queries";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { useLibraryStore } from "@/state/libraryStore";
import { reconcileGlobalLibrary, refreshMissingState } from "@/lib/library.reconcile";
import { SYSTEM_TAG_IMPORTED } from "@/lib/constants";

/**
 * Loads appSettings and globalLibrary from disk into their respective
 * Zustand stores at app boot. TanStack Query handles the fetching and
 * caching; this hook bridges the gap by pushing the data into Zustand
 * so the rest of the app can use store selectors.
 *
 * After both are loaded, runs reconciliation to discover new audio files
 * in globalFolders and backfill folderIds on existing sounds.
 */
export function useBootLoader() {
  const { data: settings } = useAppSettings();
  const { data: library } = useGlobalLibrary();

  const { saveCurrentLibrarySync } = useSaveCurrentLibrary();

  const loadSettings = useAppSettingsStore((s) => s.loadSettings);
  const loadLibrary = useLibraryStore((s) => s.loadLibrary);
  const updateLibrary = useLibraryStore((s) => s.updateLibrary);

  const hasReconciled = useRef(false);

  useEffect(() => {
    if (settings) {
      loadSettings(settings);
    }
  }, [settings, loadSettings]);

  useEffect(() => {
    if (library) {
      loadLibrary(library);
    }
  }, [library, loadLibrary]);

  useEffect(() => {
    if (!settings || !library || hasReconciled.current) return;
    hasReconciled.current = true;

    // Use the current store snapshot (not the query-cache snapshot) as the
    // reconciliation baseline. The store is always up-to-date; the query cache
    // can be stale while a background refetch is in flight, which would cause
    // reconciliation to overwrite any tag assignments the user made between
    // when the effect fired and when the async scan completes.
    const soundsAtReconcileStart = useLibraryStore.getState().sounds;

    reconcileGlobalLibrary(settings.globalFolders, soundsAtReconcileStart).then(
      (result) => {
        // Only apply if the store hasn't been mutated since we started the scan.
        // If isDirty is true, the user (or another effect) modified the library
        // while the async folder scan was running — their changes take priority.
        if (result.changed && !useLibraryStore.getState().isDirty) {
          updateLibrary((draft) => {
            draft.sounds = result.sounds;
          });
        }

        // Retroactively ensure all sounds in the import folder have the "imported" tag.
        // This handles sounds that were imported before this feature existed.
        const { sounds: currentSounds, tags: currentTags, ensureTagExists, systemAssignTagsToSounds } =
          useLibraryStore.getState();
        const importFolderId = settings.importFolderId;
        const existingImportedTag = currentTags.find(
          (t) => t.name.toLowerCase() === SYSTEM_TAG_IMPORTED,
        );
        const untaggedImportIds = currentSounds
          .filter(
            (s) =>
              s.folderId === importFolderId &&
              !(existingImportedTag && s.tags.includes(existingImportedTag.id)),
          )
          .map((s) => s.id);
        if (untaggedImportIds.length > 0) {
          const importedTag = ensureTagExists(SYSTEM_TAG_IMPORTED, undefined, true);
          systemAssignTagsToSounds(untaggedImportIds, [importedTag.id]);
        }

        // Persist if reconciliation changed sounds OR we just tagged import folder sounds.
        if (useLibraryStore.getState().isDirty) {
          saveCurrentLibrarySync();
        }

        // Refresh missing-file state after reconciliation
        void refreshMissingState();
      },
    );
  }, [settings, library, updateLibrary, saveCurrentLibrarySync]);
}
