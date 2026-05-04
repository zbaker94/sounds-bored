// src/lib/audio/layerTrigger.ts
//
// Extracted layer trigger helpers used by padPlayer.ts:
//   - resolveSounds / liveLayerField / getVoiceVolume / shouldLayerLoopNatively — private utilities
//   - rampStopLayerVoices / stopLayerWithRampInternal — ramped layer stop primitives
//   - loadLayerVoice — voice creation (streaming vs buffer), separated from lifecycle
//   - startLayerSound — onended chain-continuation lifecycle (calls loadLayerVoice)
//   - applyRetriggerMode — deduplicates the retrigger switch shared by triggerPad + triggerLayer
//   - startLayerPlayback — deduplicates the start-playback section shared by both
//   - triggerLayerOfPad — core per-layer trigger sequence shared by triggerPad + triggerLayer
//   - syncLayerPlaybackMode / syncLayerArrangement / syncLayerSelection / syncLayerConfig — live sync
//   - selectionsEqual — structural equality for LayerSelection
//   - stopLayerWithRamp — per-layer stop with pad-state cleanup
//   - skipLayerForward / skipLayerBack — chain/cycle navigation

import { ensureResumed, getAudioContext } from "./audioContext";
import { usePlaybackStore } from "@/state/playbackStore";
import { usePadDisplayStore } from "@/state/padDisplayStore";
import { clampGain01 } from "./gainManager";
import { normalizedVoiceGain } from "./gainNormalization";
import { clearPadFadeTracking } from "./fadeMixer";
import { loadBuffer, MissingFileError } from "./bufferCache";
import { checkIsLargeFile, getOrCreateStreamingElement } from "./streamingCache";
import { wrapBufferSource, wrapStreamingElement, STOP_RAMP_S } from "./audioVoice";
import type { AudioVoice } from "./audioVoice";
import { buildPlayOrder, isChained } from "./arrangement";
import { resolveLayerSounds } from "./resolveSounds";
import { useLibraryStore } from "@/state/libraryStore";
import { useProjectStore } from "@/state/projectStore";
import type { Layer, LayerSelection, Pad, Sound } from "@/lib/schemas";
import { emitAudioError } from "./audioEvents";
import { startAudioTick } from "./audioTick";
import {
  addStopCleanupTimeout,
  deleteStopCleanupTimeout,
  clearLayerVoice,
  clearLayerStreamingAudio,
  deleteLayerChain,
  deleteLayerCycleIndex,
  deleteLayerPlayOrder,
  getLayerChain,
  getLayerCycleIndex,
  getLayerGain,
  getLayerPlayOrder,
  getLayerVoices,
  getOrCreateLayerGain,
  getPadGain,
  getPadProgressInfo,
  incrementLayerConsecutiveFailures,
  isLayerActive,
  isPadActive,
  recordLayerVoice,
  registerStreamingAudio,
  resetLayerConsecutiveFailures,
  setLayerChain,
  setLayerCycleIndex,
  setLayerPlayOrder,
  setLayerProgressInfo,
  setPadProgressInfo,
  clearLayerProgressInfo,
  clearLayerPending,
  clearPadProgressInfo,
  setLayerPending,
  stopLayerVoices,
  unregisterStreamingAudio,
} from "./audioState";

/**
 * Maximum consecutive `loadLayerVoice` failures allowed within a single chain
 * before the chain is torn down and a single summary error is emitted. Prevents
 * a 500-sound chain with 500 missing files from producing 500 toasts.
 */
const CHAIN_FAILURE_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// Private utilities
// ---------------------------------------------------------------------------

/** Read a field from the live project store for a layer. Falls back to `captured`
 *  if the pad/layer is not found (e.g. deleted mid-playback or project cleared). */
function liveLayerField<K extends keyof Layer>(
  padId: string,
  layerId: string,
  field: K,
  captured: Layer[K],
): Layer[K] {
  const project = useProjectStore.getState().project;
  if (project) {
    for (const scene of project.scenes) {
      const pad = scene.pads.find((p) => p.id === padId);
      if (pad) return pad.layers.find((l) => l.id === layerId)?.[field] ?? captured;
    }
  }
  return captured;
}

