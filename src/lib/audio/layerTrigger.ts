// src/lib/audio/layerTrigger.ts
//
// Extracted layer trigger helpers used by padPlayer.ts.
//
// Public exports (re-exported from index.ts):
//   - getVoiceVolume / getLayerNormalizedVolume / shouldLayerLoopNatively
//   - rampStopLayerVoices
//   - startLayerSound — public entry point; thin coordinator over the three phases below
//   - applyRetriggerMode / startLayerPlayback / triggerLayerOfPad
//   - syncLayerPlaybackMode / syncLayerArrangement / syncLayerSelection / syncLayerConfig
//   - selectionsEqual / stopLayerWithRamp / skipLayerForward / skipLayerBack
//   - BufferVoiceMeta (type)
//
// Internal exports (@internal — exported for unit testing only, not in public index):
//   - loadVoice — pure voice creation (streaming vs buffer), no side effects
//   - setupVoiceLifecycle — wires onended, records voice, updates UI overlay, streaming/progress state
//   - handleVoiceError — circuit-breaker, error emit, state cleanup on load failure
//
// Private (not exported):
//   - resolveSounds / stopLayerWithRampInternal

import { ensureResumed, getAudioContext } from "./audioContext";
import * as coordinator from './playbackStateCoordinator';
import { clampGain01 } from "./gainManager";
import { normalizedVoiceGain } from "./gainNormalization";
import { cancelFade } from "./fadeCoordinator";
import { loadBuffer, MissingFileError } from "./bufferCache";
import { checkIsLargeFile, getOrCreateStreamingElement } from "./streamingCache";
import { wrapBufferSource, wrapStreamingElement, STOP_RAMP_S } from "./audioVoice";
import type { AudioVoice } from "./audioVoice";
import { buildPlayOrder, isChained } from "./arrangement";
import { resolveLayerSounds, snapshotSounds, type SoundSnapshot } from "./resolveSounds";
import { useLibraryStore } from "@/state/libraryStore";
import type { Layer, LayerSelection, Pad, Sound } from "@/lib/schemas";
import { emitAudioError } from "./audioEvents";
import { startAudioTick } from "./audioTick";
import {
  addStopCleanupTimeout,
  deleteStopCleanupTimeout,
  getPadProgressInfo,
  setLayerProgressInfo,
  setPadProgressInfo,
  clearLayerProgressInfo,
  clearPadProgressInfo,
} from "./audioState";
import {
  clearLayerVoice,
  getLayerVoices,
  isLayerActive,
  isPadActive,
  recordLayerVoice,
  stopLayerVoices,
} from "./voiceRegistry";
import {
  getLayerGain,
  getOrCreateLayerGain,
  getPadGain,
} from "./gainRegistry";
import {
  clearLayerPending,
  deleteLayerChain,
  deleteLayerCycleIndex,
  deleteLayerPlayOrder,
  getLayerChain,
  getLayerCycleIndex,
  getLayerPlayOrder,
  incrementLayerConsecutiveFailures,
  notifyChainCycleStateChanged,
  resetLayerConsecutiveFailures,
  setLayerChain,
  setLayerCycleIndex,
  setLayerPending,
  setLayerPlayOrder,
} from "./chainCycleState";
import { getLayerContext, type LayerPlaybackContext } from "./layerPlaybackContext";
import { register as registerStreaming, dispose as disposeStreaming } from "./streamingAudioLifecycle";

/**
 * Maximum consecutive `loadLayerVoice` failures allowed within a single chain
 * before the chain is torn down and a single summary error is emitted. Prevents
 * a 500-sound chain with 500 missing files from producing 500 toasts.
 */
const CHAIN_FAILURE_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// Private utilities
// ---------------------------------------------------------------------------

/** Returns the 0–1 gain value for a specific sound within a layer.
 *  For "assigned" selections, reads SoundInstance.volume (0–100 scale).
 *  For "tag"/"set" selections, reads LayerSelection.defaultVolume (0–100 scale).
 *  Applies loudness normalization (EBU R128 → −14 LUFS target) when available. */
export function getVoiceVolume(layer: Layer, sound: Sound): number {
  const rawGain =
    layer.selection.type === "assigned"
      ? clampGain01((layer.selection.instances.find((i) => i.soundId === sound.id)?.volume ?? 100) / 100)
      : clampGain01(layer.selection.defaultVolume / 100);
  return normalizedVoiceGain(rawGain, sound.loudnessLufs ?? undefined);
}

/** Convert Layer.volume (schema: 0–100) to a Web Audio gain value (0–1).
 *  Clamps to [0, 1] and returns 0 for non-finite values (silence is safer than full volume
 *  for malformed data — the Zod schema rejects non-finite at parse time, so this path
 *  is a last-resort guard against data bypassing validation). */
export function getLayerNormalizedVolume(layer: Layer): number {
  return clampGain01(layer.volume / 100);
}

/** Resolve a layer's sound selection to playable Sound objects (filePath required). */
export function resolveSounds(layer: Layer, sounds: SoundSnapshot): Sound[] {
  return resolveLayerSounds(layer, sounds).filter((s) => !!s.filePath);
}

/** True when a layer's voices should use the native loop flag (source.loop / audio.loop).
 *  Covers non-chained loop/hold modes and cycle mode (which plays one sound at a time,
 *  so native looping is used even with a chained arrangement). */
export function shouldLayerLoopNatively(layer: Layer): boolean {
  return (layer.playbackMode === "loop" || layer.playbackMode === "hold") &&
    (!isChained(layer.arrangement) || layer.cycleMode);
}

