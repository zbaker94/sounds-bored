import { useState, useCallback, useEffect } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { usePlaybackStore } from "@/state/playbackStore";
import { useUiStore } from "@/state/uiStore";
import {
  fadePadOut,
  fadePadIn,
  fadePadInFromCurrent,
  isPadFadingOut,
  crossfadePads,
  resolveFadeDuration,
} from "@/lib/audio/padPlayer";
import type { Pad } from "@/lib/schemas";

export type FadeMode = "fade" | "crossfade" | null;

export type PadFadeVisual =
  | "crossfade-out"
  | "crossfade-in"
  | "selected-out"
  | "selected-in"
  | "invalid"
  | null;

export interface UseFadeModeReturn {
  mode: FadeMode;
  canExecute: boolean;
  statusLabel: string | null;
  getPadFadeVisual: (padId: string) => PadFadeVisual;
  enterFade: () => void;
  enterCrossfade: () => void;
  onPadTap: (padId: string) => void;
  execute: () => void;
  cancel: () => void;
}

export function useFadeMode(pads: Pad[]): UseFadeModeReturn {
  const [mode, setMode] = useState<FadeMode>(null);
  const [selectedPadIds, setSelectedPadIds] = useState<Set<string>>(new Set());

  const playingPadIds = usePlaybackStore((s) => s.playingPadIds);
  const editMode = useUiStore((s) => s.editMode);
  const overlayStack = useUiStore((s) => s.overlayStack);

  const isValidPad = useCallback(
    (padId: string) => {
      const pad = pads.find((p) => p.id === padId);
      return (
        pad !== undefined &&
        pad.layers.length > 0 &&
        !pad.layers.some((l) => l.playbackMode === "hold")
      );
    },
    [pads],
  );

  const cancel = useCallback(() => {
    setMode(null);
    setSelectedPadIds(new Set());
  }, []);

  // Cancel when edit mode activates
  useEffect(() => {
    if (editMode && mode !== null) cancel();
  }, [editMode, mode, cancel]);

  // Cancel when any overlay opens
  useEffect(() => {
    if (overlayStack.length > 0 && mode !== null) cancel();
  }, [overlayStack.length, mode, cancel]);

  const enterFade = useCallback(() => {
    if (editMode || overlayStack.length > 0) return;
    setMode("fade");
    setSelectedPadIds(new Set());
  }, [editMode, overlayStack.length]);

  const enterCrossfade = useCallback(() => {
    if (editMode || overlayStack.length > 0) return;
    if (playingPadIds.size === 0) return;
    setMode("crossfade");
    setSelectedPadIds(new Set());
  }, [editMode, overlayStack.length, playingPadIds]);

  const onPadTap = useCallback(
    (padId: string) => {
      if (!isValidPad(padId)) return;

      if (mode === "fade") {
        const pad = pads.find((p) => p.id === padId)!;
        const duration = resolveFadeDuration(pad);
        if (playingPadIds.has(padId)) {
          if (isPadFadingOut(padId)) {
            fadePadInFromCurrent(pad, duration);
          } else {
            fadePadOut(pad, duration);
          }
        } else {
          fadePadIn(pad, duration).catch(console.error);
        }
        cancel();
        return;
      }

      if (mode === "crossfade") {
        const next = new Set(selectedPadIds);
        if (next.has(padId)) {
          next.delete(padId);
          if (next.size === 0) {
            cancel();
            return;
          }
        } else {
          next.add(padId);
        }
        setSelectedPadIds(next);
      }
    },
    [mode, pads, playingPadIds, selectedPadIds, isValidPad, cancel],
  );

  const selectedArray = [...selectedPadIds];
  const canExecute =
    mode === "crossfade" &&
    selectedArray.some((id) => playingPadIds.has(id)) &&
    selectedArray.some((id) => !playingPadIds.has(id));

  const execute = useCallback(() => {
    if (!canExecute) return;
    const fadingOut = pads.filter(
      (p) => selectedPadIds.has(p.id) && playingPadIds.has(p.id),
    );
    const fadingIn = pads.filter(
      (p) => selectedPadIds.has(p.id) && !playingPadIds.has(p.id),
    );
    crossfadePads(fadingOut, fadingIn);
    cancel();
  }, [canExecute, pads, selectedPadIds, playingPadIds, cancel]);

  const getPadFadeVisual = useCallback(
    (padId: string): PadFadeVisual => {
      if (mode === null) return null;
      if (!isValidPad(padId)) return "invalid";
      if (mode === "fade") return playingPadIds.has(padId) ? "crossfade-out" : "crossfade-in";

      const isSelected = selectedPadIds.has(padId);
      const isPlaying = playingPadIds.has(padId);
      if (isSelected) return isPlaying ? "selected-out" : "selected-in";
      return isPlaying ? "crossfade-out" : "crossfade-in";
    },
    [mode, isValidPad, selectedPadIds, playingPadIds],
  );

  const statusLabel: string | null =
    mode === "fade"
      ? "Select a pad"
      : mode === "crossfade"
        ? canExecute
          ? "Ready — press X or Enter to execute"
          : "Select pads to crossfade"
        : null;

  useHotkeys("f", () => {
    if (mode === "fade") cancel();
    else enterFade();
  }, { enabled: !editMode, preventDefault: true });

  useHotkeys("x", () => {
    if (mode === "crossfade") {
      if (canExecute) execute();
      else cancel();
    } else if (playingPadIds.size > 0) {
      enterCrossfade();
    }
  }, { enabled: !editMode, preventDefault: true });

  useHotkeys("enter", () => {
    if (mode === "crossfade" && canExecute) execute();
  }, { enabled: !editMode });

  useHotkeys("escape", () => {
    if (mode !== null) cancel();
  });

  return {
    mode,
    canExecute,
    statusLabel,
    getPadFadeVisual,
    enterFade,
    enterCrossfade,
    onPadTap,
    execute,
    cancel,
  };
}
