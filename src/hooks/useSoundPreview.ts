import { useState, useCallback, useEffect } from "react";
import { playPreview, stopPreview } from "@/lib/audio/preview";
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
        await playPreview(sound.filePath, () => {
          setPreviewingId((current) => (current === sound.id ? null : current));
        });
      } catch {
        setPreviewingId(null);
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
