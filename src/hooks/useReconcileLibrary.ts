import { useCallback, useRef, useEffect } from "react";
import { toast } from "sonner";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { useLibraryStore } from "@/state/libraryStore";
import { useSaveCurrentLibrary } from "@/lib/library.queries";
import { reconcileGlobalLibrary, refreshMissingState } from "@/lib/library.reconcile";
import { reconcileProjectSounds } from "@/lib/projectSoundReconcile";
import { useProjectStore } from "@/state/projectStore";

export function useReconcileLibrary(): {
  reconcile: () => Promise<void>;
  isReconciling: boolean;
} {
  // isReconciling lives in libraryStore rather than component-local useState.
  // This means:
  //   1. All hook instances (MainPage + FoldersPanel) share the same flag — no
  //      misleading "false" on a second instance while reconcile is running.
  //   2. The flag is resetable in tests via useLibraryStore.setState({ ...initialLibraryState })
  //      — no module-level mutable state that leaks between test files.
  //   3. React Strict Mode's double-invocation of effects no longer causes the
  //      second (real) effect to see a stale module-level lock.
  const isReconciling = useLibraryStore((s) => s.isReconciling);
  const setIsReconciling = useLibraryStore((s) => s.setIsReconciling);
  const tryStartReconciling = useLibraryStore((s) => s.tryStartReconciling);

  const settings = useAppSettingsStore((s) => s.settings);
  const updateLibrary = useLibraryStore((s) => s.updateLibrary);
  const { saveCurrentLibrarySync } = useSaveCurrentLibrary();

  // Ref-wrap saveCurrentLibrarySync so the reconcile callback stays stable
  // without adding the TanStack Query mutation reference to its dep array.
  const saveLibraryRef = useRef(saveCurrentLibrarySync);
  useEffect(() => {
    saveLibraryRef.current = saveCurrentLibrarySync;
  }, [saveCurrentLibrarySync]);

  const reconcile = useCallback(async () => {
    if (!settings || !tryStartReconciling()) return;
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
      const currentPaths = new Set(
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
      await refreshMissingState();

      // Auto-clean orphan soundIds from any loaded project.
      // Reads state imperatively to avoid stale closure over project/sounds.
      // Note: useProjectLifecycle runs a similar reconciliation on initial project load.
      // This path handles the case where sounds are removed from the library *after*
      // the project is already loaded (e.g., a manual library reconciliation removes
      // a sound that a loaded project still references).
      const currentProject = useProjectStore.getState().project;
      if (currentProject) {
        const latestSounds = useLibraryStore.getState().sounds;
        const { project: cleaned, removedCount } = reconcileProjectSounds(currentProject, latestSounds);
        if (removedCount > 0) {
          useProjectStore.getState().updateProject(cleaned);
        }
      }

      if (useLibraryStore.getState().isDirty) {
        saveLibraryRef.current();
        // useSaveGlobalLibrary.onSuccess clears the dirty flag after a successful
        // write. Do not clear it here — clearing before save completes means a
        // failed save would silently drop changes.
      }
    } finally {
      setIsReconciling(false);
    }
  }, [settings, updateLibrary, tryStartReconciling, setIsReconciling]);

  return { reconcile, isReconciling };
}
