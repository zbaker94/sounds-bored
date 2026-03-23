import { useEffect, useRef } from "react";
import { useAppSettings } from "@/lib/appSettings.queries";
import { useGlobalLibrary } from "@/lib/library.queries";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { useLibraryStore } from "@/state/libraryStore";
import { reconcileGlobalLibrary } from "@/lib/library.reconcile";

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

    reconcileGlobalLibrary(settings.globalFolders, library.sounds).then(
      (result) => {
        if (result.changed) {
          updateLibrary((draft) => {
            draft.sounds = result.sounds;
          });
        }
      },
    );
  }, [settings, library, updateLibrary]);
}
