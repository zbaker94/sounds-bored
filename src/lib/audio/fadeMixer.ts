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
  setPadFadeDirection,
} from "./audioState";
import { resetPadGain } from "./gainManager";
import { usePlaybackStore } from "@/state/playbackStore";
import type { Pad } from "@/lib/schemas";

/**
 * Freeze a pad's gain at its current value — cancels any in-progress ramp
 * so the pad stays at whatever volume it was at when called.
 */
export function freezePadAtCurrentVolume(padId: string): void {
  const ctx = getAudioContext();
  const gain = getPadGain(padId);
  const currentValue = gain.gain.value;
  cancelPadFade(padId);
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(currentValue, ctx.currentTime);
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
 * Fade a pad's gain from its current value (or fromVolume) to endVol (default 0).
 * If endVol === 0, stops all voices and resets the pad's gain after the fade completes.
 */
export function fadePadOut(pad: Pad, durationMs: number, fromVolume?: number, toVolume?: number): void {
  // 1. Cancel any prior fade and clear fading-in tracking so fadePadIn's post-await
  //    guard detects the reversal and bails without overwriting this fade-out ramp.
  cancelPadFade(pad.id);
  removeFadingInPad(pad.id);
  setPadFadeDirection(pad.id, "out");

  const ctx = getAudioContext();
  const gain = getPadGain(pad.id);
  const currentGain = gain.gain.value;
  const startVol = fromVolume ?? currentGain;
  const endVol = toVolume ?? 0;

  // 2. Null onended callbacks on active pad voices so a chained voice ending
  //    naturally during the fade window does not start the next sound at the
  //    faded-down volume. Compare stopAllPads which also calls nullAllOnEnded.
  nullPadOnEnded(pad.id);

  // 3. Schedule Web Audio ramp
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(startVol, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(endVol, ctx.currentTime + durationMs / 1000);

  // 4. Mark this pad as fading out so a reverse fade-in can be detected
  addFadingOutPad(pad.id);
  usePlaybackStore.getState().addFadingOutPad(pad.id);

  // 5. Schedule cleanup. Inlines stopPad behavior via audioState functions directly
  //    to avoid a circular dependency on padPlayer.ts.
  const timeoutId = setTimeout(() => {
    deleteFadePadTimeout(pad.id);
    // Guard: if pad is no longer fading out (e.g. re-triggered while this timeout
    // was pending), skip cleanup so newly-started voices are not killed.
    if (!isPadFadingOut(pad.id)) return;
    removeFadingOutPad(pad.id);
    usePlaybackStore.getState().removeFadingOutPad(pad.id);
    if (endVol === 0) {
      // Inline stopPad: cancel fade, clear per-layer chain state, stop voices
      cancelPadFade(pad.id);
      for (const layer of pad.layers) {
        deleteLayerChain(layer.id);
        deleteLayerCycleIndex(layer.id);
        deleteLayerPlayOrder(layer.id);
      }
      stopPadVoices(pad.id);
      // Reset gain node to 1.0 so the next trigger starts at full volume
      resetPadGain(pad.id);
    }
  }, durationMs + 5);
  setFadePadTimeout(pad.id, timeoutId);
}

/**
 * Reverse an in-progress fade-out: cancel it and ramp gain back up from
 * current value. Does NOT restart audio — existing voices keep playing.
 */
export function fadePadInFromCurrent(pad: Pad, durationMs: number, toVolume?: number): void {
  // 1. Cancel the fade-out
  cancelPadFade(pad.id);
  usePlaybackStore.getState().removeFadingOutPad(pad.id);
  setPadFadeDirection(pad.id, "in");

  const ctx = getAudioContext();
  const gain = getPadGain(pad.id);
  const fromVolume = gain.gain.value;
  const endVol = toVolume ?? 1.0;

  // 2. Schedule Web Audio ramp back up
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(fromVolume, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(endVol, ctx.currentTime + durationMs / 1000);

  // 3. Schedule cleanup
  const timeoutId = setTimeout(() => {
    deleteFadePadTimeout(pad.id);
    cancelPadFade(pad.id);
  }, durationMs + 5);
  setFadePadTimeout(pad.id, timeoutId);
}
