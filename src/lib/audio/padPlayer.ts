import { ensureResumed, getAudioContext } from "./audioContext";
import { loadBuffer, MissingFileError } from "./bufferCache";
import { checkIsLargeFile } from "./streamingCache";
import { wrapBufferSource, wrapStreamingElement, STOP_RAMP_S } from "./audioVoice";
import type { AudioVoice } from "./audioVoice";
import { buildPlayOrder, isChained } from "./arrangement";
import { filterSoundsByTags } from "./resolveSounds";
import { useLibraryStore } from "@/state/libraryStore";
import { usePlaybackStore } from "@/state/playbackStore";
import { useProjectStore } from "@/state/projectStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { checkMissingStatus } from "@/lib/library.reconcile";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Layer, Pad, Scene, Sound } from "@/lib/schemas";
import { isFadeablePad } from "@/lib/padUtils";
import { toast } from "sonner";

import {
  cancelPadFade,
  startFadeRaf,
  addFadingOutPad,
  removeFadingOutPad,
  setFadePadTimeout,
  deleteFadePadTimeout,
  getPadGain,
  forEachPadGain,
  getOrCreateLayerGain,
  getLayerGain,
  clearLayerStreamingAudio,
  registerStreamingAudio,
  unregisterStreamingAudio,
  clearAllStreamingAudio,
  setPadProgressInfo,
  getPadProgressInfo,
  clearPadProgressInfo,
  clearAllPadProgressInfo,
  isLayerPending,
  setLayerPending,
  clearLayerPending,
  getLayerChain,
  setLayerChain,
  deleteLayerChain,
  getLayerCycleIndex,
  setLayerCycleIndex,
  deleteLayerCycleIndex,
  clearAllFadeTracking,
  clearAllPadGains,
  clearAllLayerGains,
  clearAllLayerChains,
  clearAllLayerCycleIndexes,
  clearAllLayerPending,
  stopPadVoices,
  stopAllVoices,
  nullAllOnEnded,
  getLayerVoices,
  recordLayerVoice,
  clearLayerVoice,
  isLayerActive,
  isPadFadingOut,
  isPadActive,
  stopLayerVoices,
} from "./audioState";

// Re-export public query/clear functions for backward compatibility
export {
  clearAllFadeTracking,
  clearAllPadGains,
  clearAllLayerGains,
  clearAllLayerChains,
  clearAllLayerCycleIndexes,
  isPadFadingOut,
  isPadFading,
  isPadStreaming,
  getPadProgress,
  getPadGain,
  isLayerActive,
  isPadActive,
} from "./audioState";

/** @deprecated Use clearAllFadeTracking instead. */
export const clearFadePadTimeouts = clearAllFadeTracking;

export function freezePadAtCurrentVolume(padId: string): void {
  const ctx = getAudioContext();
  const gain = getPadGain(padId);
  const currentValue = gain.gain.value;
  cancelPadFade(padId);
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(currentValue, ctx.currentTime);
  usePlaybackStore.getState().updatePadVolume(padId, currentValue);
}

export function resolveFadeDuration(pad: Pad, globalFadeDurationMs?: number): number {
  return pad.fadeDurationMs ?? globalFadeDurationMs ?? 2000;
}

export function fadePadOut(pad: Pad, durationMs: number): void {
  // 1. Cancel any prior fade for this pad (RAF, timeout, store signal)
  cancelPadFade(pad.id);

  const ctx = getAudioContext();
  const gain = getPadGain(pad.id);
  const fromVolume = gain.gain.value;

  // 2. Schedule Web Audio ramp
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(fromVolume, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + durationMs / 1000);

  // 3. Mark this pad as fading out so a reverse fade-in can be detected
  addFadingOutPad(pad.id);

  // 4. Show the visual bar
  usePlaybackStore.getState().startVolumeTransition(pad.id);

  // 5. Animate padVolumes via RAF
  startFadeRaf(pad.id, fromVolume, 0, durationMs);

  // 6. Schedule cleanup (stored in fadePadTimeouts so cancelPadFade can cancel it)
  const timeoutId = setTimeout(() => {
    deleteFadePadTimeout(pad.id);
    removeFadingOutPad(pad.id);
    stopPad(pad);
    resetPadGain(pad.id);
  }, durationMs + 5);
  setFadePadTimeout(pad.id, timeoutId);
}

