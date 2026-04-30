import { useEffect, useRef } from "react";
import { useProjectStore } from "@/state/projectStore";
import { applyProjectSoundReconcile } from "@/lib/project.reconcile";

export function useProjectSoundReconcileOnLoad() {
  const project = useProjectStore((s) => s.project);
  const loadSessionId = useProjectStore((s) => s.loadSessionId);
  const cleanedSessionIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!project) return;
    if (cleanedSessionIdRef.current === loadSessionId) return;
    cleanedSessionIdRef.current = loadSessionId;

    applyProjectSoundReconcile();
  }, [project, loadSessionId]);
}
