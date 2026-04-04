import { useRef, useState } from "react";
import type React from "react";
import type { Pad } from "@/lib/schemas";
import { triggerPad, setPadVolume, resetPadGain, releasePadHoldLayers, stopPad } from "@/lib/audio/padPlayer";
import { usePlaybackStore } from "@/state/playbackStore";

// Gesture thresholds
const HOLD_MS = 150;        // time before a press becomes a "hold"
const DRAG_PX = 4;          // vertical pixels before drag mode activates
const DRAG_RANGE_PX = 200;  // pixels of travel for full 0→1 volume range
export const DRAG_RAMP_MS = 150; // time-based linear sensitivity ramp (ms)

type Phase = "idle" | "down" | "hold" | "drag";

interface GestureState {
  startY: number;
  lastY: number;
  startTime: number;
  dragStartTime: number;
  phase: Phase;
  wasPlayingAtStart: boolean;
  startVolume: number;
  currentVolume: number;
}

export function usePadGesture(pad: Pad) {
  const hasHoldLayer = pad.layers.some((l) => l.playbackMode === "hold");

  const state = useRef<GestureState>({
    startY: 0,
    lastY: 0,
    startTime: 0,
    dragStartTime: 0,
    phase: "idle",
    wasPlayingAtStart: false,
    startVolume: 1.0,
    currentVolume: 1.0,
  });
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fillVolume, setFillVolume] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  function clearHoldTimer() {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    clearHoldTimer();

    const s = state.current;
    s.startY = e.clientY;
    s.lastY = e.clientY;
    s.startTime = Date.now();
    s.phase = "down";
    s.wasPlayingAtStart = usePlaybackStore.getState().isPadActive(pad.id);

    // Hold-mode pads trigger immediately on press (not on release)
    if (hasHoldLayer) {
      const vol = usePlaybackStore.getState().padVolumes[pad.id] ?? 1.0;
      triggerPad(pad, vol).catch(console.error);
    }

    holdTimer.current = setTimeout(() => {
      const s = state.current;
      if (s.phase !== "down") return;
      s.phase = "hold";
      s.startY = s.lastY;

      const vol = hasHoldLayer
        ? (usePlaybackStore.getState().padVolumes[pad.id] ?? 1.0)
        : s.wasPlayingAtStart
          ? (usePlaybackStore.getState().padVolumes[pad.id] ?? 1.0)
          : 0;
      s.startVolume = vol;
      s.currentVolume = vol;
      setFillVolume(vol);
    }, HOLD_MS);
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const s = state.current;
    s.lastY = e.clientY;
    if (s.phase === "idle" || s.phase === "down") return;

    const deltaY = s.startY - e.clientY; // positive = dragged up
    let justTriggered = false;

    if (s.phase === "hold" && Math.abs(deltaY) > DRAG_PX) {
      s.phase = "drag";
      s.dragStartTime = Date.now();
      setIsDragging(true);

      if (deltaY > 0 && !hasHoldLayer && !s.wasPlayingAtStart) {
        triggerPad(pad, 0).catch(console.error);
        justTriggered = true;
      }
    }

    if (s.phase === "drag") {
      const rampFactor = Math.min(1, (Date.now() - s.dragStartTime) / DRAG_RAMP_MS);
      const newVolume = Math.max(0, Math.min(1, s.startVolume + rampFactor * deltaY / DRAG_RANGE_PX));
      s.currentVolume = newVolume;

      if (!justTriggered && newVolume > 0.01 && !hasHoldLayer && !usePlaybackStore.getState().isPadActive(pad.id)) {
        triggerPad(pad, 0).catch(console.error);
      }

      setPadVolume(pad.id, newVolume);
      setFillVolume(newVolume);
    }
  }

  function resetGesture() {
    const s = state.current;
    if (hasHoldLayer) {
      releasePadHoldLayers(pad);
    }
    setFillVolume(null);
    setIsDragging(false);
    s.dragStartTime = 0;
    s.phase = "idle";
  }

  function onPointerUp(_e: React.PointerEvent<HTMLButtonElement>) {
    clearHoldTimer();
    const s = state.current;

    if (s.phase === "down") {
      // Normal tap — only trigger if not a hold-mode pad (those triggered on down)
      if (!hasHoldLayer) {
        const vol = usePlaybackStore.getState().padVolumes[pad.id] ?? 1.0;
        triggerPad(pad, vol).catch(console.error);
      }
    } else if (s.phase === "hold") {
      if (!hasHoldLayer) {
        const vol = usePlaybackStore.getState().padVolumes[pad.id] ?? 1.0;
        triggerPad(pad, vol).catch(console.error);
      }
    } else if (s.phase === "drag") {
      if (s.currentVolume < 0.01 && !hasHoldLayer) {
        stopPad(pad);
        resetPadGain(pad.id);
      }
    }

    resetGesture();
  }

  function onPointerCancel(_e: React.PointerEvent<HTMLButtonElement>) {
    clearHoldTimer();
    const s = state.current;

    if (s.phase === "drag" && s.currentVolume < 0.01 && !hasHoldLayer) {
      stopPad(pad);
      resetPadGain(pad.id);
    }

    resetGesture();
  }

  function onContextMenu(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
  }

  return {
    gestureHandlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onContextMenu },
    fillVolume,
    isDragging,
  };
}
