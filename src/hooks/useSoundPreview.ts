import { useState, useCallback, useEffect } from "react";
import { playPreview, stopPreview } from "@/lib/audio";
import { MissingFileError, refreshMissingState } from "@/lib/library.reconcile";
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
          void refreshMissingState();
        } else {
          console.error("[useSoundPreview]", err);
          toast.error(`Preview failed: ${err instanceof Error ? err.message : "Unknown error"}`);
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
