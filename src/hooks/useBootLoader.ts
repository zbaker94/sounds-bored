import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { useLibraryStore } from "@/state/libraryStore";
import { useDownloadStore } from "@/state/downloadStore";
import { reconcileGlobalLibrary, refreshMissingState, scheduleAnalysisForUnanalyzed } from "@/lib/library.reconcile";
import { loadGlobalLibrary } from "@/lib/library";
import { useSaveCurrentLibrary } from "@/lib/library.queries";
import { loadAppSettings } from "@/lib/appSettings";
import { loadDownloadHistory } from "@/lib/downloads";
import { restorePathScope } from "@/lib/scope";
import { SYSTEM_TAG_IMPORTED } from "@/lib/constants";
import { logInfo, logWarn, logError } from "@/lib/logger";

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
  // `*Attempted` (not `*Loaded`): these flags flip true once the async load
  // finishes, regardless of success or failure. The reconciliation effect is
  // gated on both attempts completing — it reads the resulting store state to
  // decide whether there is anything to reconcile.
  const [settingsAttempted, setSettingsAttempted] = useState(false);
  const [libraryAttempted, setLibraryAttempted] = useState(false);
  const hasReconciled = useRef(false);
  const { saveCurrentLibrarySync } = useSaveCurrentLibrary();

  // One-time load at mount — plain async functions, no query subscription.
  // Both loads are independent and fire in parallel.
  useEffect(() => {
    loadAppSettings()
      .then(async (settings) => {
        useAppSettingsStore.getState().loadSettings(settings);
        logInfo("App settings loaded");
        // Re-establish runtime fs-scope grants for all persisted folders.
        // Tauri's allow_directory grants are session-only and are lost on restart,
        // so they must be replayed before reconciliation reads those directories.
        const grantResults = await Promise.allSettled(
          settings.globalFolders.map((f) => restorePathScope(f.path))
        );
        const failedGrants = grantResults.filter((r) => r.status === "rejected").length;
        if (failedGrants > 0) {
          logWarn("Could not re-grant folder access", { failedGrants });
          toast.warning(`Could not re-grant access to ${failedGrants} folder(s). Some library folders may be inaccessible.`);
        }
        setSettingsAttempted(true);
      })
      .catch((err) => {
        logError("Failed to load app settings", err instanceof Error ? err : { error: String(err) });
        toast.error("Failed to load app settings");
        setSettingsAttempted(true);
      });
    loadGlobalLibrary({ onCorruption: (msg) => toast.warning(msg) })
      .then((library) => {
        useLibraryStore.getState().loadLibrary(library);
        logInfo("Sound library loaded", { soundCount: library.sounds.length });
        setLibraryAttempted(true);
      })
      .catch((err) => {
        logError("Failed to load sound library", err instanceof Error ? err : { error: String(err) });
        toast.error("Failed to load sound library");
        setLibraryAttempted(true);
      });
    loadDownloadHistory({ onCorruption: (msg) => toast.warning(msg) })
      .then((jobs) => { useDownloadStore.getState().loadJobs(jobs); })
      .catch((err) => {
        logError("Failed to load download history", err instanceof Error ? err : { error: String(err) });
      });
  }, []);

  useEffect(() => {
    if (!settingsAttempted || !libraryAttempted || hasReconciled.current) return;
    hasReconciled.current = true;

    // Read settings from the store — the loadAppSettings().then() above has
    // already run by the time this effect fires (settingsAttempted is true).
    const settings = useAppSettingsStore.getState().settings;
    if (!settings) return;

    // Use the current store snapshot (not a stale local variable) as the
    // reconciliation baseline. The store is always up-to-date; reading it
    // imperatively here avoids the stale-closure problem that existed when
    // this was driven by query-cache data.
    const soundsAtReconcileStart = useLibraryStore.getState().sounds;

    reconcileGlobalLibrary(settings.globalFolders, soundsAtReconcileStart)
      .then((result) => {
        logInfo("Library reconciled", { changed: result.changed });
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
          saveCurrentLibrarySync({
            onError: (err) => {
              logError("Failed to save sound library", err instanceof Error ? err : { error: String(err) });
              toast.error("Failed to save sound library");
            },
          });
        }

        // Schedule background loudness analysis for unanalyzed sounds.
        if (settings.autoAnalysis) {
          void scheduleAnalysisForUnanalyzed(useLibraryStore.getState().sounds);
        }
      })
      .catch((err) => {
        logError("Failed to scan sound folders", err instanceof Error ? err : { error: String(err) });
        toast.error("Failed to scan sound folders");
      })
      .finally(() => {
        // Always refresh missing-file state, even if reconciliation failed.
        void refreshMissingState();
      });
  }, [settingsAttempted, libraryAttempted]);

  return { ready: settingsAttempted && libraryAttempted };
}