/**
 * Reverse an in-progress fade-out: cancel it and ramp gain back up to 1.0 from current value.
 * Unlike fadePadIn, this does NOT restart the audio — the existing voices keep playing.
 */
export function fadePadInFromCurrent(pad: Pad, durationMs: number): void {
  // 1. Cancel the fade-out (RAF, timeout, store signal, fadingOutPadIds)
  cancelPadFade(pad.id);

  const ctx = getAudioContext();
  const gain = getPadGain(pad.id);
  const fromVolume = gain.gain.value;

  // 2. Schedule Web Audio ramp back to full volume
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(fromVolume, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(1.0, ctx.currentTime + durationMs / 1000);

  // 3. Show the visual bar
  usePlaybackStore.getState().startVolumeTransition(pad.id);

  // 4. Animate padVolumes via RAF
  startFadeRaf(pad.id, fromVolume, 1.0, durationMs);

  // 5. Schedule cleanup
  const timeoutId = setTimeout(() => {
    deleteFadePadTimeout(pad.id);
    cancelPadFade(pad.id);
  }, durationMs + 5);
  setFadePadTimeout(pad.id, timeoutId);
}

export async function fadePadIn(pad: Pad, durationMs: number): Promise<void> {
  // 1. Cancel any prior fade for this pad
  cancelPadFade(pad.id);

  // 2. Start pad at gain 0 (triggerPad also calls updatePadVolume(pad.id, 0))
  await triggerPad(pad, 0);

  const ctx = getAudioContext();
  const gain = getPadGain(pad.id);

  // 3. Schedule Web Audio ramp
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(1.0, ctx.currentTime + durationMs / 1000);

  // 4. Show the visual bar
  usePlaybackStore.getState().startVolumeTransition(pad.id);

  // 5. Animate padVolumes via RAF
  startFadeRaf(pad.id, 0, 1.0, durationMs);

  // 6. Completion cleanup — stored in fadePadTimeouts so cancelPadFade can cancel it
  const timeoutId = setTimeout(() => {
    deleteFadePadTimeout(pad.id);
    cancelPadFade(pad.id); // clears RAF (already done) + clears store signal
  }, durationMs + 5);
  setFadePadTimeout(pad.id, timeoutId);
}

export function crossfadePads(fadingOut: Pad[], fadingIn: Pad[], globalFadeDurationMs?: number): void {
  fadingOut.forEach((pad) => fadePadOut(pad, resolveFadeDuration(pad, globalFadeDurationMs)));
  fadingIn.forEach((pad) =>
    fadePadIn(pad, resolveFadeDuration(pad, globalFadeDurationMs)).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Playback error: audio fade failed — ${message}`);
    })
  );
}

/**
 * Orchestration entry point for a single-pad fade tap (fade mode).
 * Determines whether to reverse a fade-out, start a fade-out, or fade in
 * based on current audio state — keeping that decision in the audio layer
 * rather than in the UI hook.
 */
export function executeFadeTap(pad: Pad, globalFadeDurationMs?: number): void {
  if (!isFadeablePad(pad)) return;
  const duration = resolveFadeDuration(pad, globalFadeDurationMs);
  if (isPadActive(pad.id)) {
    if (isPadFadingOut(pad.id)) {
      fadePadInFromCurrent(pad, duration);
    } else {
      fadePadOut(pad, duration);
    }
  } else {
    fadePadIn(pad, duration).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Playback error: audio fade failed — ${message}`);
    });
  }
}

/**
 * Orchestration entry point for crossfade execution.
 * Splits the selected pads into fading-out (currently playing) and
 * fading-in (not playing) groups using live audio state, then delegates
 * to crossfadePads — keeping playback-state queries in the audio layer.
 */
