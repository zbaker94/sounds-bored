import { useCallback } from "react";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { useProjectStore } from "@/state/projectStore";
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { usePadMetricsStore } from "@/state/padMetricsStore";
import { executeFadeTap, triggerPad, isPadActive, emitAudioError } from "@/lib/audio";
import { buildPadMap } from "@/lib/padDefaults";

export function executeMultiFadeNow(): void {
  const { selectedPads, resetMultiFade } = useMultiFadeStore.getState();
  if (selectedPads.size === 0) return;
  const scenes = useProjectStore.getState().project?.scenes ?? [];
  const padMap = buildPadMap(scenes);
  const globalFadeDurationMs = useAppSettingsStore.getState().settings?.globalFadeDurationMs;

  for (const [padId, entry] of selectedPads) {
    const pad = padMap.get(padId);
    if (!pad) continue;
    const [, targetPct] = entry.levels;
    if (!isPadActive(padId) && targetPct === 0) {
      // Non-playing pad with no fade target — trigger it rather than silently no-op
      triggerPad(pad).catch((err: unknown) => { emitAudioError(err); });
    } else {
      // Use the overlay's in-flight target (entry.levels[1]) so mid-drag slider
      // values are captured even if onValueCommit hasn't fired yet.
      executeFadeTap({ ...pad, fadeTargetVol: targetPct }, globalFadeDurationMs);
    }
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
    const padVolumes = usePadMetricsStore.getState().padVolumes;
    const liveVol01 = padVolumes[padId] ?? 1;
    const currentVol = isPadActive(padId) ? (liveVol01 * 100) : 0;
    enterMultiFade(padId, currentVol, pad?.fadeTargetVol ?? 0);
  }, [enterMultiFade]);

  const togglePad = useCallback((padId: string) => {
    const scenes = useProjectStore.getState().project?.scenes ?? [];
    const padMap = buildPadMap(scenes);
    const pad = padMap.get(padId);
    const padVolumes = usePadMetricsStore.getState().padVolumes;
    const liveVol01 = padVolumes[padId] ?? 1;
    const currentVol = isPadActive(padId) ? (liveVol01 * 100) : 0;
    toggleMultiFadePad(padId, currentVol, pad?.fadeTargetVol ?? 0);
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
