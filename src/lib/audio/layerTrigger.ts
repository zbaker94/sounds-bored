// src/lib/audio/layerTrigger.ts
//
// Extracted layer trigger helpers used by padPlayer.ts:
//   - resolveSounds / liveLayerField / getVoiceVolume — private utilities
//   - rampStopLayerVoices / stopLayerWithRampInternal — ramped layer stop primitives
//   - loadLayerVoice — voice creation (streaming vs buffer), separated from lifecycle
//   - startLayerSound — onended chain-continuation lifecycle (calls loadLayerVoice)
//   - applyRetriggerMode — deduplicates the retrigger switch shared by triggerPad + triggerLayer
//   - startLayerPlayback — deduplicates the start-playback section shared by both

import { getAudioContext } from "./audioContext";
import { clampGain01 } from "./gainManager";
import { loadBuffer, MissingFileError } from "./bufferCache";
import { checkIsLargeFile, getOrCreateStreamingElement } from "./streamingCache";
import { wrapBufferSource, wrapStreamingElement, STOP_RAMP_S } from "./audioVoice";
import type { AudioVoice } from "./audioVoice";
import { buildPlayOrder, isChained } from "./arrangement";
import { resolveLayerSounds } from "./resolveSounds";
import { useLibraryStore } from "@/state/libraryStore";
import { useProjectStore } from "@/state/projectStore";
import type { Layer, Pad, Sound } from "@/lib/schemas";
import { emitAudioError } from "./audioEvents";
import { startAudioTick } from "./audioTick";
import {
  addStopCleanupTimeout,
  deleteStopCleanupTimeout,
  clearLayerVoice,
  clearLayerStreamingAudio,
  deleteLayerChain,
  deleteLayerCycleIndex,
  getLayerChain,
  getLayerCycleIndex,
  getLayerGain,
  getLayerVoices,
  getPadProgressInfo,
  incrementLayerConsecutiveFailures,
  recordLayerVoice,
  registerStreamingAudio,
  resetLayerConsecutiveFailures,
  setLayerChain,
  setLayerCycleIndex,
  setLayerPlayOrder,
  setLayerProgressInfo,
  setPadProgressInfo,
  clearLayerProgressInfo,
  clearPadProgressInfo,
  setLayerPending,
  clearLayerPending,
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
export function liveLayerField<K extends keyof Layer>(
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
 *  For "tag"/"set" selections, defaults to 1.0. */
export function getVoiceVolume(layer: Layer, sound: Sound): number {
  if (layer.selection.type === "assigned") {
    const inst = layer.selection.instances.find((i) => i.soundId === sound.id);
    if (!inst) return 1.0;
    return clampGain01(inst.volume / 100);
  }
  return 1.0;
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
    if (gain) {
      const ctx = getAudioContext();
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setValueAtTime(resetValue, ctx.currentTime);
    }
  }, STOP_RAMP_S * 1000 + 5);
  addStopCleanupTimeout(timeoutId);
}