// ---------------------------------------------------------------------------
// Ramped layer stop primitives (used by applyRetriggerMode + padPlayer stop fns)
// ---------------------------------------------------------------------------

/**
 * Ramp-stop a specific set of voices on a layer: null their onended callbacks,
 * stop with a gain ramp, then clean up voice + gain state after the ramp window.
 */
export function rampStopLayerVoices(
  padId: string,
  layer: Layer,
  voices: readonly AudioVoice[],
): void {
  for (const v of voices) v.setOnEnded(null);
  for (const v of voices) v.stopWithRamp(STOP_RAMP_S);

  const gain = getLayerGain(layer.id);
  const resetValue = getLayerNormalizedVolume(layer);
  const timeoutId = setTimeout(() => {
    deleteStopCleanupTimeout(timeoutId);
    for (const v of voices) clearLayerVoice(padId, layer.id, v);
    if (!isPadActive(padId)) {
      coordinator.padStopped(padId);
    }
    if (gain) {
      const ctx = getAudioContext();
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setValueAtTime(resetValue, ctx.currentTime);
    }
  }, STOP_RAMP_S * 1000 + 5);
  addStopCleanupTimeout(timeoutId);
}

/** Stop all active voices for a layer with a short gain ramp. No-op if no voices. */
function stopLayerWithRampInternal(pad: Pad, layer: Layer): void {
  const voices = [...getLayerVoices(layer.id)];
  if (voices.length === 0) return;
  rampStopLayerVoices(pad.id, layer, voices);
}

// ---------------------------------------------------------------------------
// Voice creation — streaming vs buffer path (pure, no side effects)
// ---------------------------------------------------------------------------

/** Metadata returned by loadVoice for the buffer (short file) path.
 *  Consumed by setupVoiceLifecycle to write progress info and loop state. */
export interface BufferVoiceMeta {
  duration: number;
  /** Whether the buffer source's native loop flag was set (per layer policy, via shouldLayerLoopNatively). */
  isLooping: boolean;
}

/**
 * Create a voice for one sound on one layer. Pure: routes to streaming path
 * (HTMLAudioElement) for large files, buffer path (AudioBufferSourceNode) for
 * small files. Returns the voice, the HTMLAudioElement (streaming) or null
 * (buffer), and buffer metadata for the buffer path. Side effects (progress
 * info, streaming registration) are handled by setupVoiceLifecycle.
 *
 * Throws on load failure — caller is responsible for catching.
 *
 * @internal Exported for unit testing only — do not import outside layerTrigger.ts or its test.
 */
export async function loadVoice(
  sound: Sound,
  layer: Layer,
  ctx: AudioContext,
  layerGain: GainNode,
  voiceVolume: number,
): Promise<{ voice: AudioVoice; audio: HTMLAudioElement | null; bufferMeta?: BufferVoiceMeta }> {
  const isLarge = await checkIsLargeFile(sound);

  if (isLarge) {
    const { audio: cachedAudio, sourceNode } = getOrCreateStreamingElement(sound, ctx);
    sourceNode.disconnect();
    cachedAudio.currentTime = 0;
    cachedAudio.loop = shouldLayerLoopNatively(layer);
    const voice = wrapStreamingElement(cachedAudio, sourceNode, ctx, layerGain, voiceVolume);
    return { voice, audio: cachedAudio };
  } else {
    const buffer = await loadBuffer(sound);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    if (shouldLayerLoopNatively(layer)) {
      source.loop = true;
    }
    const voice = wrapBufferSource(source, ctx, layerGain, voiceVolume);
    return { voice, audio: null, bufferMeta: { duration: buffer.duration, isLooping: source.loop } satisfies BufferVoiceMeta };
  }
}

// ---------------------------------------------------------------------------
// Voice lifecycle — onended wiring, registry, UI overlay, progress/streaming
// ---------------------------------------------------------------------------

/**
 * Wire the onended chain-continuation callback, register the voice, update UI
 * overlay and progress/streaming state, then start the voice. All observable
 * side effects from a successful load live here.
 *
 * @internal Exported for unit testing only — do not import outside layerTrigger.ts or its test.
 */
