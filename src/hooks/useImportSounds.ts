import { useCallback } from "react";
import { useLibraryStore } from "@/state/libraryStore";
import { useSaveGlobalLibrary } from "@/lib/library.queries";
import { copyFilesToFolder, tagImportedSounds } from "@/lib/import";
import { reconcileGlobalLibrary } from "@/lib/library.reconcile";
import type { GlobalFolder } from "@/lib/schemas";

/**
 * Encapsulates the copy -> reconcile -> tag -> save pipeline for importing audio files.
 *
 * Returns a stable async function that callers invoke with the paths to import.
 * Returns the count of files actually copied (0 means nothing changed).
 */
export function useImportSounds(
  importFolder: GlobalFolder | undefined,
  allFolders: GlobalFolder[],
): (paths: string[]) => Promise<number> {
  const updateLibrary = useLibraryStore((s) => s.updateLibrary);
  const { mutateAsync: saveLibrary } = useSaveGlobalLibrary();

  return useCallback(
    async (paths: string[]) => {
      if (!importFolder) return 0;

      const copied = await copyFilesToFolder(paths, importFolder.path);
      if (copied.length === 0) return 0;

      // Snapshot before reconcile -- tagImportedSounds uses this to detect new sounds.
      const soundsBeforeImport = useLibraryStore.getState().sounds;

      const result = await reconcileGlobalLibrary(allFolders, soundsBeforeImport);

      if (result.changed) {
        updateLibrary((draft) => {
          draft.sounds = result.sounds;
        });

        const { sounds: soundsAfterImport, ensureTagExists, systemAssignTagsToSounds } =
          useLibraryStore.getState();

        tagImportedSounds(
          soundsBeforeImport,
          soundsAfterImport,
          ensureTagExists,
          systemAssignTagsToSounds,
        );

        const latest = useLibraryStore.getState();
        await saveLibrary({
          version: "1.0.0",
          sounds: latest.sounds,
          tags: latest.tags,
          sets: latest.sets,
        });
      }

      return copied.length;
    },
    // importFolder.id is stable; allFolders ref is from settings (stable per render)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [importFolder?.id, allFolders, updateLibrary, saveLibrary],
  );
}