export function executeCrossfadeSelection(selectedPads: Pad[], globalFadeDurationMs?: number): void {
  const fadeablePads = selectedPads.filter(isFadeablePad);
  const fadingOut = fadeablePads.filter((p) => isPadActive(p.id));
  const fadingIn = fadeablePads.filter((p) => !isPadActive(p.id));
  crossfadePads(fadingOut, fadingIn, globalFadeDurationMs);
}

export function setPadVolume(padId: string, volume: number): void {
  const ctx = getAudioContext();
  const gain = getPadGain(padId);
  const clamped = Math.max(0, Math.min(1, volume));
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(clamped, ctx.currentTime + 0.016);
  usePlaybackStore.getState().updatePadVolume(padId, clamped);
}

export function resetPadGain(padId: string): void {
  // Unified teardown: cancels RAF, pending fade timeout, and clears the store visual signal
  cancelPadFade(padId);
  const gain = getPadGain(padId);
  const ctx = getAudioContext();
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(1.0, ctx.currentTime);
  usePlaybackStore.getState().updatePadVolume(padId, 1.0);
}

/** Update a live layer gain node immediately (e.g. when pad config is saved mid-playback). No-op if the layer isn't active. */
export function syncLayerVolume(layerId: string, volume: number): void {
  const gain = getLayerGain(layerId);
  if (!gain) return;
  const ctx = getAudioContext();
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(volume / 100, ctx.currentTime);
}

/** Read a single field from a layer in the live project store.
 *  Falls back to `captured` if the pad or layer is no longer found (e.g. deleted)
 *  or if no project is currently loaded (e.g. project cleared mid-playback). */
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
  const shouldLoop = isLoopMode && (!isChained(layer.arrangement) || layer.cycleMode);
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
 *   Looping is handled naturally — onended reads livePlaybackMode from the store
 *   when the rebuilt chain exhausts.
 *
 * - Chained -> non-chained (sequential/shuffled -> simultaneous): clears the queue
 *   so onended does not advance the stale chain. The current sound plays to
 *   completion, then stops (or loops, if playbackMode is loop/hold — the loop flag
 *   on active voices is synced here since non-chained looping uses source.loop).
 *
 * No-op if the layer has no active voices.
 */
export function syncLayerArrangement(layer: Layer): void {
  const voices = getLayerVoices(layer.id);
  if (voices.length === 0) return;

  if (isChained(layer.arrangement)) {
    // Switching between chained arrangements: rebuild the queue with the new
    // arrangement. The current sound plays out; onended picks up the new sequence.
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
    // The current sound plays to completion; when it ends, onended checks liveMode and
    // liveArrangement from the store and starts all sounds simultaneously if looping.
    setLayerChain(layer.id, []);
  }
}

/**
 * Called when the sound selection for a layer changes while playback is active.
 *
 * For chained arrangements (sequential/shuffled): rebuilds the chain queue with
 * the new resolved sounds so the current sound plays to completion and the updated
 * selection follows at the next chain step.
 *
 * For non-chained arrangements (simultaneous): no-op here — the onended closure
 * re-resolves sounds from the live store at each loop restart boundary.
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
  // Non-chained (simultaneous) with source.loop=true: voices loop internally
  // at the Web Audio level and onended never fires, so there is no loop boundary
  // at which to re-resolve sounds. Selection changes for simultaneous+loop layers
  // are not applied until the pad is stopped and retriggered — a known limitation
  // of native source.loop behaviour.
}

/**
 * Sync all live-playback state for a layer after a pad config save.
 * Calls syncLayerPlaybackMode, syncLayerArrangement, and/or syncLayerSelection
 * only for the fields that actually changed. When arrangement changes,
 * syncLayerSelection is skipped because syncLayerArrangement already rebuilds
 * the queue using the updated layer (which carries the new selection).
 */
