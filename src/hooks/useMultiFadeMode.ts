import { useCallback } from "react";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { useProjectStore } from "@/state/projectStore";
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { executeFadeTap } from "@/lib/audio/padPlayer";
import { buildPadMap } from "@/lib/padDefaults";

export function executeMultiFadeNow(): void {
  const { selectedPads, resetMultiFade } = useMultiFadeStore.getState();
  if (selectedPads.size === 0) return;
  const scenes = useProjectStore.getState().project?.scenes ?? [];
  const padMap = buildPadMap(scenes);
  const globalFadeDurationMs = useAppSettingsStore.getState().settings?.globalFadeDurationMs;

  for (const [padId] of selectedPads) {
    const pad = padMap.get(padId);
    if (!pad) continue;
    executeFadeTap(pad, globalFadeDurationMs);
  }
  resetMultiFade();
}

export interface UseMultiFadeModeReturn {
  active: boolean;
  originPadId: string | null;
  selectedPads: ReturnType<typeof useMultiFadeStore.getState>["selectedPads"];
  enter: (originPadId: string) => void;
  togglePad: (padId: string) => void;
  setFadeLevels: (padId: string, levels: [number, number]) => void;
  canExecute: boolean;
  execute: () => void;
  cancel: () => void;
  reopenPadId: string | null;
  clearReopenPadId: () => void;
}

/**
 * Core multi-fade mode state and callbacks. Exposes active/selected pad state,
 * enter/toggle/cancel/execute actions, and derived canExecute flag.
 *
 * Hotkey registration and auto-cancel side effects (editMode, overlayStack) are
 * handled separately in `useMultiFadeSideEffects`.
 */
export function useMultiFadeMode(): UseMultiFadeModeReturn {
  const active = useMultiFadeStore((s) => s.active);
  const originPadId = useMultiFadeStore((s) => s.originPadId);
  const selectedPads = useMultiFadeStore((s) => s.selectedPads);
  const reopenPadId = useMultiFadeStore((s) => s.reopenPadId);
  const enterMultiFade = useMultiFadeStore((s) => s.enterMultiFade);
  const toggleMultiFadePad = useMultiFadeStore((s) => s.toggleMultiFadePad);
  const setMultiFadeLevels = useMultiFadeStore((s) => s.setMultiFadeLevels);
  const cancelMultiFade = useMultiFadeStore((s) => s.cancelMultiFade);
  const clearMultiFadeReopenPadId = useMultiFadeStore((s) => s.clearMultiFadeReopenPadId);

  const canExecute = active && selectedPads.size >= 1;

  const enter = useCallback((padId: string) => {
    const scenes = useProjectStore.getState().project?.scenes ?? [];
    const padMap = buildPadMap(scenes);
    const pad = padMap.get(padId);
    enterMultiFade(padId, pad?.volume ?? 100, pad?.fadeTargetVol ?? 0);
  }, [enterMultiFade]);

  const togglePad = useCallback((padId: string) => {
    const scenes = useProjectStore.getState().project?.scenes ?? [];
    const padMap = buildPadMap(scenes);
    const pad = padMap.get(padId);
    toggleMultiFadePad(padId, pad?.volume ?? 100, pad?.fadeTargetVol ?? 0);
  }, [toggleMultiFadePad]);

  const setFadeLevels = useCallback((padId: string, levels: [number, number]) => {
    setMultiFadeLevels(padId, levels);
  }, [setMultiFadeLevels]);

  const execute = useCallback(() => {
    if (!canExecute) return;
    executeMultiFadeNow();
  }, [canExecute]);

  const cancel = useCallback(() => {
    cancelMultiFade();
  }, [cancelMultiFade]);

  const clearReopenPadId = useCallback(() => {
    clearMultiFadeReopenPadId();
  }, [clearMultiFadeReopenPadId]);

  return {
    active,
    originPadId,
    selectedPads,
    enter,
    togglePad,
    setFadeLevels,
    canExecute,
    execute,
    cancel,
    reopenPadId,
    clearReopenPadId,
  };
}