export async function setupVoiceLifecycle(
  voice: AudioVoice,
  audio: HTMLAudioElement | null,
  pad: Pad,
  layer: Layer,
  sound: Sound,
  ctx: AudioContext,
  layerGain: GainNode,
  allSounds: Sound[],
  bufferMeta?: BufferVoiceMeta,
): Promise<void> {
  if (audio) {
    registerStreaming(pad.id, layer.id, audio);
  }
  if (bufferMeta) {
    // Chained: always update progress to track the current sound.
    // Simultaneous: keep the longest-duration voice so the bar fills on the slowest sound.
    const existing = getPadProgressInfo(pad.id);
    if (isChained(layer.arrangement) || !existing || bufferMeta.duration > existing.duration) {
      setPadProgressInfo(pad.id, { startedAt: ctx.currentTime, duration: bufferMeta.duration, isLooping: bufferMeta.isLooping });
    }
    setLayerProgressInfo(layer.id, { startedAt: ctx.currentTime, duration: bufferMeta.duration, isLooping: bufferMeta.isLooping });
  }

  voice.setOnEnded(() => {
    if (audio) disposeStreaming(pad.id, layer.id, audio);
    clearLayerVoice(pad.id, layer.id, voice);

    // Chain to the next sound if one is queued (sequential/shuffled).
    // `remaining === undefined` means the queue was cleared externally (stop/reset).
    // `remaining.length === 0` means the chain ran to completion naturally.
    const remaining = getLayerChain(layer.id);

    if (remaining !== undefined && remaining.length > 0) {
      // Chain continues — defer removePlayingPad until the next voice starts so
      // the pad doesn't briefly flash as "not playing" between chained sounds.
      const [next, ...rest] = remaining;
      continueLayerChain(pad, layer, ctx, layerGain, next, rest, allSounds).catch(
        (err) => emitAudioError(err, {}),
      );
    } else if (remaining !== undefined && (layer.playbackMode === "loop" || layer.playbackMode === "hold")) {
      // Chain exhausted naturally — restart using captured snapshot; config changes take effect next trigger.
      restartLoopChain(pad, layer, ctx, layerGain, allSounds);
    } else {
      // Chain exhausted (one-shot) or cleared externally (stop/reset).
      if (remaining !== undefined) deleteLayerChain(layer.id);
      if (!isPadActive(pad.id)) coordinator.padStopped(pad.id);
    }
  });

  await voice.start();
  recordLayerVoice(pad.id, layer.id, voice);
  // Only show metadata overlay if the pad is still active. Guards against the
  // narrow race where stopPad fires between voice.start() resolving and
  // enqueueVoice being called — after the stop cleanup runs, isPadActive
  // returns false and we skip the now-stale overlay enqueue.
  if (isPadActive(pad.id)) {
    coordinator.voiceEnqueued(pad.id, {
      soundName: sound.name,
      layerName: layer.name,
      playbackMode: layer.playbackMode,
      durationMs: sound.durationMs,
      coverArtDataUrl: sound.coverArtDataUrl,
    });
  }
  coordinator.padStarted(pad.id);
  startAudioTick();
}

// ---------------------------------------------------------------------------
// Error handling — circuit-breaker, error emit, state cleanup
// ---------------------------------------------------------------------------

/**
 * Handle a voice load failure: clear progress/chain/cycle state, run the
 * circuit-breaker, and emit the appropriate error. Isolated here so the
 * circuit-breaker behavior is testable without voice setup.
 *
 * @internal Exported for unit testing only — do not import outside layerTrigger.ts or its test.
 */
export function handleVoiceError(err: unknown, pad: Pad, layer: Layer, sound: Sound): void {
  // Clear stale progress so a failed load doesn't freeze the bar at 1.0.
  clearLayerProgressInfo(layer.id);
  clearPadProgressInfo(pad.id);

  // Always clear chain and cycle state on any failure so the next trigger
  // starts fresh rather than resuming from an invalid position (#136).
  deleteLayerChain(layer.id);
  deleteLayerCycleIndex(layer.id);

  // When a restart-mode retrigger stopped the current voice but failed to load
  // the new one, the pad must be removed from playingPadIds (no voices remain).
  if (!isPadActive(pad.id)) {
    coordinator.padStopped(pad.id);
  }

  // Circuit-breaker: a chain of consecutive load failures (e.g. entire library
  // missing on disk) would otherwise spawn one toast per sound. Tear the chain
  // down after CHAIN_FAILURE_THRESHOLD consecutive failures and emit a single
  // summary error in place of the per-sound error for that final failure.
  const failureCount = incrementLayerConsecutiveFailures(layer.id);
  if (failureCount >= CHAIN_FAILURE_THRESHOLD) {
    resetLayerConsecutiveFailures(layer.id);
    emitAudioError(
      new Error(
        `Chain stopped after ${CHAIN_FAILURE_THRESHOLD} consecutive load failures (pad: "${pad.name}", layer: "${layer.name ?? layer.id}")`,
      ),
      {
        soundName: sound.name,
        isMissingFile: err instanceof MissingFileError,
      },
    );
    return;
  }

  // Under the threshold — emit via the error bus as usual. The UI-layer
  // handler (useAudioErrorHandler) shows the toast and triggers reconciliation.
  emitAudioError(err, {
    soundName: sound.name,
    isMissingFile: err instanceof MissingFileError,
  });
}

// ---------------------------------------------------------------------------
// startLayerSound — voice lifecycle + onended chain continuation
// ---------------------------------------------------------------------------

function restartLoopChain(pad: Pad, layer: Layer, ctx: AudioContext, layerGain: GainNode, allSounds: Sound[]): void {
  clearLayerProgressInfo(layer.id);
  clearPadProgressInfo(pad.id);
  startAudioTick();
  coordinator.voiceDequeued(pad.id);
  if (isChained(layer.arrangement)) {
    const newOrder = buildPlayOrder(layer.arrangement, allSounds);
    if (newOrder.length === 0) {
      deleteLayerChain(layer.id);
      if (!isPadActive(pad.id)) coordinator.padStopped(pad.id);
      return;
    }
    const [first, ...rest] = newOrder;
    setLayerChain(layer.id, rest);
    startLayerSound(pad, layer, first, ctx, layerGain, getVoiceVolume(layer, first), allSounds).catch(
      (err) => emitAudioError(err, {}),
    );
  } else {
    deleteLayerChain(layer.id);
    if (allSounds.length === 0) {
      if (!isPadActive(pad.id)) coordinator.padStopped(pad.id);
      return;
    }
    for (const snd of allSounds) {
      startLayerSound(pad, layer, snd, ctx, layerGain, getVoiceVolume(layer, snd), allSounds).catch(
        (err) => emitAudioError(err, {}),
      );
    }
  }
}

