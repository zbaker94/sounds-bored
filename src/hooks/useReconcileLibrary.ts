import { useState, useCallback, useRef, useEffect } from "react";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { useLibraryStore } from "@/state/libraryStore";
import { useSaveGlobalLibrary } from "@/lib/library.queries";
import { reconcileGlobalLibrary, checkMissingStatus } from "@/lib/library.reconcile";

export function useReconcileLibrary(): {
  reconcile: () => Promise<void>;
  isReconciling: boolean;
} {
  const [isReconciling, setIsReconciling] = useState(false);
  // Ref-based guard so the in-flight check survives re-renders without
  // causing reconcile to be recreated on every state change.
  const isReconcilingRef = useRef(false);

  const settings = useAppSettingsStore((s) => s.settings);
  const updateLibrary = useLibraryStore((s) => s.updateLibrary);
  const clearDirtyFlag = useLibraryStore((s) => s.clearDirtyFlag);
  const setMissingState = useLibraryStore((s) => s.setMissingState);
  const { mutate: saveLibrary } = useSaveGlobalLibrary();

  // Ref-wrap saveLibrary so we always call the latest mutation handle
  // without adding an unstable TanStack Query reference to the dep array.
  const saveLibraryRef = useRef(saveLibrary);
  useEffect(() => {
    saveLibraryRef.current = saveLibrary;
  }, [saveLibrary]);

  const reconcile = useCallback(async () => {
    if (!settings || isReconcilingRef.current) return;
    isReconcilingRef.current = true;
    setIsReconciling(true);
    try {
      const result = await reconcileGlobalLibrary(
        settings.globalFolders,
        useLibraryStore.getState().sounds,
      );

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

      if (useLibraryStore.getState().isDirty) {
        const latest = useLibraryStore.getState();
        saveLibraryRef.current({ version: "1.0.0", sounds: latest.sounds, tags: latest.tags, sets: latest.sets });
        // Clear immediately so a rapid second refresh doesn't hit the dirty
        // window while the async mutation is still in flight. useSaveGlobalLibrary
        // also calls clearDirtyFlag in onSuccess as the authoritative clear.
        clearDirtyFlag();
      }
    } finally {
      isReconcilingRef.current = false;
      setIsReconciling(false);
    }
  }, [settings, updateLibrary, clearDirtyFlag, setMissingState]);

  return { reconcile, isReconciling };
}
