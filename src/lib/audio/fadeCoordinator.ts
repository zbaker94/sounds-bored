/**
 * fadeCoordinator.ts — Atomic owner of all pad fade state.
 *
 * Replaces the previous pattern where 8-9 separate function calls were needed
 * to start or cancel a fade (cancelPadFade + addFadingOutPad + setPadFadeFromVolume
 * + setFadePadTimeout + addFadingPad + addFadingOutPad on playbackStore + ...).
 *
 * The atomic per-pad API is `startFade` and `cancelFade`. Together they keep:
 *   - local fade timeouts
 *   - fadingOut membership
 *   - fromVolume snapshots
 *   - playbackStore reactive UI signals (fadingPadIds / fadingOutPadIds)
 * in lockstep so callers cannot leak partially-cancelled fade state.
 *
 * `addFadingIn` / `removeFadingIn` are local-only flags covering the async gap
 * before `await startPad` resumes inside `fadePadIn`; they are not mirrored to
 * playbackStore (no UI surface depends on them). `clearAllFades` is a bulk
 * local teardown for project-close — see its docstring for the playbackStore
 * caveat.
 *
 * The legacy primitives (cancelPadFade, addFadingOutPad, setFadePadTimeout, ...)
 * remain exported for backward compatibility while consumers migrate to the
 * atomic API. They mutate local state only — playbackStore coordination is the
 * caller's responsibility, matching the previous audioState behavior exactly.
 */

import { usePlaybackStore } from "@/state/playbackStore";

// ---------------------------------------------------------------------------
// Private state
// ---------------------------------------------------------------------------

const fadePadTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const fadingOutPadIds = new Set<string>();
const fadingInPadIds = new Set<string>();
const padFadeFromVolumes = new Map<string, number>();

/**
 * Grace window added to the requested fade duration before the completion
 * callback fires. Covers Web Audio scheduler jitter so the gain ramp has
 * fully settled before voices are stopped / state is cleared.
 */
const FADE_COMPLETION_GRACE_MS = 5;

// ---------------------------------------------------------------------------
// Atomic API — start/cancel a fade in one call, including playbackStore mirror
// ---------------------------------------------------------------------------

/**
 * Atomically start a fade for a pad. Cancels any in-flight fade first,
 * records `fromVolume`, mirrors fade state to playbackStore, and schedules
 * a completion timeout that runs `onComplete` after teardown.
 *
 * The completion timeout is guarded against staleness: if `fadingOut` was
 * requested but the pad has been cleared from `fadingOutPadIds` by the time
 * the timer fires (e.g. pad was re-triggered mid-fade), `onComplete` is NOT
 * called — preventing a stale timeout from stopping a pad that is now active.
 */
export function startFade(
  padId: string,
  fromVolume: number,
  fadingOut: boolean,
  durationMs: number,
  onComplete?: () => void,
): void {
  cancelFade(padId);
  fadingInPadIds.delete(padId);

  padFadeFromVolumes.set(padId, fromVolume);

  if (fadingOut) {
    fadingOutPadIds.add(padId);
    usePlaybackStore.getState().addFadingOutPad(padId);
  }
  usePlaybackStore.getState().addFadingPad(padId);

  const timeoutId = setTimeout(() => {
    fadePadTimeouts.delete(padId);
    if (fadingOut && !fadingOutPadIds.has(padId)) return;
    fadingOutPadIds.delete(padId);
    padFadeFromVolumes.delete(padId);
    usePlaybackStore.getState().removeFadingPad(padId);
    usePlaybackStore.getState().removeFadingOutPad(padId);
    onComplete?.();
  }, durationMs + FADE_COMPLETION_GRACE_MS);

  fadePadTimeouts.set(padId, timeoutId);
}

/**
 * Atomically cancel any in-flight fade for a pad. Idempotent.
 *
 * NOTE: `fadingInPadIds` is intentionally NOT cleared here. `triggerPad`
 * calls `cancelFade` internally and must not pre-empt a `triggerAndFade`
 * that is still in flight during its `await startPad(...)` gap. Only
 * `startFade` (an explicit reversal) and `clearAllFades` clear fadingIn.
 */
export function cancelFade(padId: string): void {
  const tId = fadePadTimeouts.get(padId);
  if (tId !== undefined) {
    clearTimeout(tId);
    fadePadTimeouts.delete(padId);
  }
  fadingOutPadIds.delete(padId);
  padFadeFromVolumes.delete(padId);
  usePlaybackStore.getState().removeFadingPad(padId);
  usePlaybackStore.getState().removeFadingOutPad(padId);
}

/** Mark a pad as fading-in to cover the async gap before `await startPad`. */
export function addFadingIn(padId: string): void {
  fadingInPadIds.add(padId);
}

