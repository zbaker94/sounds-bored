// src/lib/audio/gainManager.ts
import { getAudioContext } from "./audioContext";
import { cancelPadFade } from "./audioState";
import { getPadGain, getLayerGain, markGainRamp } from "./gainRegistry";
import { usePlaybackStore } from "@/state/playbackStore";

/** Short ramp duration (seconds) used to avoid zipper/click artifacts on gain changes. */
const CLICK_FREE_RAMP_S = 0.016;

export function clampGain01(value: number, fallback = 0): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

/**
 * Schedule a click-free linear ramp on an `AudioParam` (typically a gain node's
 * `.gain`). Cancels any pending automation, anchors the curve at `from` (defaults
 * to the param's current live value), and ramps to `target` over `rampS` seconds.
 */
export function rampGainTo(
  param: AudioParam,
  target: number,
  rampS = CLICK_FREE_RAMP_S,
  from: number = param.value
): void {
  const ctx = getAudioContext();
  param.cancelScheduledValues(ctx.currentTime);
  param.setValueAtTime(from, ctx.currentTime);
  param.linearRampToValueAtTime(target, ctx.currentTime + rampS);
  markGainRamp(rampS);
}

/**
 * Set the live volume for a pad's gain node with a short ramp to avoid clicks.
 * Pass a value in 0–1 range.
 */
export function setPadVolume(padId: string, volume: number): void {
  const gain = getPadGain(padId);
  rampGainTo(gain.gain, clampGain01(volume));
  // Tick reads the gain node value automatically — no store call needed.
}

/**
 * Cancel any pending fade and reset a pad's gain node to 1.0.
 * Called after a fade-out completes or when the pad is manually stopped.
 */
export function resetPadGain(padId: string): void {
  // Cannot use clearPadFadeTracking here — fadeMixer imports gainManager (circular dep).
  cancelPadFade(padId);
  usePlaybackStore.getState().removeFadingPad(padId);
  usePlaybackStore.getState().removeFadingOutPad(padId);
  const gain = getPadGain(padId);
  const ctx = getAudioContext();
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(1.0, ctx.currentTime);
  // Tick reads the gain node value automatically — no store call needed.
}

/**
 * Update a live layer gain node with a short ramp to avoid clicks
 * (e.g. when pad config is saved mid-playback).
 * No-op if the layer isn't active.
 * @param volume - [0,1] normalized gain.
 */
export function syncLayerVolume(layerId: string, volume: number): void {
  const gain = getLayerGain(layerId);
  if (!gain) return;
  rampGainTo(gain.gain, clampGain01(volume));
}

/**
 * Set the live volume for a layer's gain node.
 * Pass volume in 0–1 range. No-op if the layer isn't active.
 */
export function setLayerVolume(layerId: string, volume: number): void {
  const gain = getLayerGain(layerId);
  if (!gain) return;
  rampGainTo(gain.gain, clampGain01(volume));
}

// Persisting layer volume on drag-end is a UI-layer concern. Callers use
//   useProjectStore.getState().updateLayerVolume(layerId, volume)
// directly via onValueCommit.
