import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useProjectStore } from "@/state/projectStore";
import { useLibraryStore } from "@/state/libraryStore";

// Fires at most once per project-load session — Save As (markAsPermanent) does
// not increment loadSessionId and therefore does not re-trigger this toast.
// Intentional: if reconcile discovers additional missing sounds after the first
// notification for a session, those are silently suppressed. Reconcile runs once
// per load, so missingSoundIds is stable by the time this fires.
export function useMissingSoundsNotification() {
  const project = useProjectStore((s) => s.project);
  const loadSessionId = useProjectStore((s) => s.loadSessionId);
  const missingSoundIds = useLibraryStore((s) => s.missingSoundIds);
  const lastNotifiedSessionId = useRef<number | null>(null);

  useEffect(() => {
    if (!project || missingSoundIds.size === 0) return;
    if (lastNotifiedSessionId.current === loadSessionId) return;
    lastNotifiedSessionId.current = loadSessionId;

    const usedSoundIds = new Set(
      project.scenes.flatMap((scene) =>
        scene.pads.flatMap((pad) =>
          pad.layers.flatMap((layer) =>
            layer.selection.type === "assigned"
              ? layer.selection.instances.map((i) => i.soundId)
              : [],
          ),
        ),
      ),
    );

    const missingUsedCount = [...usedSoundIds].filter((id) => missingSoundIds.has(id)).length;
    if (missingUsedCount > 0) {
      toast.warning(
        `${missingUsedCount} sound${missingUsedCount > 1 ? "s" : ""} used in this project are missing. Check the Sounds panel.`,
      );
    }
  }, [project, missingSoundIds, loadSessionId]);
}
