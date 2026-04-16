// src/lib/audio/gainManager.ts
import { getAudioContext } from "./audioContext";
import { getPadGain, getLayerGain, cancelPadFade } from "./audioState";
import { usePlaybackStore } from "@/state/playbackStore";

/**
 * Set the live volume for a pad's gain node with a short ramp to avoid clicks.
 * Pass a value in 0–1 range.
 */
export function setPadVolume(padId: string, volume: number): void {
  const ctx = getAudioContext();
  const gain = getPadGain(padId);
  const clamped = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0;
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(clamped, ctx.currentTime + 0.016);
  // Tick reads the gain node value automatically — no store call needed.
}

/**
 * Cancel any pending fade and reset a pad's gain node to 1.0.
 * Called after a fade-out completes or when the pad is manually stopped.
 */
export function resetPadGain(padId: string): void {
  cancelPadFade(padId);
  const gain = getPadGain(padId);
  const ctx = getAudioContext();
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(1.0, ctx.currentTime);
  // Tick reads the gain node value automatically — no store call needed.
}

/**
 * Update a live layer gain node immediately (e.g. when pad config is saved mid-playback).
 * No-op if the layer isn't active.
 * @param volume - [0,1] normalized gain. Callers reading from project schema (which stores [0,100]) must divide by 100 before passing.
 */
export function syncLayerVolume(layerId: string, volume: number): void {
  const gain = getLayerGain(layerId);
  if (!gain) return;
  const ctx = getAudioContext();
  // Guard against NaN/Infinity. Default to 1.0 (full volume) rather than 0 — syncing mid-playback
  // to silence would be more disruptive than staying audible, and makes malformed data detectable.
  // Intentionally different from getLayerNormalizedVolume (layerTrigger.ts) which defaults to 0:
  // that function converts untrusted schema data at session boundaries; this runs mid-playback
  // where abrupt silence is the worse outcome.
  const clamped = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(clamped, ctx.currentTime);
}

/**
 * Set the live volume for a layer's gain node and mirror to the playback store.
 * Pass volume in 0–1 range. On drag-end, persist to the project schema via
 * `useProjectStore.getState().updateLayerVolume(layerId, volume)`.
 */
export function setLayerVolume(layerId: string, volume: number): void {
  const clamped = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0;
  const gain = getLayerGain(layerId);
  if (gain) {
    // Layer is playing — update gain node. Tick reads the new value automatically.
    const ctx = getAudioContext();
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setValueAtTime(clamped, ctx.currentTime);
  } else {
    // Layer not playing — tick has no gain node to read. Push directly to store.
    usePlaybackStore.getState().updateLayerVolume(layerId, clamped);
  }
}

// commitLayerVolume was removed: persisting layer volume to the project schema
// is a UI-layer concern. Callers should use
//   useProjectStore.getState().updateLayerVolume(layerId, volume)
// directly on drag-end / value commit.
