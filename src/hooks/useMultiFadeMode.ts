import { useState, useCallback, useEffect } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useUiStore } from "@/state/uiStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import {
  fadePadWithLevels,
  resolveFadeDuration,
} from "@/lib/audio/padPlayer";
import { isPadActive } from "@/lib/audio/audioState";
import type { Pad } from "@/lib/schemas";
import { toast } from "sonner";

export interface SelectedPadFade {
  padId: string;
  levels: [number, number]; // [from, to] — initialized per playing state
}

export interface UseMultiFadeModeReturn {
  active: boolean;
  originPadId: string | null;
  selectedPads: Map<string, SelectedPadFade>;
  enter: (originPadId: string, initialVolume?: number) => void;
  togglePad: (pad: Pad, currentVolume?: number) => void;
  setFadeLevels: (padId: string, levels: [number, number]) => void;
  canExecute: boolean;
  execute: () => void;
  cancel: () => void;
  reopenPadId: string | null;
  clearReopenPadId: () => void;
}

export function useMultiFadeMode(pads: Pad[]): UseMultiFadeModeReturn {
  const [active, setActive] = useState(false);
  const [originPadId, setOriginPadId] = useState<string | null>(null);
  const [selectedPads, setSelectedPads] = useState<Map<string, SelectedPadFade>>(new Map());
  const [reopenPadId, setReopenPadId] = useState<string | null>(null);

  const editMode = useUiStore((s) => s.editMode);
  const overlayStack = useUiStore((s) => s.overlayStack);

  const cancel = useCallback(() => {
    if (!active) return;
    setReopenPadId(originPadId);
    setActive(false);
    setOriginPadId(null);
    setSelectedPads(new Map());
  }, [active, originPadId]);

  const clearReopenPadId = useCallback(() => {
    setReopenPadId(null);
  }, []);

  // Cancel when edit mode activates
  useEffect(() => {
    if (editMode && active) {
      setActive(false);
      setOriginPadId(null);
      setSelectedPads(new Map());
    }
  }, [editMode, active]);

  // Cancel when any overlay opens
  useEffect(() => {
    if (overlayStack.length > 0 && active) {
      setActive(false);
      setOriginPadId(null);
      setSelectedPads(new Map());
    }
  }, [overlayStack.length, active]);

  const enter = useCallback((padId: string, initialVolume?: number) => {
    setActive(true);
    setOriginPadId(padId);

    // Pre-select the origin pad
    const pad = pads.find((p) => p.id === padId);
    if (pad) {
      const playing = isPadActive(padId);
      const vol = initialVolume ?? 1.0;
      const levels: [number, number] = playing
        ? [0, Math.round(vol * 100)]
        : [0, 100];
      setSelectedPads(new Map([[padId, { padId, levels }]]));
    } else {
      setSelectedPads(new Map());
    }
  }, [pads]);

  const togglePad = useCallback((pad: Pad, currentVolume?: number) => {
    setSelectedPads((prev) => {
      const next = new Map(prev);
      if (next.has(pad.id)) {
        next.delete(pad.id);
      } else {
        const playing = isPadActive(pad.id);
        const vol = currentVolume ?? 1.0;
        const levels: [number, number] = playing
          ? [0, Math.round(vol * 100)]
          : [0, 100];
        next.set(pad.id, { padId: pad.id, levels });
      }
      return next;
    });
  }, []);

  const setFadeLevels = useCallback((padId: string, levels: [number, number]) => {
    setSelectedPads((prev) => {
      const entry = prev.get(padId);
      if (!entry) return prev;
      const next = new Map(prev);
      next.set(padId, { ...entry, levels });
      return next;
    });
  }, []);

  const canExecute = active && selectedPads.size >= 1;

  const execute = useCallback(() => {
    if (!canExecute) return;
    const globalFadeDurationMs = useAppSettingsStore.getState().settings?.globalFadeDurationMs;

    for (const [padId, fade] of selectedPads) {
      const pad = pads.find((p) => p.id === padId);
      if (!pad) continue;
      const duration = resolveFadeDuration(pad, globalFadeDurationMs);

      fadePadWithLevels(pad, duration, fade.levels[0] / 100, fade.levels[1] / 100).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`Playback error: audio fade failed — ${message}`);
      });
    }

    setActive(false);
    setOriginPadId(null);
    setSelectedPads(new Map());
  }, [canExecute, selectedPads, pads]);

  useHotkeys("enter", () => {
    if (active && canExecute) execute();
  }, { enabled: active }, [active, canExecute, execute]);

  useHotkeys("escape", () => {
    if (active) cancel();
  }, { enabled: active }, [active, cancel]);

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
