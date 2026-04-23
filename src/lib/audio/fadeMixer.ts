// src/lib/audio/fadeMixer.ts
import { getAudioContext } from "./audioContext";
import {
  cancelPadFade,
  addFadingOutPad,
  removeFadingOutPad,
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
import { resetPadGain } from "./gainManager";
import { usePlaybackStore } from "@/state/playbackStore";
import type { Pad } from "@/lib/schemas";

/**
 * Mark a pad as fading-out in BOTH the audioState set and the playbackStore set.
 * These two sets are always kept in lock-step from fadePad's fade-down path, so
 * the paired calls are wrapped here to prevent one side from drifting out of sync.
 */
function markFadingOut(padId: string): void {
  addFadingOutPad(padId);
  usePlaybackStore.getState().addFadingOutPad(padId);
}

/**
 * Remove a pad from fading-out tracking in BOTH the audioState set and the
 * playbackStore set. Paired counterpart to markFadingOut.
 */
function unmarkFadingOut(padId: string): void {
  removeFadingOutPad(padId);
  usePlaybackStore.getState().removeFadingOutPad(padId);
}

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
  cancelPadFade(pad.id);
  removeFadingInPad(pad.id);
  usePlaybackStore.getState().addFadingPad(pad.id);

  const ctx = getAudioContext();
  const gain = getPadGain(pad.id);
  const fadingDown = toVolume < fromVolume;

  if (fadingDown) {
    // Null onended callbacks so chained voices don't restart at the faded-down level.
    nullPadOnEnded(pad.id);
    markFadingOut(pad.id);
  } else {
    // cancelPadFade (called above) already removed pad.id from the audioState
    // fadingOutPadIds set, so only the playbackStore mirror needs to be cleared
    // here. Using unmarkFadingOut would be a redundant (but harmless) Set.delete.
    usePlaybackStore.getState().removeFadingOutPad(pad.id);
  }

  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(fromVolume, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(toVolume, ctx.currentTime + durationMs / 1000);
  setPadFadeFromVolume(pad.id, fromVolume);

  const timeoutId = setTimeout(() => {
    deleteFadePadTimeout(pad.id);

    if (fadingDown) {
      // Guard: if pad is no longer fading out (e.g. re-triggered), skip cleanup.
      if (!isPadFadingOut(pad.id)) return;
      unmarkFadingOut(pad.id);
      if (toVolume === 0) {
        cancelPadFade(pad.id);
        for (const layer of pad.layers) {
          deleteLayerChain(layer.id);
          deleteLayerCycleIndex(layer.id);
          deleteLayerPlayOrder(layer.id);
        }
        stopPadVoices(pad.id);
        resetPadGain(pad.id);
      } else {
        usePlaybackStore.getState().removeFadingPad(pad.id);
      }
    } else {
      cancelPadFade(pad.id);
    }
  }, durationMs + 5);
  setFadePadTimeout(pad.id, timeoutId);
}
