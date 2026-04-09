import { useCallback, useEffect } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useUiStore } from "@/state/uiStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { useProjectStore } from "@/state/projectStore";
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { fadePadWithLevels, resolveFadeDuration } from "@/lib/audio/padPlayer";
import { isPadActive } from "@/lib/audio/audioState";
import { toast } from "sonner";

export type { SelectedPadFade } from "@/state/multiFadeStore";

export interface UseMultiFadeModeReturn {
  active: boolean;
  originPadId: string | null;
  selectedPads: ReturnType<typeof useMultiFadeStore.getState>["selectedPads"];
  enter: (originPadId: string, currentVolume?: number) => void;
  togglePad: (padId: string, playing: boolean, currentVolume?: number) => void;
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
  const resetMultiFade = useMultiFadeStore((s) => s.resetMultiFade);
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

  const enter = useCallback((padId: string, currentVolume?: number) => {
    const playing = isPadActive(padId);
    const vol = currentVolume ?? 1.0;
    enterMultiFade(padId, playing, vol);
  }, [enterMultiFade]);

  const togglePad = useCallback((padId: string, playing: boolean, currentVolume?: number) => {
    toggleMultiFadePad(padId, playing, currentVolume ?? 1.0);
  }, [toggleMultiFadePad]);

  const setFadeLevels = useCallback((padId: string, levels: [number, number]) => {
    setMultiFadeLevels(padId, levels);
  }, [setMultiFadeLevels]);

  const execute = useCallback(() => {
    if (!canExecute) return;
    const pads = useProjectStore.getState().project?.scenes.flatMap((s) => s.pads) ?? [];
    const allSelectedPads = useMultiFadeStore.getState().selectedPads;
    const globalFadeDurationMs = useAppSettingsStore.getState().settings?.globalFadeDurationMs;

    for (const [padId, fade] of allSelectedPads) {
      const pad = pads.find((p) => p.id === padId);
      if (!pad) continue;
      const duration = resolveFadeDuration(pad, globalFadeDurationMs);
      fadePadWithLevels(pad, duration, fade.levels[0] / 100, fade.levels[1] / 100).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`Playback error: audio fade failed — ${message}`);
      });
    }
    resetMultiFade();
  }, [canExecute, resetMultiFade]);

  const cancel = useCallback(() => {
    cancelMultiFade();
  }, [cancelMultiFade]);

  const clearReopenPadId = useCallback(() => {
    clearMultiFadeReopenPadId();
  }, [clearMultiFadeReopenPadId]);

  useHotkeys("enter", execute, { enabled: active && canExecute }, [active, canExecute, execute]);
  useHotkeys("escape", cancel, { enabled: active }, [active, cancel]);

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
