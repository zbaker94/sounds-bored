import { useState, useCallback, useRef, useEffect } from "react";
import { toast } from "sonner";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { useLibraryStore } from "@/state/libraryStore";
import { useSaveGlobalLibrary } from "@/lib/library.queries";
import { reconcileGlobalLibrary, checkMissingStatus } from "@/lib/library.reconcile";
import { reconcileProjectSounds } from "@/lib/projectSoundReconcile";
import { useProjectStore } from "@/state/projectStore";

// Module-level singleton: ensures at most one reconcile runs at a time across
// all hook instances (e.g. MainPage and SoundsPanel both mount concurrently).
let _reconcileInFlight = false;

export function useReconcileLibrary(): {
  reconcile: () => Promise<void>;
  isReconciling: boolean;
} {
  const [isReconciling, setIsReconciling] = useState(false);

  const settings = useAppSettingsStore((s) => s.settings);
  const updateLibrary = useLibraryStore((s) => s.updateLibrary);
  const setMissingState = useLibraryStore((s) => s.setMissingState);
  const { mutate: saveLibrary } = useSaveGlobalLibrary();

  // Ref-wrap saveLibrary so we always call the latest mutation handle
  // without adding an unstable TanStack Query reference to the dep array.
  const saveLibraryRef = useRef(saveLibrary);
  useEffect(() => {
    saveLibraryRef.current = saveLibrary;
  }, [saveLibrary]);

  const reconcile = useCallback(async () => {
    if (!settings || _reconcileInFlight) return;
    _reconcileInFlight = true;
    setIsReconciling(true);
    try {
      const result = await reconcileGlobalLibrary(
        settings.globalFolders,
        useLibraryStore.getState().sounds,
      );

      // Warn about any folders the app couldn't read (outside fs scope).
      if (result.inaccessibleFolderIds.length > 0) {
        const names = settings.globalFolders
          .filter((f) => result.inaccessibleFolderIds.includes(f.id))
          .map((f) => f.name)
          .join(", ");
        toast.warning(
          `${result.inaccessibleFolderIds.length === 1 ? "Folder" : "Folders"} could not be scanned: ${names}. Move them to Music, Documents, Downloads, or Desktop.`,
        );
      }

      // Merge new sounds into the store by filePath — never replaces existing
      // sounds so any user edits (tags, sets) made during the async scan are
      // always preserved. External filesystem changes are always reflected.
      const currentPaths = new globalThis.Set(
        useLibraryStore.getState().sounds.map((s) => s.filePath).filter(Boolean),
      );
      const soundsToAdd = result.sounds.filter(
        (s) => s.filePath && !currentPaths.has(s.filePath),
      );
      if (soundsToAdd.length > 0) {
        updateLibrary((draft) => {
          for (const sound of soundsToAdd) {
            draft.sounds.push(sound);
          }
        });
      }

      // Always refresh missing-file/folder state so UI reflects the current
      // filesystem regardless of whether new sounds were discovered.
      const missingResult = await checkMissingStatus(
        settings.globalFolders,
        useLibraryStore.getState().sounds,
      );
      setMissingState(missingResult.missingSoundIds, missingResult.missingFolderIds);

      // Auto-clean orphan soundIds from any loaded project.
      // Reads state imperatively to avoid stale closure over project/sounds.
      const currentProject = useProjectStore.getState().project;
      if (currentProject) {
        const latestSounds = useLibraryStore.getState().sounds;
        const { project: cleaned, removedCount } = reconcileProjectSounds(currentProject, latestSounds);
        if (removedCount > 0) {
          useProjectStore.getState().updateProject(cleaned);
        }
      }

      if (useLibraryStore.getState().isDirty) {
        const latest = useLibraryStore.getState();
        saveLibraryRef.current({ version: "1.0.0", sounds: latest.sounds, tags: latest.tags, sets: latest.sets });
        // useSaveGlobalLibrary.onSuccess clears the dirty flag after a successful
        // write. Do not clear it here — clearing before save completes means a
        // failed save would silently drop changes.
      }
    } finally {
      _reconcileInFlight = false;
      setIsReconciling(false);
    }
  }, [settings, updateLibrary, setMissingState]);

  return { reconcile, isReconciling };
}