/**
 * Shared chain-continuation helper used by both the natural onended path and the manual
 * "next"-retrigger path. Clears progress, shifts the metadata display, and starts the
 * given next sound. Centralising this ensures both paths stay in sync.
 *
 * Natural onended path: fire-and-forget via .catch — no pending flag is held.
 * Manual "next" retrigger: awaited — keeps the layer pending until the sound starts.
 */
async function continueLayerChain(
  pad: Pad,
  layer: Layer,
  ctx: AudioContext,
  layerGain: GainNode,
  next: Sound,
  rest: Sound[],
  allSounds: Sound[],
): Promise<void> {
  setLayerChain(layer.id, rest);
  clearLayerProgressInfo(layer.id);
  clearPadProgressInfo(pad.id);
  startAudioTick();
  coordinator.voiceDequeued(pad.id);
  await startLayerSound(pad, layer, next, ctx, layerGain, getVoiceVolume(layer, next), allSounds);
}

/**
 * Load and start a single sound for a layer. Thin coordinator: delegates to
 * loadVoice → setupVoiceLifecycle → handleVoiceError.
 *
 * Audio graph: sourceNode -> voiceGain -> layerGain -> padGain -> masterGain
 */
export async function startLayerSound(
  pad: Pad,
  layer: Layer,
  sound: Sound,
  ctx: AudioContext,
  layerGain: GainNode,
  voiceVolume: number,
  allSounds: Sound[],
): Promise<void> {
  try {
    const { voice, audio, bufferMeta } = await loadVoice(sound, layer, ctx, layerGain, voiceVolume);
    await setupVoiceLifecycle(voice, audio, pad, layer, sound, ctx, layerGain, allSounds, bufferMeta);
    // Voice fully started and recorded — clear the consecutive-failure counter so
    // a future failure starts from zero. Placed after setupVoiceLifecycle so we only
    // count it as a real success once the voice is actually tracked in state.
    resetLayerConsecutiveFailures(layer.id);
  } catch (err) {
    handleVoiceError(err, pad, layer, sound);
  }
}

// ---------------------------------------------------------------------------
// applyRetriggerMode — deduplicates the retrigger switch shared by
//   triggerPad (iterates layers, uses `continue`) and
//   triggerLayer (single layer, uses `return`).
// ---------------------------------------------------------------------------

/**
 * Result of applying retrigger logic for one layer:
 * - "skip"           — don't start new playback (stop mode stopped; continue mode kept going)
 * - "proceed"        — clear progress and start new playback via startLayerPlayback
 * - "chain-advanced" — "next" mode advanced (or exhausted) the sound chain; addPlayingPad is
 *                      called by startLayerSound after a successful voice start; applyRetriggerMode
 *                      calls removePlayingPad if the chain exhausted with no replacement voice.
 */
export type RetriggerAction = "skip" | "proceed" | "chain-advanced";

/**
 * Apply the layer's retrigger mode when the layer is already active (or not).
 *
 * @param afterStopCleanup - Optional callback fired after a "stop"-mode ramp-stop.
 *   `triggerLayer` uses this to schedule a deferred `removePlayingPad` check;
 *   `triggerPad` omits it (the pad-level store state is managed globally).
 */
function handleStopRetrigger(pad: Pad, layer: Layer, resolved: Sound[], afterStopCleanup?: () => void, layerCtx?: LayerPlaybackContext): RetriggerAction {
  // Use ctx directly in trigger path if available; fall back to module-level API otherwise.
  if (layerCtx) {
    layerCtx.chainQueue = undefined;
    notifyChainCycleStateChanged();
  } else {
    deleteLayerChain(layer.id);
  }
  // rampStopLayerVoices nulls onended before stopping, so the normal cleanup
  // callback won't fire — delete the layer's streaming entry explicitly.
  disposeStreaming(pad.id, layer.id);
  stopLayerWithRampInternal(pad, layer);
  afterStopCleanup?.();
  // Cycle mode: advance cursor so next trigger plays the next sound.
  if (layer.cycleMode && isChained(layer.arrangement) && resolved.length > 0) {
    if (layerCtx) {
      const nextIndex = (layerCtx.cycleIndex ?? 0) + 1;
      layerCtx.cycleIndex = nextIndex >= resolved.length ? undefined : nextIndex;
    } else {
      const nextIndex = (getLayerCycleIndex(layer.id) ?? 0) + 1;
      if (nextIndex >= resolved.length) {
        deleteLayerCycleIndex(layer.id);
      } else {
        setLayerCycleIndex(layer.id, nextIndex);
      }
    }
  }
  return "skip";
}

function handleRestartRetrigger(pad: Pad, layer: Layer, resolved: Sound[], layerCtx?: LayerPlaybackContext): void {
  if (layerCtx) {
    layerCtx.chainQueue = undefined;
    notifyChainCycleStateChanged();
  } else {
    deleteLayerChain(layer.id);
  }
  stopLayerVoices(pad.id, layer.id);
  // Cycle mode: back cursor up so the same sound replays.
  if (layer.cycleMode && isChained(layer.arrangement) && resolved.length > 0) {
    if (layerCtx) {
      const cur = layerCtx.cycleIndex ?? 0;
      layerCtx.cycleIndex = cur === 0 ? resolved.length - 1 : cur - 1;
    } else {
      const cur = getLayerCycleIndex(layer.id) ?? 0;
      setLayerCycleIndex(layer.id, cur === 0 ? resolved.length - 1 : cur - 1);
    }
  }
}

