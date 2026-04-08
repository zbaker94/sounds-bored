import { useRef, useMemo } from "react";
import type React from "react";
import type { Pad } from "@/lib/schemas";
import { triggerPad, setPadVolume, resetPadGain, releasePadHoldLayers, stopPad, isPadFading, freezePadAtCurrentVolume } from "@/lib/audio/padPlayer";
import { isLayerActive } from "@/lib/audio/audioState";
import { usePlaybackStore } from "@/state/playbackStore";

// Gesture thresholds
const HOLD_MS = 150;        // time before a press becomes a "hold"
const DRAG_PX = 4;          // vertical pixels before drag mode activates
const DRAG_RANGE_PX = 200;  // pixels of travel for full 0→1 volume range
const DRAG_RAMP_MS = 150; // time-based linear sensitivity ramp (ms), measured from pointerDown.
                          // Since HOLD_MS === DRAG_RAMP_MS, the ramp is always fully elapsed
                          // by the time drag can begin — giving immediate full sensitivity on drag
                          // while still protecting against accidental micro-drags on very quick presses.

type Phase = "idle" | "down" | "hold" | "drag";

interface GestureState {
  startY: number;
  lastY: number;
  startTime: number;
  phase: Phase;
  wasPlayingAtStart: boolean;
  startVolume: number;
  currentVolume: number;
  cancelledFadeAtStart: boolean;
}

export function usePadGesture(pad: Pad, now = Date.now) {
  const hasHoldLayer = useMemo(
    () => pad.layers.some((l) => l.playbackMode === "hold"),
    [pad.layers]
  );

  const state = useRef<GestureState>({
    startY: 0,
    lastY: 0,
    startTime: 0,
    phase: "idle",
    wasPlayingAtStart: false,
    startVolume: 1.0,
    currentVolume: 1.0,
    cancelledFadeAtStart: false,
  });
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // All handlers and their helpers are co-located in a single useMemo so that:
  // 1. Helper functions share the same closure scope as the handlers that call them,
  //    eliminating stale closure risk from mismatched dependency arrays.
  // 2. The returned gestureHandlers object is stable across renders when pad,
  //    hasHoldLayer, and now are unchanged.
  // `now` is a stable function reference in practice (Date.now or an injected test clock),
  // but is listed as a dep for correctness since it is a parameter that could change.
  const gestureHandlers = useMemo(() => {
    function clearHoldTimer() {
      if (holdTimer.current) {
        clearTimeout(holdTimer.current);
        holdTimer.current = null;
      }
    }

    /**
     * Returns true if at least one hold-mode layer on this pad is currently playing.
     * Used instead of the pad-level isPadActive when the pad has hold layers — a
     * fading one-shot voice must not make the hold layer inherit a stale padVolume.
     */
    function checkHoldLayerActive(): boolean {
      return pad.layers.some(
        (l) => l.playbackMode === "hold" && isLayerActive(l.id)
      );
    }

    /**
     * Resolve the volume to use when triggering a tap or hold-release.
     * If the pad is active (already playing), honour its current padVolumes entry.
     * If it's not active, always start at 1.0 — padVolumes may be 0 from the hold
     * phase display update and must not corrupt the trigger.
     */
    function triggerVolume(): number {
      const store = usePlaybackStore.getState();
      if (hasHoldLayer) {
        return checkHoldLayerActive() ? (store.padVolumes[pad.id] ?? 1.0) : 1.0;
      }
      return store.playingPadIds.has(pad.id) ? (store.padVolumes[pad.id] ?? 1.0) : 1.0;
    }

    function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
      if (e.button !== 0) return;
      const fadeCancelled = isPadFading(pad.id);
      if (fadeCancelled) freezePadAtCurrentVolume(pad.id);

      e.currentTarget.setPointerCapture(e.pointerId);
      clearHoldTimer();

      const s = state.current;
      s.startY = e.clientY;
      s.lastY = e.clientY;
      s.startTime = now();
      s.phase = "down";
      s.cancelledFadeAtStart = fadeCancelled;
      const store = usePlaybackStore.getState();
      s.wasPlayingAtStart = hasHoldLayer
        ? checkHoldLayerActive()
        : store.playingPadIds.has(pad.id);

      // Hold-mode pads trigger immediately on press — skip if we just cancelled a fade
      if (hasHoldLayer && !fadeCancelled) {
        triggerPad(pad, triggerVolume()).catch(console.error);
      }

      holdTimer.current = setTimeout(() => {
        const s = state.current;
        if (s.phase !== "down") return;
        s.phase = "hold";
        s.startY = s.lastY;

        // Use wasPlayingAtStart (which now correctly tracks hold-layer activity) to
        // determine whether to resume from the current padVolume or start fresh.
        // For hold pads: resume at current volume if re-triggering while active,
        //   otherwise start at 1.0 (triggered at pointer-down, padVolumes may be stale).
        // For one-shot pads: resume at current volume if already playing, else start at 0.
        const timerStore = usePlaybackStore.getState();
        const vol = s.wasPlayingAtStart
          ? (timerStore.padVolumes[pad.id] ?? 1.0)
          : hasHoldLayer ? 1.0 : 0;
        s.startVolume = vol;
        s.currentVolume = vol;
        // Write to padVolumes so the display bar shows the correct starting height.
        // Triggers never read this for non-playing pads — triggerVolume() guards that.
        timerStore.updatePadVolume(pad.id, vol);
        timerStore.startVolumeTransition(pad.id);
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
        usePlaybackStore.getState().startVolumeTransition(pad.id);

        if (deltaY > 0 && !hasHoldLayer && !s.wasPlayingAtStart) {
          triggerPad(pad, 0).catch(console.error);
          justTriggered = true;
        }
      }

      if (s.phase === "drag") {
        const rampFactor = Math.min(1, (now() - s.startTime) / DRAG_RAMP_MS);
        const newVolume = Math.max(0, Math.min(1, s.startVolume + rampFactor * deltaY / DRAG_RANGE_PX));
        s.currentVolume = newVolume;

        if (!justTriggered && newVolume > 0.01 && !hasHoldLayer && !usePlaybackStore.getState().playingPadIds.has(pad.id)) {
          triggerPad(pad, 0).catch(console.error);
        }

        setPadVolume(pad.id, newVolume);
      }
    }

    function resetGesture() {
      const s = state.current;
      const wasActive = s.phase !== "idle";
      if (hasHoldLayer) {
        releasePadHoldLayers(pad);
        resetPadGain(pad.id); // → cancelPadFade → clearVolumeTransition
      }
      // Only clear the transition if this gesture hook actually started one.
      // Guarding on wasActive prevents a stale pointerup (e.g. from a fade-mode tap that
      // switched handlers mid-gesture) from wiping out a fade-triggered transition.
      if (wasActive) {
        usePlaybackStore.getState().clearVolumeTransition(pad.id);
      }
      s.phase = "idle";
      s.cancelledFadeAtStart = false;
    }

    function onPointerUp(_e: React.PointerEvent<HTMLButtonElement>) {
      clearHoldTimer();
      const s = state.current;

      if (s.phase === "down") {
        // Normal tap — only trigger if not a hold-mode pad and fade wasn't just cancelled
        if (!hasHoldLayer && !s.cancelledFadeAtStart) {
          triggerPad(pad, triggerVolume()).catch(console.error);
        }
      } else if (s.phase === "hold") {
        if (!hasHoldLayer && !s.cancelledFadeAtStart) {
          triggerPad(pad, triggerVolume()).catch(console.error);
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

    return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onContextMenu };
  }, [pad, hasHoldLayer, now]);

  return { gestureHandlers };
}
