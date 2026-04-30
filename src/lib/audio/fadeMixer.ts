// src/lib/audio/fadeMixer.ts
import { getAudioContext } from "./audioContext";
import {
  cancelPadFade,
  addFadingOutPad,
  removeFadingInPad,
  isPadFadingOut,
  setFadePadTimeout,
  deleteFadePadTimeout,
  getPadGain,
  deleteLayerChain,
  deleteLayerCycleIndex,
  deleteLayerPlayOrder,
  nullPadOnEnded,
  stopPadVoices,
  setPadFadeFromVolume,
} from "./audioState";
import { rampGainTo, resetPadGain } from "./gainManager";
import { usePlaybackStore } from "@/state/playbackStore";
import type { Pad } from "@/lib/schemas";

/**
 * Freeze a pad's gain at its current value — cancels any in-progress ramp
 * so the pad stays at whatever volume it was at when called.
 */
export function freezePadAtCurrentVolume(padId: string): void {
  const ctx = getAudioContext();
  const gain = getPadGain(padId);
  cancelPadFade(padId);
  // Cancel scheduled values BEFORE reading so the held value is the ramp's
  // current interpolated position, not the last setValueAtTime anchor.
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
  // Tick reads the frozen gain value automatically — no store call needed.
}

/**
 * Resolve the effective fade duration for a pad.
 * Pad-level override wins over the global setting; 2000ms if neither is set.
 */
export function resolveFadeDuration(pad: Pad, globalFadeDurationMs?: number): number {
  return pad.fadeDurationMs ?? globalFadeDurationMs ?? 2000;
}

/**
 * Fade a pad's gain from fromVolume to toVolume over durationMs.
 *
 * fromVolume must be provided explicitly by the caller. When reversing a
 * mid-ramp fade, cancel scheduled values before reading gain.gain.value so
 * the Web Audio spec guarantees the held value is the current ramp position,
 * not the last setValueAtTime anchor.
 *
 *  - Fading down (toVolume < fromVolume): nulls onended callbacks, tracks as
 *    fading-out, stops voices + resets gain after completion when toVolume === 0.
 *  - Fading up (toVolume >= fromVolume): reverses any in-progress fade-out.
 */
export function fadePad(pad: Pad, fromVolume: number, toVolume: number, durationMs: number): void {
  usePlaybackStore.getState().removeReversingPad(pad.id);
  // cancelPadFade atomically clears fadingOutPadIds on both audioState and
  // playbackStore sides, so no explicit removeFadingOutPad call is needed here.
  cancelPadFade(pad.id);
  removeFadingInPad(pad.id);
  usePlaybackStore.getState().addFadingPad(pad.id);

  const gain = getPadGain(pad.id);
  const fadingDown = toVolume < fromVolume;

  if (fadingDown) {
    // Null onended callbacks so chained voices don't restart at the faded-down level.
    nullPadOnEnded(pad.id);
    addFadingOutPad(pad.id);
  }

  rampGainTo(gain.gain, toVolume, durationMs / 1000, fromVolume);
  setPadFadeFromVolume(pad.id, fromVolume);

  const timeoutId = setTimeout(() => {
    deleteFadePadTimeout(pad.id);
    // Guard: if pad is no longer fading out (e.g. re-triggered), skip cleanup.
    if (fadingDown && !isPadFadingOut(pad.id)) return;
    // cancelPadFade clears fadingOutPadIds + fadingPadIds on both sides atomically.
    cancelPadFade(pad.id);
    if (fadingDown && toVolume === 0) {
      for (const layer of pad.layers) {
        deleteLayerChain(layer.id);
        deleteLayerCycleIndex(layer.id);
        deleteLayerPlayOrder(layer.id);
      }
      stopPadVoices(pad.id);
      resetPadGain(pad.id);
    }
  }, durationMs + 5);
  setFadePadTimeout(pad.id, timeoutId);
}