/** Stop all active voices for a layer with a short gain ramp. No-op if no voices. */
export function stopLayerWithRampInternal(pad: Pad, layer: Layer): void {
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
export async function loadLayerVoice(
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
    cachedAudio.loop =
      (layer.playbackMode === "loop" || layer.playbackMode === "hold") &&
      (!isChained(layer.arrangement) || layer.cycleMode);
    const voice = wrapStreamingElement(cachedAudio, sourceNode, ctx, layerGain, voiceVolume);
    registerStreamingAudio(padId, layer.id, cachedAudio);
    return { voice, audio: cachedAudio };
  } else {
    // -- Buffer path (short files) ---
    const buffer = await loadBuffer(sound);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    if (
      (layer.playbackMode === "loop" || layer.playbackMode === "hold") &&
      (!isChained(layer.arrangement) || layer.cycleMode)
    ) {
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
      // endedCb is nulled on first fire — prevents double-call if the source
      // ends naturally while a stopWithRamp timeout is pending.
      if (audio) unregisterStreamingAudio(pad.id, layer.id, audio);
      clearLayerVoice(pad.id, layer.id, voice);

      // Chain to the next sound if one is queued (sequential/shuffled).
      // `remaining === undefined` means the queue was cleared externally (stop/reset).
      // `remaining.length === 0` means the chain ran to completion naturally.
      const remaining = getLayerChain(layer.id);
      const liveMode = liveLayerField(pad.id, layer.id, "playbackMode", layer.playbackMode);

      if (remaining === undefined) {
        // Queue cleared externally — do not chain.
      } else if (remaining.length > 0) {
        const [next, ...rest] = remaining;
        setLayerChain(layer.id, rest);
        // Clear stale progress so the bar resets during the async buffer load.
        clearLayerProgressInfo(layer.id);
        clearPadProgressInfo(pad.id);
        startAudioTick(); // keep tick alive during the async gap
        startLayerSound(pad, layer, next, ctx, layerGain, getVoiceVolume(layer, next), allSounds).catch(
          // startLayerSound handles errors internally (emitAudioError + progress clear);
          // the catch here prevents unhandled-rejection if it throws synchronously.
          // Log to console so failures in the chain path are diagnosable instead of silent.
          (err) => { console.error("[layerTrigger] chain continuation failed:", err); },
        );
      } else if (liveMode === "loop" || liveMode === "hold") {
        // Chain exhausted naturally — restart using live store values so mid-playback
        // config changes (arrangement, playback mode, selection) take effect.
        const liveArr = liveLayerField(pad.id, layer.id, "arrangement", layer.arrangement);
        const liveSelection = liveLayerField(pad.id, layer.id, "selection", layer.selection);
        const liveLayerSnap = { ...layer, arrangement: liveArr, playbackMode: liveMode, selection: liveSelection };
        const liveSounds = resolveSounds(liveLayerSnap, useLibraryStore.getState().sounds);
        clearLayerProgressInfo(layer.id);
        clearPadProgressInfo(pad.id);
        startAudioTick(); // keep tick alive during the async gap
        if (isChained(liveArr)) {
          const newOrder = buildPlayOrder(liveArr, liveSounds);
          if (newOrder.length === 0) { deleteLayerChain(layer.id); return; }
          const [first, ...rest] = newOrder;
          setLayerChain(layer.id, rest);
          startLayerSound(pad, layer, first, ctx, layerGain, getVoiceVolume(liveLayerSnap, first), liveSounds).catch(
            (err) => { console.error("[layerTrigger] chain loop-restart failed:", err); },
          );
        } else {
          deleteLayerChain(layer.id);
          for (const snd of liveSounds) {
            startLayerSound(pad, liveLayerSnap, snd, ctx, layerGain, getVoiceVolume(liveLayerSnap, snd), liveSounds).catch(
              (err) => { console.error("[layerTrigger] simultaneous loop-restart failed:", err); },
            );
          }
        }
      } else {
        deleteLayerChain(layer.id);
      }
    });

    await voice.start();
    recordLayerVoice(pad.id, layer.id, voice);
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
 * - "chain-advanced" — "next" mode already started the chain's next sound; caller should
 *                      record addPlayingPad if needed (triggerLayer) and then return/continue
 */
export type RetriggerAction = "skip" | "proceed" | "chain-advanced";

/**
 * Apply the layer's retrigger mode when the layer is already active (or not).
 *
 * @param afterStopCleanup - Optional callback fired after a "stop"-mode ramp-stop.
 *   `triggerLayer` uses this to schedule a deferred `removePlayingPad` check;
 *   `triggerPad` omits it (the pad-level store state is managed globally).
 */
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
      if (isLayerPlaying) {
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
      break;

    case "continue":
      if (isLayerPlaying) return "skip";
      break;

    case "restart":
      if (isLayerPlaying) {
        deleteLayerChain(layer.id);
        stopLayerVoices(pad.id, layer.id);
        // Cycle mode: back cursor up so the same sound replays.
        if (layer.cycleMode && isChained(layer.arrangement) && resolved.length > 0) {
          const cur = getLayerCycleIndex(layer.id) ?? 0;
          setLayerCycleIndex(layer.id, cur === 0 ? resolved.length - 1 : cur - 1);
        }
      }
      break;

    case "next":
      if (isLayerPlaying) {
        // Capture queue before clearing it.
        const remaining = [...(getLayerChain(layer.id) ?? [])];
        // Null onended BEFORE stopLayerVoices — stop() fires onended synchronously;
        // nulling first prevents the chain-advance callback from re-firing.
        for (const v of getLayerVoices(layer.id)) v.setOnEnded(null);
        deleteLayerChain(layer.id);
        clearLayerStreamingAudio(pad.id, layer.id);
        stopLayerVoices(pad.id, layer.id);
        // Clear progress immediately so the bar resets to 0 while the next buffer loads.
        clearPadProgressInfo(pad.id);
        clearLayerProgressInfo(layer.id);

        if (layer.cycleMode && isChained(layer.arrangement)) {
          // Cycle mode + next: fall through to start-playback (reads updated cycle cursor).
          return "proceed";
        }

        if (remaining.length > 0) {
          const [next, ...rest] = remaining;
          setLayerChain(layer.id, rest);
          await startLayerSound(pad, layer, next, ctx, layerGain, getVoiceVolume(layer, next), resolved);
        } else if ((layer.playbackMode === "loop" || layer.playbackMode === "hold") && isChained(layer.arrangement)) {
          // Chain exhausted — loop back to beginning.
          const newOrder = buildPlayOrder(layer.arrangement, resolved);
          if (newOrder.length > 0) {
            const [first, ...rest] = newOrder;
            setLayerChain(layer.id, rest);
            await startLayerSound(pad, layer, first, ctx, layerGain, getVoiceVolume(layer, first), resolved);
          }
        }
        // one-shot: queue exhausted — just stopped (already done above).
        return "chain-advanced";
      }
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