/** Clear the fading-in flag once `await startPad` resumes. */
export function removeFadingIn(padId: string): void {
  fadingInPadIds.delete(padId);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function isFading(padId: string): boolean {
  return fadePadTimeouts.has(padId);
}

export function isFadingOut(padId: string): boolean {
  return fadingOutPadIds.has(padId);
}

export function isFadingIn(padId: string): boolean {
  return fadingInPadIds.has(padId);
}

export function getFadeFromVolume(padId: string): number | undefined {
  return padFadeFromVolumes.get(padId);
}

/** True when any fade timeout, fading-out membership, or fading-in membership is active. */
export function isAnyFadeActive(): boolean {
  return (
    fadePadTimeouts.size > 0 ||
    fadingOutPadIds.size > 0 ||
    fadingInPadIds.size > 0
  );
}

// ---------------------------------------------------------------------------
// Bulk teardown
// ---------------------------------------------------------------------------

/**
 * Cancel all pending fade timeouts and clear all local fade tracking.
 *
 * Local-only bulk teardown used by clearAllAudioState() on project close.
 * Does NOT touch playbackStore — callers performing full-session teardown
 * are expected to reset playbackStore separately (project close already
 * unmounts the subscribers, so the residual signals are harmless).
 *
 * For per-pad cancel that DOES mirror to playbackStore, use cancelFade.
 */
export function clearAllFades(): void {
  for (const id of fadePadTimeouts.values()) clearTimeout(id);
  fadePadTimeouts.clear();
  fadingOutPadIds.clear();
  fadingInPadIds.clear();
  padFadeFromVolumes.clear();
}

// ---------------------------------------------------------------------------
// Legacy primitives — local-state-only mutators retained for callers that have
// not yet migrated to the atomic API. They do NOT touch playbackStore; callers
// (gainManager.resetPadGain, ...) handle that mirror at the call site as before.
// ---------------------------------------------------------------------------

/** @deprecated Use isFadingOut from the atomic API instead — same behavior, modern name. */
export function isPadFadingOut(padId: string): boolean {
  return fadingOutPadIds.has(padId);
}

/** @deprecated Use isFading from the atomic API instead — same behavior, modern name. */
export function isPadFading(padId: string): boolean {
  return fadePadTimeouts.has(padId);
}

/** @deprecated Use isFadingIn from the atomic API instead — same behavior, modern name. */
export function isPadFadingIn(padId: string): boolean {
  return fadingInPadIds.has(padId);
}

/**
 * Cancel all fade-related local resources for a pad (pending timeout,
 * fadingOut tracking, fromVolume). Does NOT clear playbackStore signals or
 * fadingInPadIds — see the cancelFade docblock for the fadingIn rationale.
 *
 * @deprecated Use cancelFade instead — cancelPadFade leaves
 *   playbackStore.fadingPadIds / fadingOutPadIds set, which causes UI signals
 *   to leak past the cancellation point. Only retained for the gainManager
 *   circular-dep workaround and pre-existing test seams.
 */
export function cancelPadFade(padId: string): void {
  const tId = fadePadTimeouts.get(padId);
  if (tId !== undefined) {
    clearTimeout(tId);
    fadePadTimeouts.delete(padId);
  }
  fadingOutPadIds.delete(padId);
  padFadeFromVolumes.delete(padId);
}

/**
 * @deprecated Use startFade with `fadingOut=true` instead — startFade also
 *   sets playbackStore.fadingPadIds / fadingOutPadIds and schedules the
 *   completion timeout, which addFadingOutPad alone does not do.
 */
export function addFadingOutPad(padId: string): void {
  fadingOutPadIds.add(padId);
}

/**
 * @deprecated Use cancelFade instead — removeFadingOutPad does not clear the
 *   pending timeout or playbackStore signals, leaving partially-cancelled
 *   fade state that can fire later and stop a pad that is now active.
 */
export function removeFadingOutPad(padId: string): void {
  fadingOutPadIds.delete(padId);
}

/** @deprecated Use addFadingIn instead — same behavior, modern name. */
export function addFadingInPad(padId: string): void {
  fadingInPadIds.add(padId);
}

/** @deprecated Use removeFadingIn instead — same behavior, modern name. */
export function removeFadingInPad(padId: string): void {
  fadingInPadIds.delete(padId);
}

/**
 * @deprecated Use startFade instead — startFade records fromVolume as part of
 *   the atomic transition; calling this directly leaves the timeout and store
 *   signals out of sync with the recorded volume.
 */
export function setPadFadeFromVolume(padId: string, fromVolume: number): void {
  padFadeFromVolumes.set(padId, fromVolume);
}

/** @deprecated Use getFadeFromVolume from the atomic API instead — same behavior, modern name. */
export function getPadFadeFromVolume(padId: string): number | undefined {
  return padFadeFromVolumes.get(padId);
}

/**
 * @deprecated Use startFade instead — startFade schedules the timeout
 *   together with the fadingOut/fromVolume/playbackStore writes so they can
 *   never get out of sync. setFadePadTimeout alone leaks the other three.
 */
export function setFadePadTimeout(padId: string, timeoutId: ReturnType<typeof setTimeout>): void {
  fadePadTimeouts.set(padId, timeoutId);
}

/**
 * @deprecated Use cancelFade instead — deleteFadePadTimeout leaves
 *   fadingOut, fromVolume, and playbackStore signals set, producing the same
 *   stale-state hazard the atomic API was introduced to eliminate.
 */
export function deleteFadePadTimeout(padId: string): void {
  fadePadTimeouts.delete(padId);
}

/** @deprecated Use clearAllFades instead — same behavior, modern name. */
export function clearAllFadeTracking(): void {
  clearAllFades();
}
