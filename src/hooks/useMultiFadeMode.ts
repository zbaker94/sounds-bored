import { useCallback, useEffect } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useUiStore } from "@/state/uiStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { useProjectStore } from "@/state/projectStore";
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { fadePadWithLevels, resolveFadeDuration } from "@/lib/audio/padPlayer";
import { toast } from "sonner";

export type { SelectedPadFade } from "@/state/multiFadeStore";

export function executeMultiFadeNow(): void {
  const { selectedPads, resetMultiFade } = useMultiFadeStore.getState();
  if (selectedPads.size === 0) return;
  const pads = useProjectStore.getState().project?.scenes.flatMap((s) => s.pads) ?? [];
  const globalFadeDurationMs = useAppSettingsStore.getState().settings?.globalFadeDurationMs;

  for (const [padId] of selectedPads) {
    const pad = pads.find((p) => p.id === padId);
    if (!pad) continue;
    const duration = resolveFadeDuration(pad, globalFadeDurationMs);
    fadePadWithLevels(pad, duration).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Playback error: audio fade failed — ${message}`);
    });
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

  const editMode = useUiStore((s) => s.editMode);
  const overlayStack = useUiStore((s) => s.overlayStack);

  // Cancel when edit mode activates
  useEffect(() => {
    if (editMode && active) {
      cancelMultiFade();
    }
  }, [editMode, active, cancelMultiFade]);

  // Cancel when any overlay opens
  useEffect(() => {
    if (overlayStack.length > 0 && active) {
      cancelMultiFade();
    }
  }, [overlayStack.length, active, cancelMultiFade]);

  const canExecute = active && selectedPads.size >= 1;

  const enter = useCallback((padId: string) => {
    const pads = useProjectStore.getState().project?.scenes.flatMap((s) => s.pads) ?? [];
    const pad = pads.find((p) => p.id === padId);
    enterMultiFade(padId, pad?.fadeLowVol ?? 0, pad?.fadeHighVol ?? 1);
  }, [enterMultiFade]);

  const togglePad = useCallback((padId: string) => {
    const pads = useProjectStore.getState().project?.scenes.flatMap((s) => s.pads) ?? [];
    const pad = pads.find((p) => p.id === padId);
    toggleMultiFadePad(padId, pad?.fadeLowVol ?? 0, pad?.fadeHighVol ?? 1);
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

  // enableOnFormTags: PadButtonFadeOverlay renders <Slider> controls (role="slider") over
  // selected pads. The user may focus a slider thumb to set fade levels, then press
  // F/X/Enter/Escape — those keys must not be blocked by the default form-tag guard.
  useHotkeys("enter", execute, { enabled: active && canExecute, enableOnFormTags: true }, [active, canExecute, execute]);
  useHotkeys("f,x", execute, { enabled: active && canExecute, enableOnFormTags: true }, [active, canExecute, execute]);
  useHotkeys("escape", cancel, { enabled: active, enableOnFormTags: true }, [active, cancel]);

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