export function syncLayerConfig(layer: Layer, original: Layer): void {
  if (original.playbackMode !== layer.playbackMode) syncLayerPlaybackMode(layer);
  const arrangementChanged = original.arrangement !== layer.arrangement;
  if (arrangementChanged) syncLayerArrangement(layer);
  // syncLayerArrangement already calls resolveSounds with the updated layer (which
  // carries the new selection), so skip syncLayerSelection to avoid a redundant
  // rebuild — especially important for shuffled, where a second call would produce
  // a different random order, discarding the one set by syncLayerArrangement.
  //
  // When arrangement is stable, use JSON.stringify to detect actual selection
  // content changes (reference equality is unreliable since the form always
  // creates new objects). This prevents the queue from being rebuilt — and the
  // currently-playing sound from being replayed — when only playbackMode changes.
  if (!arrangementChanged && JSON.stringify(original.selection) !== JSON.stringify(layer.selection)) {
    syncLayerSelection(layer);
  }
  // When cycleMode is toggled off, clear the stale cursor so the next trigger
  // starts a normal chain instead of using a leftover index.
  if (original.cycleMode && !layer.cycleMode) {
    deleteLayerCycleIndex(layer.id);
  }
}

/** Stop a single pad, clearing its layer chain queues and cycle cursors first so onended doesn't advance the chain. */
export function stopPad(pad: Pad): void {
  for (const layer of pad.layers) {
    deleteLayerChain(layer.id);
    deleteLayerCycleIndex(layer.id);
  }
  stopPadVoices(pad.id);
}

/** Stop all pads in a scene, clearing their chain queues before stopping voices. */
export function stopScene(scene: Scene): void {
  for (const pad of scene.pads) {
    stopPad(pad);
  }
}

/**
 * Stop all active pads with a short gain ramp to avoid clicks.
 *
 * Clears chain queues and fade tracking first, nulls onended callbacks to
 * prevent loop restarts during the ramp window, then ramps all pad gains to
 * zero before stopping voices.
 */
export function stopAllPads(): void {
  clearAllFadeTracking();
  clearAllLayerChains();
  clearAllLayerCycleIndexes();
  clearAllLayerPending();
  // Null all onended callbacks — prevents loop restarts during ramp window
  nullAllOnEnded();

  const ctx = getAudioContext();
  forEachPadGain((_padId, gain) => {
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + STOP_RAMP_S);
  });
  setTimeout(() => {
    clearAllStreamingAudio();
    clearAllPadProgressInfo();
    clearAllLayerGains();
    clearAllPadGains();
    stopAllVoices();
  }, STOP_RAMP_S * 1000 + 5);
}

export function releasePadHoldLayers(pad: Pad): void {
  for (const layer of pad.layers) {
    if (layer.playbackMode !== "hold") continue;

    // Clear chain queue first — prevents onended from restarting the chain
    deleteLayerChain(layer.id);

    const voices = [...getLayerVoices(layer.id)];
    if (voices.length === 0) continue;

    // rampStopLayerVoices nulls onended before stopping, so the cleanup callback
    // won't fire — delete the layer's streaming entry explicitly.
    clearLayerStreamingAudio(pad.id, layer.id);
    rampStopLayerVoices(pad.id, layer, voices);
  }
}

/** Returns the 0-1 gain value for a specific sound within a layer.
 *  For "assigned" selections, reads from SoundInstance.volume (0-100 scale, same as layer.volume).
 *  For "tag"/"set" selections, defaults to 1.0 (no per-sound config yet). */
function getVoiceVolume(layer: Layer, sound: Sound): number {
  if (layer.selection.type === "assigned") {
    const inst = layer.selection.instances.find((i) => i.soundId === sound.id);
    return inst ? inst.volume / 100 : 1.0;
  }
  return 1.0;
}

function resolveSounds(layer: Layer, sounds: Sound[]): Sound[] {
  const soundById = new Map(sounds.map((s) => [s.id, s]));
  const sel = layer.selection;
  switch (sel.type) {
    case "assigned":
      return sel.instances
        .map((inst) => soundById.get(inst.soundId))
        .filter((s): s is Sound => !!s && !!s.filePath);
    case "tag":
      return filterSoundsByTags(sounds, sel.tagIds, sel.matchMode);
    case "set":
      return sounds.filter((s) => s.sets.includes(sel.setId) && !!s.filePath);
  }
}