async function loopBackToBeginning(
  pad: Pad,
  layer: Layer,
  ctx: AudioContext,
  layerGain: GainNode,
  resolved: Sound[],
): Promise<void> {
  const newOrder = buildPlayOrder(layer.arrangement, resolved);
  if (newOrder.length === 0) return;
  const [first, ...rest] = newOrder;
  setLayerChain(layer.id, rest);
  await startLayerSound(pad, layer, first, ctx, layerGain, getVoiceVolume(layer, first), resolved);
}

async function handleNextRetrigger(
  pad: Pad,
  layer: Layer,
  ctx: AudioContext,
  layerGain: GainNode,
  resolved: Sound[],
  layerCtx?: LayerPlaybackContext,
): Promise<RetriggerAction> {
  // Capture queue before clearing it.
  const remaining = [...((layerCtx ? layerCtx.chainQueue : getLayerChain(layer.id)) ?? [])];
  // Null onended BEFORE stopLayerVoices — stop() fires onended synchronously;
  // nulling first prevents the chain-advance callback from re-firing.
  for (const v of getLayerVoices(layer.id)) v.setOnEnded(null);
  if (layerCtx) {
    layerCtx.chainQueue = undefined;
    notifyChainCycleStateChanged();
  } else {
    deleteLayerChain(layer.id);
  }
  disposeStreaming(pad.id, layer.id);
  stopLayerVoices(pad.id, layer.id);
  clearPadProgressInfo(pad.id);
  clearLayerProgressInfo(layer.id);

  // Clear the metadata overlay: this voice's onended was nulled so shiftVoice will not
  // fire naturally. Explicit clear ensures the incoming sound's metadata becomes current
  // rather than queuing behind the still-displayed stopped voice.
  coordinator.clearPadMetadata(pad.id);

  if (layer.cycleMode && isChained(layer.arrangement)) {
    return "proceed";
  }

  if (remaining.length > 0) {
    const [next, ...rest] = remaining;
    await continueLayerChain(pad, layer, ctx, layerGain, next, rest, resolved);
  } else if ((layer.playbackMode === "loop" || layer.playbackMode === "hold") && isChained(layer.arrangement)) {
    await loopBackToBeginning(pad, layer, ctx, layerGain, resolved);
  }
  if (!isPadActive(pad.id)) {
    coordinator.padStopped(pad.id);
  }
  return "chain-advanced";
}

export async function applyRetriggerMode(
  pad: Pad,
  layer: Layer,
  isLayerPlaying: boolean,
  ctx: AudioContext,
  layerGain: GainNode,
  resolved: Sound[],
  afterStopCleanup?: () => void,
  layerCtx?: LayerPlaybackContext,
): Promise<RetriggerAction> {
  switch (layer.retriggerMode) {
    case "stop":
      if (isLayerPlaying) return handleStopRetrigger(pad, layer, resolved, afterStopCleanup, layerCtx);
      break;
    case "continue":
      if (isLayerPlaying) return "skip";
      break;
    case "restart":
      if (isLayerPlaying) handleRestartRetrigger(pad, layer, resolved, layerCtx);
      break;
    case "next":
      if (isLayerPlaying) return handleNextRetrigger(pad, layer, ctx, layerGain, resolved, layerCtx);
      break;
  }
  return "proceed";
}

// ---------------------------------------------------------------------------
// startLayerPlayback — deduplicates the start-playback section shared by
//   triggerPad (inside its layer for-loop) and triggerLayer.
// ---------------------------------------------------------------------------

/**
 * Build the play order and start all sounds for a layer.
 * Handles cycleMode, chained (sequential/shuffled), and simultaneous arrangements.
 * Manages the layerPending guard internally.
 *
 * Callers are responsible for clearing padProgressInfo BEFORE calling this
 * (triggerPad does it once for the first layer that starts; triggerLayer always does it).
 */
export async function startLayerPlayback(
  pad: Pad,
  layer: Layer,
  ctx: AudioContext,
  layerGain: GainNode,
  resolved: Sound[],
  layerCtx?: LayerPlaybackContext,
): Promise<void> {
  // A fresh user trigger always starts a clean failure sequence — reset the
  // circuit-breaker counter so failures from a previous play don't carry over
  // and prematurely suppress toasts on the new trigger's sounds.
  if (layerCtx) {
    layerCtx.consecutiveFailures = 0;
  } else {
    resetLayerConsecutiveFailures(layer.id);
  }
  clearLayerProgressInfo(layer.id);
  if (layerCtx) {
    layerCtx.pending = true;
  } else {
    setLayerPending(layer.id);
  }
  try {
    const playOrder = buildPlayOrder(layer.arrangement, resolved);
    if (layerCtx) {
      layerCtx.playOrder = playOrder;
      notifyChainCycleStateChanged();
    } else {
      setLayerPlayOrder(layer.id, playOrder);
    }

    if (layer.cycleMode && isChained(layer.arrangement)) {
      // Cycle mode: play exactly one sound per trigger, advancing the cursor.
      // No chain queue — onended will not auto-advance.
      if (layerCtx) {
        layerCtx.chainQueue = undefined;
        notifyChainCycleStateChanged();
        const cycleIndex = layerCtx.cycleIndex ?? 0;
        const sound = playOrder[cycleIndex % playOrder.length];
        const nextIndex = cycleIndex + 1;
        layerCtx.cycleIndex = (nextIndex >= playOrder.length && layer.playbackMode === "one-shot")
          ? undefined
          : nextIndex % playOrder.length;
        await startLayerSound(pad, layer, sound, ctx, layerGain, getVoiceVolume(layer, sound), resolved);
      } else {
        deleteLayerChain(layer.id);
        const cycleIndex = getLayerCycleIndex(layer.id) ?? 0;
        const sound = playOrder[cycleIndex % playOrder.length];
        const nextIndex = cycleIndex + 1;
        if (nextIndex >= playOrder.length && layer.playbackMode === "one-shot") {
          deleteLayerCycleIndex(layer.id);
        } else {
          setLayerCycleIndex(layer.id, nextIndex % playOrder.length);
        }
        await startLayerSound(pad, layer, sound, ctx, layerGain, getVoiceVolume(layer, sound), resolved);
      }
    } else if (isChained(layer.arrangement)) {
      const [first, ...rest] = playOrder;
      if (layerCtx) {
        layerCtx.chainQueue = rest;
        notifyChainCycleStateChanged();
      } else {
        setLayerChain(layer.id, rest);
      }
      await startLayerSound(pad, layer, first, ctx, layerGain, getVoiceVolume(layer, first), resolved);
    } else {
      if (layerCtx) {
        layerCtx.chainQueue = undefined;
        notifyChainCycleStateChanged();
      } else {
        deleteLayerChain(layer.id);
      }
      for (const sound of playOrder) {
        await startLayerSound(pad, layer, sound, ctx, layerGain, getVoiceVolume(layer, sound), resolved);
      }
    }
  } finally {
    if (layerCtx) {
      layerCtx.pending = false;
    } else {
      clearLayerPending(layer.id);
    }
  }
}