/** Returns the 0–1 gain value for a specific sound within a layer.
 *  For "assigned" selections, reads SoundInstance.volume (0–100 scale).
 *  For "tag"/"set" selections, defaults to 1.0.
 *  Applies loudness normalization (EBU R128 → −14 LUFS target) when available. */
export function getVoiceVolume(layer: Layer, sound: Sound): number {
  const rawGain =
    layer.selection.type === "assigned"
      ? clampGain01((layer.selection.instances.find((i) => i.soundId === sound.id)?.volume ?? 100) / 100)
      : 1.0;
  return normalizedVoiceGain(rawGain, sound.loudnessLufs);
}

/** Convert Layer.volume (schema: 0–100) to a Web Audio gain value (0–1).
 *  Clamps to [0, 1] and returns 0 for non-finite values (silence is safer than full volume
 *  for malformed data — the Zod schema rejects non-finite at parse time, so this path
 *  is a last-resort guard against data bypassing validation). */
export function getLayerNormalizedVolume(layer: Layer): number {
  return clampGain01(layer.volume / 100);
}

/** Resolve a layer's sound selection to playable Sound objects (filePath required). */
export function resolveSounds(layer: Layer, sounds: Sound[]): Sound[] {
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
      usePlaybackStore.getState().removePlayingPad(padId);
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
// Voice creation — streaming vs buffer path
// ---------------------------------------------------------------------------

/**
 * Create and start a voice for one sound on one layer.
 * Routes to the streaming path (HTMLAudioElement) for large files and the
 * buffer path (AudioBufferSourceNode) for small files. Updates progress info
 * as a side effect. Returns the started voice and the HTMLAudioElement (if
 * streaming, for cleanup tracking; null for buffer path).
 *
 * Throws on load failure — caller is responsible for catching.
 */
async function loadLayerVoice(
  sound: Sound,
  layer: Layer,
  ctx: AudioContext,
  layerGain: GainNode,
  voiceVolume: number,
  padId: string,
): Promise<{ voice: AudioVoice; audio: HTMLAudioElement | null }> {
  const isLarge = await checkIsLargeFile(sound);

  if (isLarge) {
    // -- Streaming path (large files) ---
    const { audio: cachedAudio, sourceNode } = getOrCreateStreamingElement(sound, ctx);
    sourceNode.disconnect();
    cachedAudio.currentTime = 0;
    cachedAudio.loop = shouldLayerLoopNatively(layer);
    const voice = wrapStreamingElement(cachedAudio, sourceNode, ctx, layerGain, voiceVolume);
    registerStreamingAudio(padId, layer.id, cachedAudio);
    return { voice, audio: cachedAudio };
  } else {
    // -- Buffer path (short files) ---
    const buffer = await loadBuffer(sound);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    if (shouldLayerLoopNatively(layer)) {
      source.loop = true;
    }
    const voice = wrapBufferSource(source, ctx, layerGain, voiceVolume);

    // Chained: always update progress to track the current sound.
    // Simultaneous: keep the longest-duration voice so the bar fills on the slowest sound.
    const existing = getPadProgressInfo(padId);
    if (isChained(layer.arrangement) || !existing || buffer.duration > existing.duration) {
      setPadProgressInfo(padId, { startedAt: ctx.currentTime, duration: buffer.duration, isLooping: source.loop });
    }
    setLayerProgressInfo(layer.id, { startedAt: ctx.currentTime, duration: buffer.duration, isLooping: source.loop });

    return { voice, audio: null };
  }
}

// ---------------------------------------------------------------------------
// startLayerSound — voice lifecycle + onended chain continuation
// ---------------------------------------------------------------------------

function restartLoopChain(pad: Pad, layer: Layer, ctx: AudioContext, layerGain: GainNode): void {
  const liveArr = liveLayerField(pad.id, layer.id, "arrangement", layer.arrangement);
  const liveMode = liveLayerField(pad.id, layer.id, "playbackMode", layer.playbackMode);
  const liveSelection = liveLayerField(pad.id, layer.id, "selection", layer.selection);
  const liveLayerSnap = { ...layer, arrangement: liveArr, playbackMode: liveMode, selection: liveSelection };
  const liveSounds = resolveSounds(liveLayerSnap, useLibraryStore.getState().sounds);
  clearLayerProgressInfo(layer.id);
  clearPadProgressInfo(pad.id);
  startAudioTick();
  usePadDisplayStore.getState().shiftVoice(pad.id);
  if (isChained(liveArr)) {
    const newOrder = buildPlayOrder(liveArr, liveSounds);
    if (newOrder.length === 0) {
      deleteLayerChain(layer.id);
      if (!isPadActive(pad.id)) usePlaybackStore.getState().removePlayingPad(pad.id);
      return;
    }
    const [first, ...rest] = newOrder;
    setLayerChain(layer.id, rest);
    startLayerSound(pad, layer, first, ctx, layerGain, getVoiceVolume(liveLayerSnap, first), liveSounds).catch(
      (err) => { console.error("[layerTrigger] chain loop-restart failed:", err); },
    );
  } else {
    deleteLayerChain(layer.id);
    if (liveSounds.length === 0) {
      if (!isPadActive(pad.id)) usePlaybackStore.getState().removePlayingPad(pad.id);
      return;
    }
    for (const snd of liveSounds) {
      startLayerSound(pad, liveLayerSnap, snd, ctx, layerGain, getVoiceVolume(liveLayerSnap, snd), liveSounds).catch(
        (err) => { console.error("[layerTrigger] simultaneous loop-restart failed:", err); },
      );
    }
  }
}

/**
 * Load and start a single sound for a layer. Sets up the onended callback that
 * auto-chains to the next sound in layerChainQueue (sequential/shuffled arrangement).
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
    const { voice, audio } = await loadLayerVoice(sound, layer, ctx, layerGain, voiceVolume, pad.id);

    voice.setOnEnded(() => {
      if (audio) unregisterStreamingAudio(pad.id, layer.id, audio);
      clearLayerVoice(pad.id, layer.id, voice);

      // Chain to the next sound if one is queued (sequential/shuffled).
      // `remaining === undefined` means the queue was cleared externally (stop/reset).
      // `remaining.length === 0` means the chain ran to completion naturally.
      const remaining = getLayerChain(layer.id);
      const liveMode = liveLayerField(pad.id, layer.id, "playbackMode", layer.playbackMode);

      if (remaining !== undefined && remaining.length > 0) {
        // Chain continues — defer removePlayingPad until the next voice starts so
        // the pad doesn't briefly flash as "not playing" between chained sounds.
        const [next, ...rest] = remaining;
        setLayerChain(layer.id, rest);
        clearLayerProgressInfo(layer.id);
        clearPadProgressInfo(pad.id);
        startAudioTick();
        usePadDisplayStore.getState().shiftVoice(pad.id);
        startLayerSound(pad, layer, next, ctx, layerGain, getVoiceVolume(layer, next), allSounds).catch(
          (err) => { console.error("[layerTrigger] chain continuation failed:", err); },
        );
      } else if (remaining !== undefined && (liveMode === "loop" || liveMode === "hold")) {
        // Chain exhausted naturally — restart using live store values so mid-playback
        // config changes (arrangement, playback mode, selection) take effect.
        // removePlayingPad is deferred to restartLoopChain (handles failure edges).
        restartLoopChain(pad, layer, ctx, layerGain);
      } else {
        // Chain exhausted (one-shot) or cleared externally (stop/reset).
        if (remaining !== undefined) deleteLayerChain(layer.id);
        if (!isPadActive(pad.id)) usePlaybackStore.getState().removePlayingPad(pad.id);
      }
    });

    await voice.start();
    recordLayerVoice(pad.id, layer.id, voice);
    // Only show metadata overlay if the pad is still active. Guards against the
    // narrow race where stopPad fires between voice.start() resolving and
    // enqueueVoice being called — after the stop cleanup runs, isPadActive
    // returns false and we skip the now-stale overlay enqueue.
    if (isPadActive(pad.id)) {
      usePadDisplayStore.getState().enqueueVoice(pad.id, {
        soundName: sound.name,
        layerName: layer.name,
        playbackMode: layer.playbackMode,
        durationMs: sound.durationMs,
        coverArtDataUrl: sound.coverArtDataUrl,
      });
    }
    usePlaybackStore.getState().addPlayingPad(pad.id);
    // Voice fully started and recorded — clear the consecutive-failure counter so
    // a future failure starts from zero. Placed after recordLayerVoice so we only
    // count it as a real success once the voice is actually tracked in state.
    resetLayerConsecutiveFailures(layer.id);
    startAudioTick();

  } catch (err) {
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
      usePlaybackStore.getState().removePlayingPad(pad.id);
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
function handleStopRetrigger(pad: Pad, layer: Layer, resolved: Sound[], afterStopCleanup?: () => void): RetriggerAction {
  deleteLayerChain(layer.id);
  // rampStopLayerVoices nulls onended before stopping, so the normal cleanup
  // callback won't fire — delete the layer's streaming entry explicitly.
  clearLayerStreamingAudio(pad.id, layer.id);
  stopLayerWithRampInternal(pad, layer);
  afterStopCleanup?.();
  // Cycle mode: advance cursor so next trigger plays the next sound.
  if (layer.cycleMode && isChained(layer.arrangement) && resolved.length > 0) {
    const nextIndex = (getLayerCycleIndex(layer.id) ?? 0) + 1;
    if (nextIndex >= resolved.length) {
      deleteLayerCycleIndex(layer.id);
    } else {
      setLayerCycleIndex(layer.id, nextIndex);
    }
  }
  return "skip";
}

function handleRestartRetrigger(pad: Pad, layer: Layer, resolved: Sound[]): void {
  deleteLayerChain(layer.id);
  stopLayerVoices(pad.id, layer.id);
  // Cycle mode: back cursor up so the same sound replays.
  if (layer.cycleMode && isChained(layer.arrangement) && resolved.length > 0) {
    const cur = getLayerCycleIndex(layer.id) ?? 0;
    setLayerCycleIndex(layer.id, cur === 0 ? resolved.length - 1 : cur - 1);
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
): Promise<RetriggerAction> {
  // Capture queue before clearing it.
  const remaining = [...(getLayerChain(layer.id) ?? [])];
  // Null onended BEFORE stopLayerVoices — stop() fires onended synchronously;
  // nulling first prevents the chain-advance callback from re-firing.
  for (const v of getLayerVoices(layer.id)) v.setOnEnded(null);
  deleteLayerChain(layer.id);
  clearLayerStreamingAudio(pad.id, layer.id);
  stopLayerVoices(pad.id, layer.id);
  clearPadProgressInfo(pad.id);
  clearLayerProgressInfo(layer.id);

  if (layer.cycleMode && isChained(layer.arrangement)) {
    return "proceed";
  }

  if (remaining.length > 0) {
    const [next, ...rest] = remaining;
    setLayerChain(layer.id, rest);
    await startLayerSound(pad, layer, next, ctx, layerGain, getVoiceVolume(layer, next), resolved);
  } else if ((layer.playbackMode === "loop" || layer.playbackMode === "hold") && isChained(layer.arrangement)) {
    await loopBackToBeginning(pad, layer, ctx, layerGain, resolved);
  }
  if (!isPadActive(pad.id)) {
    usePlaybackStore.getState().removePlayingPad(pad.id);
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
): Promise<RetriggerAction> {
  switch (layer.retriggerMode) {
    case "stop":
      if (isLayerPlaying) return handleStopRetrigger(pad, layer, resolved, afterStopCleanup);
      break;
    case "continue":
      if (isLayerPlaying) return "skip";
      break;
    case "restart":
      if (isLayerPlaying) handleRestartRetrigger(pad, layer, resolved);
      break;
    case "next":
      if (isLayerPlaying) return handleNextRetrigger(pad, layer, ctx, layerGain, resolved);
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
): Promise<void> {
  // A fresh user trigger always starts a clean failure sequence — reset the
  // circuit-breaker counter so failures from a previous play don't carry over
  // and prematurely suppress toasts on the new trigger's sounds.
  resetLayerConsecutiveFailures(layer.id);
  clearLayerProgressInfo(layer.id);
  setLayerPending(layer.id);
  try {
    const playOrder = buildPlayOrder(layer.arrangement, resolved);
    setLayerPlayOrder(layer.id, playOrder);

    if (layer.cycleMode && isChained(layer.arrangement)) {
      // Cycle mode: play exactly one sound per trigger, advancing the cursor.
      // No chain queue — onended will not auto-advance.
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
    } else if (isChained(layer.arrangement)) {
      const [first, ...rest] = playOrder;
      setLayerChain(layer.id, rest);
      await startLayerSound(pad, layer, first, ctx, layerGain, getVoiceVolume(layer, first), resolved);
    } else {
      deleteLayerChain(layer.id);
      for (const sound of playOrder) {
        await startLayerSound(pad, layer, sound, ctx, layerGain, getVoiceVolume(layer, sound), resolved);
      }
    }
  } finally {
    clearLayerPending(layer.id);
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

    const action = await applyRetriggerMode(
      pad, layer, isLayerPlaying, ctx, layerGain, resolved, opts?.afterStopCleanup,
    );
    if (action === "skip" || action === "chain-advanced") {
      clearLayerPending(layer.id);
      return;
    }

    if (opts?.clearProgressOnProceed) clearPadProgressInfo(pad.id);
    await startLayerPlayback(pad, layer, ctx, layerGain, resolved);
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
 * take effect at the next natural chain boundary — the onended closure reads
 * playbackMode from the live store rather than the captured layer object.
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
    const allSounds = resolveSounds(layer, useLibraryStore.getState().sounds);
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
    const allSounds = resolveSounds(layer, useLibraryStore.getState().sounds);
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
  clearLayerStreamingAudio(pad.id, layerId);

  const voices = [...getLayerVoices(layerId)];
  if (voices.length === 0) return;
  rampStopLayerVoices(pad.id, layer, voices);

  // After the ramp completes, check if any layers are still active for this pad
  const stopCleanupId = setTimeout(() => {
    deleteStopCleanupTimeout(stopCleanupId);
    if (!isPadActive(pad.id)) {
      usePlaybackStore.getState().removePlayingPad(pad.id);
      clearPadFadeTracking(pad.id);
    }
  }, STOP_RAMP_S * 1000 + 10);
  addStopCleanupTimeout(stopCleanupId);
}

/** Shared preamble for skip functions: cancel fade, resume context, start a single sound, record pad as playing. */
function startSoundInLayer(pad: Pad, layer: Layer, sound: Sound, resolved: Sound[]): void {
  clearPadFadeTracking(pad.id);
  ensureResumed().then((ctx) => {
    const padGain = getPadGain(pad.id);
    const layerGain = getOrCreateLayerGain(layer.id, getLayerNormalizedVolume(layer), padGain);
    startLayerSound(pad, layer, sound, ctx, layerGain, getVoiceVolume(layer, sound), resolved).catch(emitAudioError);
    usePlaybackStore.getState().addPlayingPad(pad.id);
  }).catch((err: unknown) => { emitAudioError(err); });
}

/** Skip forward in a sequential/shuffled chain. No-op for simultaneous arrangement or if at end of chain. */
export function skipLayerForward(pad: Pad, layerId: string): void {
  const layer = pad.layers.find((l) => l.id === layerId);
  if (!layer) return;
  if (!isChained(layer.arrangement)) return;

  const { sounds } = useLibraryStore.getState();
  const resolved = resolveSounds(layer, sounds);
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
  const resolved = resolveSounds(layer, sounds);
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
