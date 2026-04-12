import { useState, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { useLibraryStore } from "@/state/libraryStore";
import { useAppSettings, useSaveAppSettings } from "@/lib/appSettings.queries";
import { useSaveGlobalLibrary } from "@/lib/library.queries";
import { reconcileGlobalLibrary } from "@/lib/library.reconcile";
import { CURRENT_LIBRARY_VERSION } from "@/lib/constants";
import type { GlobalFolder } from "@/lib/schemas";

/**
 * Encapsulates the "add a GlobalFolder" flow:
 *  - Open a directory picker
 *  - Validate (no duplicate path)
 *  - Persist new folder to app settings
 *  - Reconcile library against the new folder list
 *  - Persist updated library if it changed
 *  - Show toast feedback
 */
export function useAddFolder(): {
  isAddingFolder: boolean;
  handleAddFolder: () => Promise<void>;
} {
  const [isAddingFolder, setIsAddingFolder] = useState(false);

  const sounds = useLibraryStore((s) => s.sounds);
  const updateLibrary = useLibraryStore((s) => s.updateLibrary);

  const { data: settings } = useAppSettings();
  const { mutateAsync: saveLibrary } = useSaveGlobalLibrary();
  const { mutateAsync: saveSettings } = useSaveAppSettings();

  const handleAddFolder = useCallback(async () => {
    if (!settings) return;
    setIsAddingFolder(true);
    try {
      const selected = await open({ directory: true });
      if (!selected || typeof selected !== "string") return;
      if (settings.globalFolders.some((f) => f.path === selected)) {
        toast.error("That folder is already in your library.");
        return;
      }
      const name = selected.split(/[\\/]/).pop() ?? selected;
      const newFolder: GlobalFolder = {
        id: crypto.randomUUID(),
        path: selected,
        name,
      };
      const updatedSettings = {
        ...settings,
        globalFolders: [...settings.globalFolders, newFolder],
      };
      await saveSettings(updatedSettings);

      const result = await reconcileGlobalLibrary(
        updatedSettings.globalFolders,
        sounds,
      );
      if (result.changed) {
        updateLibrary((draft) => {
          draft.sounds = result.sounds;
        });
        const latest = useLibraryStore.getState();
        await saveLibrary({
          version: CURRENT_LIBRARY_VERSION,
          sounds: latest.sounds,
          tags: latest.tags,
          sets: latest.sets,
        });
      }
      toast.success(`Folder "${name}" added`);
    } finally {
      setIsAddingFolder(false);
    }
  }, [settings, sounds, updateLibrary, saveLibrary, saveSettings]);

  return { isAddingFolder, handleAddFolder };
}
