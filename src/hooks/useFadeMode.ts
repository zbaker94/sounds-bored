import { useState, useCallback, useEffect, useMemo } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { usePlaybackStore } from "@/state/playbackStore";
import { useUiStore } from "@/state/uiStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import {
  executeFadeTap,
  executeCrossfadeSelection,
} from "@/lib/audio/padPlayer";
import type { Pad } from "@/lib/schemas";
import { isFadeablePad } from "@/lib/padUtils";

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
  hasPlayingPads: boolean;
  canExecute: boolean;
  statusLabel: string | null;
  getPadFadeVisual: (padId: string) => PadFadeVisual;
  enterFade: () => void;
  enterCrossfade: () => void;
  onPadTap: (padId: string) => void;
  execute: () => void;
  cancel: () => void;
}

const EMPTY_PAD_IDS = Object.freeze(new Set<string>()) as ReadonlySet<string>;

export function useFadeMode(pads: Pad[]): UseFadeModeReturn {
  const [mode, setMode] = useState<FadeMode>(null);
  const [selectedPadIds, setSelectedPadIds] = useState<Set<string>>(new Set());

  // Primitive subscription — always active, for entry guards and hotkey checks
  const hasPlayingPads = usePlaybackStore((s) => s.playingPadIds.size > 0);

  // Full-Set subscription — only active when mode is non-null
  // Returns stable empty set reference when mode === null to avoid re-renders on every pad start/stop
  const playingPadIds = usePlaybackStore(
    (s) => mode !== null ? s.playingPadIds : (EMPTY_PAD_IDS as Set<string>)
  );
  const editMode = useUiStore((s) => s.editMode);
  const overlayStack = useUiStore((s) => s.overlayStack);

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
    if (!hasPlayingPads) return;
    setMode("crossfade");
    setSelectedPadIds(new Set());
  }, [editMode, overlayStack.length, hasPlayingPads]);

  const onPadTap = useCallback(
    (padId: string) => {
      const pad = pads.find((p) => p.id === padId);
      if (!pad || !isFadeablePad(pad)) return;

      if (mode === "fade") {
        const globalFadeDurationMs = useAppSettingsStore.getState().settings?.globalFadeDurationMs;
        executeFadeTap(pad, globalFadeDurationMs);
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
    [mode, pads, selectedPadIds, cancel],
  );

  const canExecute = useMemo(() => {
    const arr = [...selectedPadIds];
    return (
      mode === "crossfade" &&
      arr.some((id) => playingPadIds.has(id)) &&
      arr.some((id) => !playingPadIds.has(id))
    );
  }, [mode, selectedPadIds, playingPadIds]);

  const execute = useCallback(() => {
    if (!canExecute) return;
    const selectedPads = pads.filter((p) => selectedPadIds.has(p.id));
    const globalFadeDurationMs = useAppSettingsStore.getState().settings?.globalFadeDurationMs;
    executeCrossfadeSelection(selectedPads, globalFadeDurationMs);
    cancel();
  }, [canExecute, pads, selectedPadIds, cancel]);

  const getPadFadeVisual = useCallback(
    (padId: string): PadFadeVisual => {
      if (mode === null) return null;
      const pad = pads.find((p) => p.id === padId);
      if (!pad || !isFadeablePad(pad)) return "invalid";
      if (mode === "fade") return playingPadIds.has(padId) ? "crossfade-out" : "crossfade-in";

      const isSelected = selectedPadIds.has(padId);
      const isPlaying = playingPadIds.has(padId);
      if (isSelected) return isPlaying ? "selected-out" : "selected-in";
      return isPlaying ? "crossfade-out" : "crossfade-in";
    },
    [mode, pads, selectedPadIds, playingPadIds],
  );

  const statusLabel = useMemo<string | null>(
    () =>
      mode === "fade"
        ? "Select a pad"
        : mode === "crossfade"
          ? canExecute
            ? "Ready — press X or Enter to execute"
            : "Select pads to crossfade"
          : null,
    [mode, canExecute],
  );

  useHotkeys("f", () => {
    if (mode === "fade") cancel();
    else enterFade();
  }, { enabled: !editMode, preventDefault: true });

  useHotkeys("x", () => {
    if (mode === "crossfade") {
      if (canExecute) execute();
      else cancel();
    } else if (hasPlayingPads) {
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
    hasPlayingPads,
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