// ---------------------------------------------------------------------------
// triggerLayerOfPad — per-layer trigger sequence shared by triggerPad and
//   triggerLayer (extracted from the loop body in triggerPad per issue #130).
// ---------------------------------------------------------------------------

export interface TriggerLayerOfPadOpts {
  /** Callback fired after a "stop"-mode ramp-stop; used by triggerLayer to schedule
   *  a deferred removePlayingPad check. triggerPad omits it — pad state is managed globally. */
  afterStopCleanup?: () => void;
  /** When true, clears pad progress info immediately before starting playback.
   *  triggerLayer passes true (single-layer path); triggerPad clears upfront once
   *  for all parallel layers instead, so passes false (the default). */
  clearProgressOnProceed?: boolean;
}

/**
 * Core per-layer trigger sequence used by both triggerPad and triggerLayer.
 *
 * Preconditions (caller's responsibility):
 *   - resolveSounds already called and returned a non-empty array
 *   - setLayerPending already called
 *
 * Clears pending on skip / chain-advanced / error; startLayerPlayback's own
 * finally block handles it on the proceed path.
 */
export async function triggerLayerOfPad(
  pad: Pad,
  layer: Layer,
  ctx: AudioContext,
  padGain: GainNode,
  resolved: Sound[],
  opts?: TriggerLayerOfPadOpts,
): Promise<void> {
  try {
    const isLayerPlaying = isLayerActive(layer.id);
    const layerGain = getOrCreateLayerGain(layer.id, getLayerNormalizedVolume(layer), padGain);
    // Context is guaranteed to exist: getOrCreateLayerGain calls ensureLayerContext.
    const layerCtx = getLayerContext(layer.id)!;

    const action = await applyRetriggerMode(
      pad, layer, isLayerPlaying, ctx, layerGain, resolved, opts?.afterStopCleanup, layerCtx,
    );
    if (action === "skip" || action === "chain-advanced") {
      layerCtx.pending = false;
      return;
    }

    if (opts?.clearProgressOnProceed) clearPadProgressInfo(pad.id);
    await startLayerPlayback(pad, layer, ctx, layerGain, resolved, layerCtx);
    // startLayerPlayback clears pending in its own finally block
  } catch (err) {
    clearLayerPending(layer.id);
    emitAudioError(err);
  }
}

// ---------------------------------------------------------------------------
// Live-sync helpers — update audio state when layer config changes mid-playback
// ---------------------------------------------------------------------------

/**
 * Structural equality check for LayerSelection — avoids JSON.stringify overhead.
 * Compares all fields that affect playback resolution (sounds, volume, match rules).
 */
export function selectionsEqual(a: LayerSelection, b: LayerSelection): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case "assigned": {
      const bA = b as Extract<LayerSelection, { type: "assigned" }>;
      if (a.instances.length !== bA.instances.length) return false;
      return a.instances.every(
        (inst, i) =>
          inst.soundId === bA.instances[i].soundId &&
          inst.id === bA.instances[i].id &&
          inst.volume === bA.instances[i].volume &&
          inst.startOffsetMs === bA.instances[i].startOffsetMs,
      );
    }
    case "tag": {
      const bT = b as Extract<LayerSelection, { type: "tag" }>;
      return (
        a.matchMode === bT.matchMode &&
        a.defaultVolume === bT.defaultVolume &&
        a.tagIds.length === bT.tagIds.length &&
        a.tagIds.every((id, i) => id === bT.tagIds[i])
      );
    }
    case "set": {
      const bS = b as Extract<LayerSelection, { type: "set" }>;
      return a.setId === bS.setId && a.defaultVolume === bS.defaultVolume;
    }
  }
}

