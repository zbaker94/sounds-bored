import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { useLibraryStore } from "@/state/libraryStore";
import { reconcileGlobalLibrary, refreshMissingState } from "@/lib/library.reconcile";
import { loadGlobalLibrary, saveGlobalLibrary, LibraryValidationError } from "@/lib/library";
import { loadAppSettings } from "@/lib/appSettings";
import { getCurrentLibraryPayload } from "@/lib/library.queries";
import { SYSTEM_TAG_IMPORTED } from "@/lib/constants";

/**
 * Loads appSettings and globalLibrary from disk into their respective
 * Zustand stores at app boot. Uses direct async calls — no TanStack Query
 * cache — so there is no dual-ownership window where a query refetch can
 * overwrite in-flight Zustand mutations.
 *
 * After both are loaded, runs one-time reconciliation to discover new audio
 * files in globalFolders and backfill folderIds on existing sounds.
 */
export function useBootLoader(): { ready: boolean } {
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const hasReconciled = useRef(false);

  // One-time load at mount — plain async functions, no query subscription.
  // Both loads are independent and fire in parallel.
  useEffect(() => {
    loadAppSettings()
      .then((settings) => {
        useAppSettingsStore.getState().loadSettings(settings);
        setSettingsLoaded(true);
      })
      .catch(() => {
        toast.error("Failed to load app settings");
        setSettingsLoaded(true);
      });
    loadGlobalLibrary()
      .then((library) => {
        useLibraryStore.getState().loadLibrary(library);
        setLibraryLoaded(true);
      })
      .catch((error: unknown) => {
        if (error instanceof LibraryValidationError) {
          toast.error(`Library load failed: ${error.message}`);
        } else {
          toast.error("Failed to load sound library");
        }
        setLibraryLoaded(true);
      });
  }, []);

  useEffect(() => {
    if (!settingsLoaded || !libraryLoaded || hasReconciled.current) return;
    hasReconciled.current = true;

    // Read settings from the store — the loadAppSettings().then() above has
    // already run by the time this effect fires (settingsLoaded is true).
    const settings = useAppSettingsStore.getState().settings;
    if (!settings) return;

    // Use the current store snapshot (not a stale local variable) as the
    // reconciliation baseline. The store is always up-to-date; reading it
    // imperatively here avoids the stale-closure problem that existed when
    // this was driven by query-cache data.
    const soundsAtReconcileStart = useLibraryStore.getState().sounds;

    reconcileGlobalLibrary(settings.globalFolders, soundsAtReconcileStart)
      .then((result) => {
        // Only apply if the store hasn't been mutated since we started the scan.
        // If isDirty is true, the user (or another effect) modified the library
        // while the async folder scan was running — their changes take priority.
        if (result.changed && !useLibraryStore.getState().isDirty) {
          useLibraryStore.getState().updateLibrary((draft) => {
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
          void saveGlobalLibrary(getCurrentLibraryPayload())
            .then(() => {
              useLibraryStore.getState().clearDirtyFlag();
            })
            .catch(() => {
              toast.error("Failed to save sound library");
            });
        }
      })
      .catch(() => {
        toast.error("Failed to scan sound folders");
      })
      .finally(() => {
        // Always refresh missing-file state, even if reconciliation failed.
        void refreshMissingState();
      });
  }, [settingsLoaded, libraryLoaded]);

  return { ready: settingsLoaded && libraryLoaded };
}
