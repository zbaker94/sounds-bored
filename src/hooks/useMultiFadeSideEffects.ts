import { useEffect } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useUiStore } from "@/state/uiStore";
import { useMultiFadeStore } from "@/state/multiFadeStore";
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