/**
 * Update the loop flag on any active voices for a layer.
 *
 * For non-chained arrangements: sets `source.loop` / `audio.loop` live so the
 * current pass plays to natural completion instead of stopping immediately.
 * For chained arrangements transitioning *away* from a looping mode: the loop
 * flag is irrelevant (onended drives restart), so we clear the chain queue.
 * When the current voice ends, `onended` sees `remaining === undefined` and
 * skips the restart. Transitions *into* a looping mode on chained arrangements
 * do NOT take effect at the next natural chain boundary — they apply only on
 * the next user trigger. The onended closure reads `layer.playbackMode` from
 * the captured layer object (snapshot semantics), so a live config update to
 * "loop" is ignored until a new trigger captures the updated layer.
 *
 * No-op if the layer has no active voices.
 */
export function syncLayerPlaybackMode(layer: Layer): void {
  const voices = getLayerVoices(layer.id);
  if (voices.length === 0) return;
  const isLoopMode = layer.playbackMode === "loop" || layer.playbackMode === "hold";

  // Update the loop flag on non-chained voices and cycle-mode voices.
  // Cycle mode plays one sound at a time (like simultaneous), so source.loop
  // is used instead of chain-based looping.
  const shouldLoop = shouldLayerLoopNatively(layer);
  for (const voice of voices) {
    voice.setLoop(shouldLoop);
  }
  // For chained arrangements (non-cycle) transitioning away from a looping mode,
  // clear the chain queue so the onended callback sees remaining === undefined
  // and skips the restart.
  if (!isLoopMode && isChained(layer.arrangement) && !layer.cycleMode) {
    deleteLayerChain(layer.id);
  }
}

/**
 * Called when the arrangement type for a layer changes while playback is active.
 *
 * - Chained -> chained (sequential <-> shuffled): rebuilds the chain queue with the
 *   new arrangement so the current sound plays out and the updated sequence follows.
 * - Chained -> non-chained: clears the queue so onended does not advance the stale chain.
 *
 * No-op if the layer has no active voices.
 */
export function syncLayerArrangement(layer: Layer): void {
  const voices = getLayerVoices(layer.id);
  if (voices.length === 0) return;

  if (isChained(layer.arrangement)) {
    // Intentional live-store read: called synchronously from a pad-save handler to rebuild
    // the chain queue with the updated arrangement while playback is in progress.
    const allSounds = resolveSounds(layer, snapshotSounds(useLibraryStore.getState().sounds));
    const newOrder = buildPlayOrder(layer.arrangement, allSounds);
    if (newOrder.length === 0) {
      deleteLayerChain(layer.id);
    } else {
      setLayerChain(layer.id, newOrder);
    }
  } else {
    // Switching to non-chained (simultaneous): replace the stale chain with an empty
    // array so onended treats it as natural exhaustion rather than an external stop.
    setLayerChain(layer.id, []);
  }
}

/**
 * Called when the sound selection for a layer changes while playback is active.
 *
 * For chained arrangements: rebuilds the chain queue with the new resolved sounds.
 * For non-chained arrangements: no-op — onended re-resolves sounds from the live store.
 *
 * No-op if the layer has no active voices.
 */
export function syncLayerSelection(layer: Layer): void {
  const voices = getLayerVoices(layer.id);
  if (voices.length === 0) return;

  if (isChained(layer.arrangement)) {
    // Intentional live-store read: called synchronously from a pad-save handler to rebuild
    // the chain queue with the updated selection while playback is in progress.
    const allSounds = resolveSounds(layer, snapshotSounds(useLibraryStore.getState().sounds));
    const newOrder = buildPlayOrder(layer.arrangement, allSounds);
    if (newOrder.length === 0) {
      deleteLayerChain(layer.id);
    } else {
      setLayerChain(layer.id, newOrder);
    }
  }
}

/**
 * Sync all live-playback state for a layer after a pad config save.
 * Calls syncLayerPlaybackMode, syncLayerArrangement, and/or syncLayerSelection
 * only for the fields that actually changed.
 */
export function syncLayerConfig(layer: Layer, original: Layer): void {
  if (original.playbackMode !== layer.playbackMode) syncLayerPlaybackMode(layer);
  const arrangementChanged = original.arrangement !== layer.arrangement;
  if (arrangementChanged) syncLayerArrangement(layer);
  // syncLayerArrangement already rebuilds the queue using the updated selection,
  // so skip syncLayerSelection to avoid a redundant rebuild — especially important
  // for shuffled, where a second call would produce a different random order.
  if (!arrangementChanged && !selectionsEqual(original.selection, layer.selection)) {
    syncLayerSelection(layer);
  }
  // When cycleMode is toggled off, clear the stale cursor so the next trigger
  // starts a normal chain instead of using a leftover index.
  if (original.cycleMode && !layer.cycleMode) {
    deleteLayerCycleIndex(layer.id);
  }
}

// ---------------------------------------------------------------------------
// Per-layer live controls — stop, skip
// ---------------------------------------------------------------------------

/** Stop all voices for a specific layer with a short gain ramp. Cleans up pad playing state if no layers remain active. */
export function stopLayerWithRamp(pad: Pad, layerId: string): void {
  const layer = pad.layers.find((l) => l.id === layerId);
  if (!layer) return;

  deleteLayerChain(layerId);
  deleteLayerPlayOrder(layerId);
  disposeStreaming(pad.id, layerId);

  const voices = [...getLayerVoices(layerId)];
  if (voices.length === 0) return;
  rampStopLayerVoices(pad.id, layer, voices);

  // After the ramp completes, check if any layers are still active for this pad
  const stopCleanupId = setTimeout(() => {
    deleteStopCleanupTimeout(stopCleanupId);
    if (!isPadActive(pad.id)) {
      coordinator.padStopped(pad.id);
      cancelFade(pad.id);
    }
  }, STOP_RAMP_S * 1000 + 10);
  addStopCleanupTimeout(stopCleanupId);
}

