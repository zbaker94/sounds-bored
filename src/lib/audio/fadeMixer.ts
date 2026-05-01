// src/lib/audio/fadeMixer.ts
import { getAudioContext } from "./audioContext";
import {
  cancelPadFade,
  addFadingOutPad,
  addFadingInPad,
  removeFadingInPad,
  isPadFadingIn,
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
 * Cancel all fade tracking for a pad on both audioState (local) and
 * playbackStore (reactive UI signals). Idempotent — safe to call when no fade is active.
 *
 * Clears: local fadePadTimeouts, fadingOutPadIds, padFadeFromVolumes (via cancelPadFade),
 * and playbackStore fadingPadIds + fadingOutPadIds.
 * Use this at every point where a pad's fade lifecycle ends or is pre-empted.
 */
export function clearPadFadeTracking(padId: string): void {
  cancelPadFade(padId);
  usePlaybackStore.getState().removeFadingPad(padId);
  usePlaybackStore.getState().removeFadingOutPad(padId);
}

/**
 * Mark a pad as fading out on both audioState (local) and playbackStore (reactive UI).
 * Symmetric counterpart to the removal path in clearPadFadeTracking.
 */
function markPadFadingOut(padId: string): void {
  addFadingOutPad(padId);
  usePlaybackStore.getState().addFadingOutPad(padId);
}

/**
 * Freeze a pad's gain at its current value — cancels any in-progress ramp
 * so the pad stays at whatever volume it was at when called.
 *
 * Also clears fade tracking on both audioState and playbackStore — equivalent to
 * clearPadFadeTracking for store purposes.
 */
export function freezePadAtCurrentVolume(padId: string): void {
  const ctx = getAudioContext();
  const gain = getPadGain(padId);
  clearPadFadeTracking(padId);
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

export function stopPadInternal(pad: Pad): void {
  for (const layer of pad.layers) {
    deleteLayerChain(layer.id);
    deleteLayerCycleIndex(layer.id);
    deleteLayerPlayOrder(layer.id);
  }
  stopPadVoices(pad.id);
  usePlaybackStore.getState().removePlayingPad(pad.id);
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
  // Clear any in-progress fade state on both audioState and playbackStore
  // before scheduling a new ramp.
  clearPadFadeTracking(pad.id);
  removeFadingInPad(pad.id);
  usePlaybackStore.getState().addFadingPad(pad.id);

  const gain = getPadGain(pad.id);
  const fadingDown = toVolume < fromVolume;

  if (fadingDown) {
    // Null onended callbacks so chained voices don't restart at the faded-down level.
    nullPadOnEnded(pad.id);
    markPadFadingOut(pad.id);
  }

  rampGainTo(gain.gain, toVolume, durationMs / 1000, fromVolume);
  setPadFadeFromVolume(pad.id, fromVolume);

  const timeoutId = setTimeout(() => {
    deleteFadePadTimeout(pad.id);
    // Guard: if pad is no longer fading out (e.g. re-triggered), skip cleanup.
    if (fadingDown && !isPadFadingOut(pad.id)) return;
    // Clear fade state on both audioState and playbackStore now that the
    // ramp has completed.
    clearPadFadeTracking(pad.id);
    if (fadingDown && toVolume === 0) {
      stopPadInternal(pad);
      resetPadGain(pad.id);
    }
  }, durationMs + 5);
  setFadePadTimeout(pad.id, timeoutId);
}

export async function fadePadIn(
  pad: Pad,
  toVolume: number,
  durationMs: number,
  startPad: (pad: Pad) => Promise<void>,
): Promise<void> {
  clearPadFadeTracking(pad.id);
  addFadingInPad(pad.id);

  await startPad(pad);

  // If pre-empted during the await, bail without overwriting the interleaved ramp.
  if (!isPadFadingIn(pad.id)) return;
  removeFadingInPad(pad.id);
  usePlaybackStore.getState().addFadingPad(pad.id);

  const gain = getPadGain(pad.id);
  rampGainTo(gain.gain, toVolume, durationMs / 1000, 0);
  setPadFadeFromVolume(pad.id, 0);

  const timeoutId = setTimeout(() => {
    deleteFadePadTimeout(pad.id);
    clearPadFadeTracking(pad.id);
    if (toVolume === 0) stopPadInternal(pad);
  }, durationMs + 5);
  setFadePadTimeout(pad.id, timeoutId);
}
