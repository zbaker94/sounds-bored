// src/lib/audio/fadeMixer.ts
import { getAudioContext } from "./audioContext";
import {
  startFade,
  cancelFade,
  addFadingIn,
  removeFadingIn,
  isFadingIn,
} from "./fadeCoordinator";
import { getPadGain } from "./gainRegistry";
import { nullPadOnEnded } from "./voiceRegistry";
import { stopPad } from "./stopHandler";
import { rampGainTo, resetPadGain } from "./gainManager";
import * as coordinator from './playbackStateCoordinator';
import { useProjectStore } from "@/state/projectStore";
import { buildPadMap } from "@/lib/padUtils";
import type { Pad } from "@/lib/schemas";

// Pre-#423 stopgap: look up the live pad at timeout fire time so that layers
// added or removed via the pad config drawer during a long fade are reflected
// in the cleanup pass. Falls back to the captured reference if the pad was
// deleted mid-fade.
// TODO(#423): FadeCoordinator will own the timeout body — this lookup becomes natural.
function resolveLivePad(pad: Pad): Pad {
  return buildPadMap(useProjectStore.getState().project?.scenes ?? []).get(pad.id) ?? pad;
}

/**
 * Freeze a pad's gain at its current value — cancels any in-progress ramp
 * so the pad stays at whatever volume it was at when called.
 *
 * Also clears fade tracking on both fadeCoordinator and playbackStore via cancelFade.
 */
export function freezePadAtCurrentVolume(padId: string): void {
  const ctx = getAudioContext();
  const gain = getPadGain(padId);
  cancelFade(padId);
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
  stopPad(pad);
  coordinator.padStopped(pad.id);
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
  coordinator.padStoppedReversing(pad.id);
  const fadingDown = toVolume < fromVolume;

  if (fadingDown) {
    // Null onended callbacks so chained voices don't restart at the faded-down level.
    nullPadOnEnded(pad.id);
  }

  rampGainTo(getPadGain(pad.id).gain, toVolume, durationMs / 1000, fromVolume);

  startFade(
    pad.id,
    fromVolume,
    fadingDown,
    durationMs,
    fadingDown && toVolume === 0
      ? () => {
          stopPadInternal(resolveLivePad(pad));
          resetPadGain(pad.id);
        }
      : undefined,
  );
}

export async function fadePadIn(
  pad: Pad,
  toVolume: number,
  durationMs: number,
  startPad: (pad: Pad) => Promise<void>,
): Promise<void> {
  cancelFade(pad.id);
  // addFadingIn is local-only — playbackStore mirror happens inside startFade after await resolves.
  addFadingIn(pad.id);

  await startPad(pad);

  // If pre-empted during the await, bail without overwriting the interleaved ramp.
  if (!isFadingIn(pad.id)) return;
  removeFadingIn(pad.id);

  rampGainTo(getPadGain(pad.id).gain, toVolume, durationMs / 1000, 0);

  startFade(
    pad.id,
    0,
    false,
    durationMs,
    toVolume === 0
      ? () => { stopPadInternal(resolveLivePad(pad)); }
      : undefined,
  );
}