/** Shared preamble for skip functions: cancel fade, resume context, start a single sound, record pad as playing. */
function startSoundInLayer(pad: Pad, layer: Layer, sound: Sound, resolved: Sound[]): void {
  // The previous voice was stopped externally (no natural onended), so clear stale display.
  coordinator.clearPadMetadata(pad.id);
  cancelFade(pad.id);
  ensureResumed().then((ctx) => {
    const padGain = getPadGain(pad.id);
    const layerGain = getOrCreateLayerGain(layer.id, getLayerNormalizedVolume(layer), padGain);
    startLayerSound(pad, layer, sound, ctx, layerGain, getVoiceVolume(layer, sound), resolved).catch(emitAudioError);
    coordinator.padStarted(pad.id);
  }).catch((err: unknown) => { emitAudioError(err); });
}

/** Skip forward in a sequential/shuffled chain. No-op for simultaneous arrangement or if at end of chain. */
export function skipLayerForward(pad: Pad, layerId: string): void {
  const layer = pad.layers.find((l) => l.id === layerId);
  if (!layer) return;
  if (!isChained(layer.arrangement)) return;

  const { sounds } = useLibraryStore.getState();
  const resolved = resolveSounds(layer, snapshotSounds(sounds));
  if (resolved.length === 0) return;

  if (layer.cycleMode) {
    // Cycle mode uses cycleIndex, not the chain queue.
    // Read playOrder before stop (stop deletes it).
    const playOrder = getLayerPlayOrder(layerId) ?? buildPlayOrder(layer.arrangement, resolved);
    const n = playOrder.length;
    // cycleIndex points to the NEXT sound after the one currently playing.
    const curCycleIdx = getLayerCycleIndex(layerId) ?? 0;
    // "Next" is what cycleIndex currently points to; advance cursor past it.
    const nextIdx = curCycleIdx % n;
    const newCycleIdx = (curCycleIdx + 1) % n;

    stopLayerWithRamp(pad, layerId);

    // Re-persist playOrder so subsequent skip backs can calculate position correctly.
    setLayerPlayOrder(layerId, playOrder);
    setLayerCycleIndex(layerId, newCycleIdx);
    const sound = playOrder[nextIdx];
    startSoundInLayer(pad, layer, sound, resolved);
  } else {
    // Regular chained mode: advance via the chain queue.
    // Read both BEFORE stop (stop deletes them).
    const playOrder = getLayerPlayOrder(layerId);
    const remaining = getLayerChain(layerId);

    stopLayerWithRamp(pad, layerId);

    if (!remaining || remaining.length === 0) return;

    const [next, ...rest] = remaining;

    // Re-persist playOrder so subsequent skip backs can calculate position correctly.
    if (playOrder) setLayerPlayOrder(layerId, playOrder);
    setLayerChain(layerId, rest);
    startSoundInLayer(pad, layer, next, resolved);
  }
}

/** Skip back in a sequential/shuffled chain. No-op for simultaneous arrangement. */
export function skipLayerBack(pad: Pad, layerId: string): void {
  const layer = pad.layers.find((l) => l.id === layerId);
  if (!layer) return;
  if (!isChained(layer.arrangement)) return;

  const { sounds } = useLibraryStore.getState();
  const resolved = resolveSounds(layer, snapshotSounds(sounds));
  if (resolved.length === 0) return;

  if (layer.cycleMode) {
    // Cycle mode uses cycleIndex, not the chain queue.
    // Read playOrder before stop (stop deletes it).
    const playOrder = getLayerPlayOrder(layerId) ?? buildPlayOrder(layer.arrangement, resolved);
    const n = playOrder.length;
    // cycleIndex points to the NEXT sound after the one currently playing.
    // Currently playing is at (cycleIndex - 1 + n) % n.
    // Previous is at (cycleIndex - 2 + n) % n.
    // After skip back, next trigger should replay current → set cycleIndex to (cycleIndex - 1 + n) % n.
    const curCycleIdx = getLayerCycleIndex(layerId) ?? 0;
    const prevIdx = (curCycleIdx - 2 + n) % n;
    const newCycleIdx = (curCycleIdx - 1 + n) % n;

    stopLayerWithRamp(pad, layerId);

    // Re-persist playOrder so subsequent skips can calculate position correctly.
    setLayerPlayOrder(layerId, playOrder);
    setLayerCycleIndex(layerId, newCycleIdx);
    const sound = playOrder[prevIdx];
    startSoundInLayer(pad, layer, sound, resolved);
  } else {
    // Regular chained mode: calculate position from playOrder + remaining chain.
    // Read BEFORE stop (stop deletes both).
    const playOrder = getLayerPlayOrder(layerId);
    const chain = getLayerChain(layerId);

    stopLayerWithRamp(pad, layerId);

    if (!playOrder || playOrder.length === 0) return;

    // currentPos = index of the sound that was playing (or last if chain exhausted)
    const currentPos = Math.max(0, playOrder.length - (chain?.length ?? 0) - 1);
    const prevIndex = Math.max(0, currentPos - 1);

    // Re-persist playOrder so subsequent skips can calculate position correctly.
    setLayerPlayOrder(layerId, playOrder);
    // Rebuild chain from prevIndex+1 onward so the sequence continues naturally.
    setLayerChain(layerId, playOrder.slice(prevIndex + 1));
    const sound = playOrder[prevIndex];
    startSoundInLayer(pad, layer, sound, resolved);
  }
}
