import { useState, useCallback } from "react";
import { toast } from "sonner";
import { useLibraryStore } from "@/state/libraryStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { useSaveAppSettings } from "@/lib/appSettings.queries";
import { useSaveCurrentLibrary } from "@/lib/library.queries";
import { reconcileGlobalLibrary } from "@/lib/library.reconcile";
import { pickFolder } from "@/lib/scope";
import { basename } from "@/lib/utils";
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

  const settings = useAppSettingsStore((s) => s.settings);
  const { saveCurrentLibrary } = useSaveCurrentLibrary();
  const { mutateAsync: saveSettings } = useSaveAppSettings();

  const handleAddFolder = useCallback(async () => {
    if (!settings) return;
    setIsAddingFolder(true);
    try {
      const selected = await pickFolder();
      if (!selected) return;
      if (settings.globalFolders.some((f) => f.path === selected)) {
        toast.error("That folder is already in your library.");
        return;
      }
      const name = basename(selected, selected);
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
        await saveCurrentLibrary();
      }
      toast.success(`Folder "${name}" added`);
    } catch (err) {
      toast.error(`Failed to add folder: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsAddingFolder(false);
    }
  }, [settings, sounds, updateLibrary, saveCurrentLibrary, saveSettings]);

  return { isAddingFolder, handleAddFolder };
}