/**
 * Load and start a single sound for a layer.
 *
 * Routes to the streaming path (HTMLAudioElement) for large files (>= 20 MB
 * compressed) and the buffer path (AudioBufferSourceNode) for small files.
 *
 * Sets up an onended handler that auto-chains to the next sound in
 * layerChainQueue (sequential/shuffled arrangement).
 *
 * Audio graph: sourceNode -> voiceGain -> layerGain -> padGain -> masterGain
 */
async function startLayerSound(
  pad: Pad,
  layer: Layer,
  sound: Sound,
  ctx: AudioContext,
  layerGain: GainNode,
  voiceVolume: number,
  allSounds: Sound[],
): Promise<void> {
  try {
    let voice: AudioVoice;
    let audio: HTMLAudioElement | null = null;

    if (await checkIsLargeFile(sound)) {
      // -- Streaming path (large files) ---
      // HTMLAudioElement streams from disk; browser manages buffering.
      // padProgressInfo not used — duration is available via audio.duration after
      // loadedmetadata fires; getPadProgress reads it directly from the element.
      const url = convertFileSrc(sound.filePath!);
      audio = new Audio();
      audio.crossOrigin = 'anonymous';
      audio.src = url;
      if ((layer.playbackMode === "loop" || layer.playbackMode === "hold") && (!isChained(layer.arrangement) || layer.cycleMode)) {
        audio.loop = true;
      }
      const sourceNode = ctx.createMediaElementSource(audio);
      voice = wrapStreamingElement(audio, sourceNode, ctx, layerGain, voiceVolume);
      registerStreamingAudio(pad.id, layer.id, audio);
    } else {
      // -- Buffer path (short files) ---
      // Fully decoded AudioBuffer: instant retrigger, simultaneous instances.
      const buffer = await loadBuffer(sound);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      if ((layer.playbackMode === "loop" || layer.playbackMode === "hold") && (!isChained(layer.arrangement) || layer.cycleMode)) {
        source.loop = true;
      }
      voice = wrapBufferSource(source, ctx, layerGain, voiceVolume);

      // Chained arrangements play one sound at a time — always update to track the current sound.
      // Simultaneous plays all sounds at once — keep the longest so the bar fills on the slowest sound.
      const existing = getPadProgressInfo(pad.id);
      if (isChained(layer.arrangement) || !existing || buffer.duration > existing.duration) {
        setPadProgressInfo(pad.id, { startedAt: ctx.currentTime, duration: buffer.duration, isLooping: source.loop });
      }
    }

    voice.setOnEnded(() => {
      // endedCb is nulled on first fire — prevents double-call if the source
      // ends naturally while a stopWithRamp timeout is pending.
      if (audio) {
        unregisterStreamingAudio(pad.id, layer.id, audio);
      }
      clearLayerVoice(pad.id, layer.id, voice);
      // Chain to the next sound if one is queued (sequential/shuffled).
      // `remaining === undefined` means the queue was cleared externally (stop/reset).
      // `remaining.length === 0` means the chain ran to completion naturally.
      const remaining = getLayerChain(layer.id);
      const liveMode = liveLayerField(pad.id, layer.id, "playbackMode", layer.playbackMode);
      if (remaining === undefined) {
        // Queue was externally cleared (e.g. stopAll, retrigger restart) — do not chain.
      } else if (remaining.length > 0) {
        const [next, ...rest] = remaining;
        setLayerChain(layer.id, rest);
        startLayerSound(pad, layer, next, ctx, layerGain, getVoiceVolume(layer, next), allSounds);
      } else if (liveMode === "loop" || liveMode === "hold") {
        // Chain exhausted naturally — restart using the current live arrangement,
        // playback mode, and selection. All fields read from the store so mid-playback
        // config changes (arrangement, playback mode, or sound selection) take effect
        // at each loop boundary.
        const liveArr = liveLayerField(pad.id, layer.id, "arrangement", layer.arrangement);
        const liveSelection = liveLayerField(pad.id, layer.id, "selection", layer.selection);
        const liveLayerSnap = { ...layer, arrangement: liveArr, playbackMode: liveMode, selection: liveSelection };
        const liveSounds = resolveSounds(liveLayerSnap, useLibraryStore.getState().sounds);
        if (isChained(liveArr)) {
          const newOrder = buildPlayOrder(liveArr, liveSounds);
          if (newOrder.length === 0) { deleteLayerChain(layer.id); return; }
          const [first, ...rest] = newOrder;
          setLayerChain(layer.id, rest);
          startLayerSound(pad, layer, first, ctx, layerGain, getVoiceVolume(liveLayerSnap, first), liveSounds);
        } else {
          // Non-chained loop: start all sounds simultaneously using the current live
          // selection so mid-playback sound changes take effect at each loop boundary.
          deleteLayerChain(layer.id);
          for (const sound of liveSounds) {
            startLayerSound(pad, liveLayerSnap, sound, ctx, layerGain, getVoiceVolume(liveLayerSnap, sound), liveSounds);
          }
        }
      } else {
        deleteLayerChain(layer.id);
      }
    });

    await voice.start();
    recordLayerVoice(pad.id, layer.id, voice);

  } catch (err) {
    if (err instanceof MissingFileError) {
      const settings = useAppSettingsStore.getState().settings;
      if (settings) {
        const { sounds } = useLibraryStore.getState();
        checkMissingStatus(settings.globalFolders, sounds).then((result) => {
          useLibraryStore.getState().setMissingState(result.missingSoundIds, result.missingFolderIds);
        });
      }
      toast.error(`Failed to play "${sound.name}" — file not found. Check the Sounds panel.`);
    } else {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to play "${sound.name}": ${message}`);
    }
  }
}

function rampStopLayerVoices(
  padId: string,
  layer: Layer,
  voices: readonly AudioVoice[],
): void {
  for (const v of voices) v.setOnEnded(null);
  for (const v of voices) v.stopWithRamp(STOP_RAMP_S);

  const gain = getLayerGain(layer.id);
  const resetValue = layer.volume / 100;
  setTimeout(() => {
    for (const v of voices) clearLayerVoice(padId, layer.id, v);
    if (gain) {
      const ctx = getAudioContext();
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setValueAtTime(resetValue, ctx.currentTime);
    }
  }, STOP_RAMP_S * 1000 + 5);
}

function stopLayerWithRamp(pad: Pad, layer: Layer): void {
  const voices = [...getLayerVoices(layer.id)];
  if (voices.length === 0) return;
  rampStopLayerVoices(pad.id, layer, voices);
}

// startVolume: 0-1. Pass 0 for drag-up gestures (silent start), defaults to 1.
export async function triggerPad(pad: Pad, startVolume = 1.0): Promise<void> {
  const { sounds } = useLibraryStore.getState();

  const ctx = await ensureResumed();
  const padGain = getPadGain(pad.id);
  // padProgressInfo and padStreamingAudio are NOT cleared here — per-layer retrigger
  // mode handling may skip playback entirely (e.g. 'continue'), and clearing eagerly
  // would freeze the progress bar for layers that keep playing.
  // Both are cleared lazily below, once we know a layer will actually start new playback.
  padGain.gain.cancelScheduledValues(ctx.currentTime);
  padGain.gain.setValueAtTime(startVolume, ctx.currentTime);
  usePlaybackStore.getState().updatePadVolume(pad.id, startVolume);

  let progressCleared = false;

  for (const layer of pad.layers) {
    const resolved = resolveSounds(layer, sounds);
    if (resolved.length === 0) continue;

    // Leading debounce — if startLayerSound is in-flight for this layer, ignore the trigger
    if (isLayerPending(layer.id)) continue;

    const isLayerPlaying = isLayerActive(layer.id);
    const layerGain = getOrCreateLayerGain(layer.id, layer.volume, padGain);

    // -- Retrigger handling ---
    switch (layer.retriggerMode) {
      case "stop":
        if (isLayerPlaying) {
          deleteLayerChain(layer.id);
          // rampStopLayerVoices nulls onended before stopping, so the normal cleanup
          // callback won't fire — delete the layer's streaming entry explicitly.
          clearLayerStreamingAudio(pad.id, layer.id);
          stopLayerWithRamp(pad, layer);
          // Cycle mode: advance cursor so next trigger plays the next sound.
          if (layer.cycleMode && isChained(layer.arrangement) && resolved.length > 0) {
            const nextIndex = (getLayerCycleIndex(layer.id) ?? 0) + 1;
            if (nextIndex >= resolved.length) {
              deleteLayerCycleIndex(layer.id);
            } else {
              setLayerCycleIndex(layer.id, nextIndex);
            }
          }
          continue;
        }
        break;

      case "continue":
        if (isLayerPlaying) continue;
        break;

      case "restart":
        if (isLayerPlaying) {
          deleteLayerChain(layer.id);
          stopLayerVoices(pad.id, layer.id);
          // Cycle mode: back the cursor up so the same sound replays.
          // (The cursor was already advanced when the sound started.)
          if (layer.cycleMode && isChained(layer.arrangement) && resolved.length > 0) {
            const cur = getLayerCycleIndex(layer.id) ?? 0;
            setLayerCycleIndex(layer.id, cur === 0 ? resolved.length - 1 : cur - 1);
          }
        }
        break;

      case "next":
        if (isLayerPlaying) {
          // Capture queue before clearing it
          const remaining = [...(getLayerChain(layer.id) ?? [])];
          // setOnEnded(null) must come before stopLayer — stopLayer calls voice.stop() which
          // fires onended synchronously; nulling first prevents the chain-advance callback from re-firing.
          for (const v of getLayerVoices(layer.id)) v.setOnEnded(null);
          deleteLayerChain(layer.id);
          // setOnEnded(null) nulled the cleanup callback — delete streaming entry explicitly.
          clearLayerStreamingAudio(pad.id, layer.id);
          stopLayerVoices(pad.id, layer.id);
          // Clear progress immediately so the bar resets to 0 while the next
          // buffer loads. Without this, stale padProgressInfo keeps advancing
          // during the async gap and the bar shows the old sound's position.
          clearPadProgressInfo(pad.id);

          if (layer.cycleMode && isChained(layer.arrangement)) {
            // Cycle mode + next: stop current sound, advance cycle cursor, play next.
            // Falls through to the start-playback section which reads the cycle cursor.
          } else {
            if (remaining.length > 0) {
              // Advance to next sound in chain
              const [next, ...rest] = remaining;
              setLayerChain(layer.id, rest);
              await startLayerSound(pad, layer, next, ctx, layerGain, getVoiceVolume(layer, next), resolved);
            } else if ((layer.playbackMode === "loop" || layer.playbackMode === "hold") && isChained(layer.arrangement)) {
              // Chain exhausted — loop back to beginning
              const newOrder = buildPlayOrder(layer.arrangement, resolved);
              if (newOrder.length > 0) {
                const [first, ...rest] = newOrder;
                setLayerChain(layer.id, rest);
                await startLayerSound(pad, layer, first, ctx, layerGain, getVoiceVolume(layer, first), resolved);
              }
            }
            // one-shot: queue exhausted -> just stop (already done above)
            continue;
          }
        }
        break;
    }

    // -- Start playback ---
    if (!progressCleared) {
      clearPadProgressInfo(pad.id);
      progressCleared = true;
    }
    setLayerPending(layer.id);
    try {
      const playOrder = buildPlayOrder(layer.arrangement, resolved);

      if (layer.cycleMode && isChained(layer.arrangement)) {
        // Cycle mode: play exactly one sound per trigger, advancing the cursor.
        // No chain queue — onended will not auto-advance to the next sound.
        // Loop/hold modes loop the *same* sound via source.loop (same as simultaneous).
        deleteLayerChain(layer.id);
        const cycleIndex = getLayerCycleIndex(layer.id) ?? 0;
        const sound = playOrder[cycleIndex % playOrder.length];
        // Advance cursor for the next trigger
        const nextIndex = cycleIndex + 1;
        if (nextIndex >= playOrder.length && layer.playbackMode === "one-shot") {
          // One-shot: cursor wraps to 0 for the next full cycle
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
}
