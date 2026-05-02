import { useEffect } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useUiStore } from "@/state/uiStore";
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { useProjectStore } from "@/state/projectStore";
import { isPadActive } from "@/lib/audio";
import { executeMultiFadeNow } from "./useMultiFadeMode";

/**
 * Registers multi-fade hotkeys and auto-cancel side effects with zero React
 * subscriptions. Uses getState() inside callbacks and a single Zustand
 * subscribe listener so the calling component never re-renders due to
 * multi-fade state changes.
 *
 * Call this once at the SceneView level. Components that need to read
 * multi-fade state should use useMultiFadeMode() or subscribe to
 * useMultiFadeStore directly.
 */
export function useMultiFadeSideEffects(): void {
  // No `enabled` option: this hook has no reactive state. The getState() guard prevents action when inactive.
  useHotkeys(
    "enter,f,x",
    () => {
      const { active, selectedPads } = useMultiFadeStore.getState();
      if (!active || selectedPads.size === 0) return;
      executeMultiFadeNow();
    },
    { enableOnFormTags: true },
  );

  // Enter multi-fade from an individually-flipped pad's back face.
  // Global editMode is excluded — no single origin pad can be inferred.
  useHotkeys(
    "x",
    () => {
      if (useMultiFadeStore.getState().active) return;
      const { editingPadId } = useUiStore.getState();
      if (!editingPadId) return;
      const { project } = useProjectStore.getState();
      const pad = project?.scenes.flatMap((s) => s.pads).find((p) => p.id === editingPadId);
      if (!pad) return;
      const currentVol = isPadActive(pad.id) ? (pad.volume ?? 100) : 0;
      useMultiFadeStore.getState().enterMultiFade(pad.id, currentVol, pad.fadeTargetVol ?? 0);
      useUiStore.getState().setEditingPadId(null);
    },
    { enableOnFormTags: false },
  );

  useHotkeys(
    "escape",
    () => {
      const { active, cancelMultiFade } = useMultiFadeStore.getState();
      if (!active) return;
      cancelMultiFade();
    },
    { enableOnFormTags: true },
  );

  useEffect(() => {
    const unsub = useUiStore.subscribe((state) => {
      const { active, cancelMultiFade } = useMultiFadeStore.getState();
      if (!active) return;
      if (state.editMode || state.overlayStack.length > 0) {
        cancelMultiFade();
      }
    });
    return unsub;
  }, []);
}
