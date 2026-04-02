import { useState, useCallback, useEffect } from "react";
import { playPreview, stopPreview } from "@/lib/audio/preview";
import { MissingFileError, checkMissingStatus } from "@/lib/library.reconcile";
import { useLibraryStore } from "@/state/libraryStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { toast } from "sonner";
import type { Sound } from "@/lib/schemas";

export function useSoundPreview() {
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  const togglePreview = useCallback(
    async (sound: Sound) => {
      if (!sound.filePath) return;

      if (previewingId === sound.id) {
        stopPreview();
        setPreviewingId(null);
        return;
      }

      setPreviewingId(sound.id);
      try {
        await playPreview(sound, () => {
          setPreviewingId((current) => (current === sound.id ? null : current));
        });
      } catch (err) {
        setPreviewingId(null);
        if (err instanceof MissingFileError) {
          toast.error(`"${sound.name}" not found — check the Sounds panel`);
          const settings = useAppSettingsStore.getState().settings;
          if (settings) {
            const { sounds } = useLibraryStore.getState();
            checkMissingStatus(settings.globalFolders, sounds).then((result) => {
              useLibraryStore.getState().setMissingState(result.missingSoundIds, result.missingFolderIds);
            });
          }
        }
      }
    },
    [previewingId],
  );

  const stop = useCallback(() => {
    stopPreview();
    setPreviewingId(null);
  }, []);

  useEffect(() => {
    return () => {
      stopPreview();
    };
  }, []);

  return { previewingId, togglePreview, stopPreview: stop };
}
