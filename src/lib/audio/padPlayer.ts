import { ensureResumed, getAudioContext, getMasterGain } from "./audioContext";
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
import { toast } from "sonner";

// Per-pad GainNodes: source(s) → voiceGain → layerGain → padGain → masterGain → destination
const padGainMap = new Map<string, GainNode>();

// Keyed by layer ID. One GainNode per active layer, connects to its padGain.
const layerGainMap = new Map<string, GainNode>();

// Tracks the longest-duration voice per pad for playback progress display (buffer path).
const padProgressInfo = new Map<string, { startedAt: number; duration: number; isLooping: boolean }>();

// Tracks all active streaming elements per pad per layer for progress display and cleanup.
// pad ID → layer ID → Set<HTMLAudioElement>. Per-layer keying ensures 'continue'-mode
// retriggers preserve progress tracking for layers that do not restart.
// HTMLAudioElement exposes currentTime/duration after loadedmetadata fires.
const padStreamingAudio = new Map<string, Map<string, Set<HTMLAudioElement>>>();

// Remaining sounds to auto-chain after the current one ends (sequential/shuffled).
// Keyed by layer ID. Deleted when the chain is broken (stop/restart) or exhausted.
const layerChainQueue = new Map<string, Sound[]>();

// Layer IDs currently awaiting startLayerSound — guards against async race on rapid retrigger.
const layerPendingMap = new Set<string>();

// Pending fade cleanup timeouts, keyed by pad ID. Used by both fadePadOut and fadePadIn.
const fadePadTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

// RAF IDs for animated volume lerp loops during fades, keyed by pad ID.
const padFadeRafs = new Map<string, number>();

// Tracks pads that are actively fading out (gain → 0). Cleared when fade completes or is cancelled.
const fadingOutPadIds = new Set<string>();

/**
 * Cancel all fade-related resources for a pad: RAF loop, pending timeout, and store signal.
 * Safe to call even if no fade is registered — all operations are idempotent.
 */
function cancelPadFade(padId: string): void {
  const rafId = padFadeRafs.get(padId);
  if (rafId !== undefined) {
    cancelAnimationFrame(rafId);
    padFadeRafs.delete(padId);
  }
  const tId = fadePadTimeouts.get(padId);
  if (tId !== undefined) {
    clearTimeout(tId);
    fadePadTimeouts.delete(padId);
  }
  fadingOutPadIds.delete(padId);
  usePlaybackStore.getState().clearVolumeTransition(padId);
}

export function isPadFadingOut(padId: string): boolean {
  return fadingOutPadIds.has(padId);
}

export function isPadFading(padId: string): boolean {
  return fadePadTimeouts.has(padId);
}

export function freezePadAtCurrentVolume(padId: string): void {
  const ctx = getAudioContext();
  const gain = padGainMap.get(padId);
  const currentValue = gain ? gain.gain.value : 1.0;
  cancelPadFade(padId);
  if (gain) {
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setValueAtTime(currentValue, ctx.currentTime);
  }
  usePlaybackStore.getState().updatePadVolume(padId, currentValue);
}

/** Animate padVolumes via requestAnimationFrame for the duration of a fade. */
function startFadeRaf(padId: string, fromVolume: number, toVolume: number, durationMs: number): void {
  const startTime = performance.now();

  function frame() {
    const elapsed = performance.now() - startTime;
    const t = Math.min(1, elapsed / durationMs);
    usePlaybackStore.getState().updatePadVolume(padId, fromVolume + (toVolume - fromVolume) * t);
    if (t < 1) {
      padFadeRafs.set(padId, requestAnimationFrame(frame));
    } else {
      padFadeRafs.delete(padId);
    }
  }

  padFadeRafs.set(padId, requestAnimationFrame(frame));
}

export function clearAllFadeTracking(): void {
  for (const id of fadePadTimeouts.values()) clearTimeout(id);
  fadePadTimeouts.clear();
  for (const id of padFadeRafs.values()) cancelAnimationFrame(id);
  padFadeRafs.clear();
  fadingOutPadIds.clear();
  const store = usePlaybackStore.getState();
  store.clearAllVolumeTransitions();
  store.resetAllPadVolumes();
}

/** @deprecated Use clearAllFadeTracking instead. */
export const clearFadePadTimeouts = clearAllFadeTracking;

export function resolveFadeDuration(pad: Pad): number {
  return (
    pad.fadeDurationMs ??
    useAppSettingsStore.getState().settings?.globalFadeDurationMs ??
    2000
  );
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
  fadingOutPadIds.add(pad.id);

  // 4. Show the visual bar
  usePlaybackStore.getState().startVolumeTransition(pad.id);

  // 5. Animate padVolumes via RAF
  startFadeRaf(pad.id, fromVolume, 0, durationMs);

  // 6. Schedule cleanup (stored in fadePadTimeouts so cancelPadFade can cancel it)
  const timeoutId = setTimeout(() => {
    fadePadTimeouts.delete(pad.id);
    fadingOutPadIds.delete(pad.id);
    stopPad(pad);
    resetPadGain(pad.id);
  }, durationMs + 5);
  fadePadTimeouts.set(pad.id, timeoutId);
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
    fadePadTimeouts.delete(pad.id);
    cancelPadFade(pad.id);
  }, durationMs + 5);
  fadePadTimeouts.set(pad.id, timeoutId);
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
    fadePadTimeouts.delete(pad.id);
    cancelPadFade(pad.id); // clears RAF (already done) + clears store signal
  }, durationMs + 5);
  fadePadTimeouts.set(pad.id, timeoutId);
}

export function crossfadePads(fadingOut: Pad[], fadingIn: Pad[]): void {
  fadingOut.forEach((pad) => fadePadOut(pad, resolveFadeDuration(pad)));
  fadingIn.forEach((pad) => fadePadIn(pad, resolveFadeDuration(pad)).catch(console.error));
}

export function getPadProgress(padId: string): number | null {
  const info = padProgressInfo.get(padId);
  if (info) {
    const elapsed = getAudioContext().currentTime - info.startedAt;
    if (info.isLooping && info.duration > 0) {
      return (elapsed % info.duration) / info.duration;
    }
    return Math.min(1, Math.max(0, elapsed / info.duration));
  }
  const layerMap = padStreamingAudio.get(padId);
  if (layerMap && layerMap.size > 0) {
    // Pick the element with the longest duration across all streaming layers,
    // matching how padProgressInfo picks the longest-duration buffer voice.
    // layerMap.size > 0 and empty Sets are never kept, so best is always assigned.
    let best: HTMLAudioElement | null = null;
    for (const audioSet of layerMap.values()) {
      for (const audio of audioSet) {
        if (!best || (isFinite(audio.duration) && audio.duration > (best.duration || 0))) {
          best = audio;
        }
      }
    }
    const d = best!.duration;
    if (d > 0 && isFinite(d)) {
      return Math.min(1, Math.max(0, best!.currentTime / d));
    }
    // duration not yet known (loadedmetadata hasn't fired) — return 0 to show bar started
    return 0;
  }
  return null;
}

/** True while a streaming (large-file) voice is active for this pad. */
export function isPadStreaming(padId: string): boolean {
  const layerMap = padStreamingAudio.get(padId);
  return !!layerMap && layerMap.size > 0;
}

export function getPadGain(padId: string): GainNode {
  const existing = padGainMap.get(padId);
  if (existing) return existing;
  const ctx = getAudioContext();
  const gain = ctx.createGain();
  gain.gain.value = 1.0;
  gain.connect(getMasterGain());
  padGainMap.set(padId, gain);
  return gain;
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
  const gain = padGainMap.get(padId);
  if (gain) {
    const ctx = getAudioContext();
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setValueAtTime(1.0, ctx.currentTime);
  }
  usePlaybackStore.getState().updatePadVolume(padId, 1.0);
}

export function clearAllPadGains(): void {
  padGainMap.clear();
}

export function clearAllLayerGains(): void {
  layerGainMap.clear();
}

/** Update a live layer gain node immediately (e.g. when pad config is saved mid-playback). No-op if the layer isn't active. */
export function syncLayerVolume(layerId: string, volume: number): void {
  const gain = layerGainMap.get(layerId);
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
  const voices = usePlaybackStore.getState().getLayerVoices(layer.id);
  if (voices.length === 0) return;
  const isLoopMode = layer.playbackMode === "loop" || layer.playbackMode === "hold";
  // Update the loop flag on non-chained voices (chained arrangements don't use source.loop).
  const shouldLoop = isLoopMode && !isChained(layer.arrangement);
  for (const voice of voices) {
    voice.setLoop(shouldLoop);
  }
  // For chained arrangements transitioning away from a looping mode, clear the chain
  // queue so the onended callback sees remaining === undefined and skips the restart.
  if (!isLoopMode && isChained(layer.arrangement)) {
    layerChainQueue.delete(layer.id);
  }
}

/**
 * Called when the arrangement type for a layer changes while playback is active.
 *
 * - Chained → chained (sequential ↔ shuffled): rebuilds the chain queue with the
 *   new arrangement so the current sound plays out and the updated sequence follows.
 *   Looping is handled naturally — onended reads livePlaybackMode from the store
 *   when the rebuilt chain exhausts.
 *
 * - Chained → non-chained (sequential/shuffled → simultaneous): clears the queue
 *   so onended does not advance the stale chain. The current sound plays to
 *   completion, then stops (or loops, if playbackMode is loop/hold — the loop flag
 *   on active voices is synced here since non-chained looping uses source.loop).
 *
 * No-op if the layer has no active voices.
 */
export function syncLayerArrangement(layer: Layer): void {
  const voices = usePlaybackStore.getState().getLayerVoices(layer.id);
  if (voices.length === 0) return;

  if (isChained(layer.arrangement)) {
    // Switching between chained arrangements: rebuild the queue with the new
    // arrangement. The current sound plays out; onended picks up the new sequence.
    const allSounds = resolveSounds(layer, useLibraryStore.getState().sounds);
    const newOrder = buildPlayOrder(layer.arrangement, allSounds);
    if (newOrder.length === 0) {
      layerChainQueue.delete(layer.id);
    } else {
      layerChainQueue.set(layer.id, newOrder);
    }
  } else {
    // Switching to non-chained (simultaneous): replace the stale chain with an empty
    // array so onended treats it as natural exhaustion rather than an external stop.
    // The current sound plays to completion; when it ends, onended checks liveMode and
    // liveArrangement from the store and starts all sounds simultaneously if looping.
    layerChainQueue.set(layer.id, []);
  }
}

/**
 * Sync all live-playback state for a layer after a pad config save.
 * Calls syncLayerPlaybackMode and/or syncLayerArrangement only for the fields
 * that actually changed, keeping the audio engine consistent with the updated store.
 */
export function syncLayerConfig(layer: Layer, original: Layer): void {
  if (original.playbackMode !== layer.playbackMode) syncLayerPlaybackMode(layer);
  if (original.arrangement  !== layer.arrangement)  syncLayerArrangement(layer);
}

export function clearAllLayerChains(): void {
  layerChainQueue.clear();
}

/** Remove a single layer's streaming audio entry. Called when retrigger modes null
 *  the onended callback before stopping, preventing the normal cleanup path. */
function clearLayerStreamingAudio(padId: string, layerId: string): void {
  const padLayerMap = padStreamingAudio.get(padId);
  if (!padLayerMap) return;
  padLayerMap.delete(layerId);
  if (padLayerMap.size === 0) padStreamingAudio.delete(padId);
}

/** Stop a single pad, clearing its layer chain queues first so onended doesn't advance the chain. */
export function stopPad(pad: Pad): void {
  for (const layer of pad.layers) {
    layerChainQueue.delete(layer.id);
  }
  usePlaybackStore.getState().stopPad(pad.id);
}

/** Stop all pads in a scene, clearing their chain queues before stopping voices. */
export function stopScene(scene: Scene): void {
  for (const pad of scene.pads) {
    stopPad(pad);
  }
}

/**
 * Stop all active pads with a short gain ramp to avoid clicks.
 * Always call this instead of usePlaybackStore.getState().stopAll() directly,
 * because stopAll() stops voices synchronously (firing onended), which would
 * advance layerChainQueue and re-start queued sounds if the queue is not
 * cleared first.
 */
export function stopAllPads(): void {
  clearAllFadeTracking();
  clearAllLayerChains();
  // Null all onended callbacks — prevents loop restarts during ramp window
  usePlaybackStore.getState().nullAllOnEnded();

  const ctx = getAudioContext();
  for (const gain of padGainMap.values()) {
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + STOP_RAMP_S);
  }
  setTimeout(() => {
    padStreamingAudio.clear();
    padProgressInfo.clear();
    clearAllLayerGains();
    clearAllPadGains();
    usePlaybackStore.getState().stopAll();
  }, STOP_RAMP_S * 1000 + 5);
}

export function releasePadHoldLayers(pad: Pad): void {
  for (const layer of pad.layers) {
    if (layer.playbackMode !== "hold") continue;

    // Clear chain queue first — prevents onended from restarting the chain
    layerChainQueue.delete(layer.id);

    const voices = [...usePlaybackStore.getState().getLayerVoices(layer.id)];
    if (voices.length === 0) continue;

    // rampStopLayerVoices nulls onended before stopping, so the cleanup callback
    // won't fire — delete the layer's streaming entry explicitly.
    clearLayerStreamingAudio(pad.id, layer.id);
    rampStopLayerVoices(pad.id, layer, voices);
  }
}

function getOrCreateLayerGain(layer: Layer, padGain: GainNode): GainNode {
  const existing = layerGainMap.get(layer.id);
  if (existing) {
    // Sync cached gain to the current layer.volume in case it was changed via the config dialog.
    // cancelScheduledValues clears any pending reset from a previous ramp-stop timeout.
    const ctx = getAudioContext();
    existing.gain.cancelScheduledValues(ctx.currentTime);
    existing.gain.setValueAtTime(layer.volume / 100, ctx.currentTime);
    return existing;
  }
  const ctx = getAudioContext();
  const gain = ctx.createGain();
  gain.gain.value = layer.volume / 100;
  gain.connect(padGain);
  layerGainMap.set(layer.id, gain);
  return gain;
}

/** Returns the 0–1 gain value for a specific sound within a layer.
 *  For "assigned" selections, reads from SoundInstance.volume (0–100 scale, same as layer.volume).
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
 * Routes to the streaming path (HTMLAudioElement) for large files (≥ 20 MB
 * compressed) and the buffer path (AudioBufferSourceNode) for small files.
 *
 * Sets up an onended handler that auto-chains to the next sound in
 * layerChainQueue (sequential/shuffled arrangement).
 *
 * Audio graph: sourceNode → voiceGain → layerGain → padGain → masterGain
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
      // ── Streaming path (large files) ───────────────────────────────────────
      // HTMLAudioElement streams from disk; browser manages buffering.
      // padProgressInfo not used — duration is available via audio.duration after
      // loadedmetadata fires; getPadProgress reads it directly from the element.
      const url = convertFileSrc(sound.filePath!);
      audio = new Audio();
      audio.crossOrigin = "anonymous";
      audio.src = url;
      if ((layer.playbackMode === "loop" || layer.playbackMode === "hold") && !isChained(layer.arrangement)) {
        audio.loop = true;
      }
      const sourceNode = ctx.createMediaElementSource(audio);
      voice = wrapStreamingElement(audio, sourceNode, ctx, layerGain, voiceVolume);
      let padLayerMap = padStreamingAudio.get(pad.id);
      if (!padLayerMap) {
        padLayerMap = new Map();
        padStreamingAudio.set(pad.id, padLayerMap);
      }
      const audioSet = padLayerMap.get(layer.id) ?? new Set<HTMLAudioElement>();
      audioSet.add(audio);
      padLayerMap.set(layer.id, audioSet);
    } else {
      // ── Buffer path (short files) ──────────────────────────────────────────
      // Fully decoded AudioBuffer: instant retrigger, simultaneous instances.
      const buffer = await loadBuffer(sound);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      if ((layer.playbackMode === "loop" || layer.playbackMode === "hold") && !isChained(layer.arrangement)) {
        source.loop = true;
      }
      voice = wrapBufferSource(source, ctx, layerGain, voiceVolume);

      // Chained arrangements play one sound at a time — always update to track the current sound.
      // Simultaneous plays all sounds at once — keep the longest so the bar fills on the slowest sound.
      const existing = padProgressInfo.get(pad.id);
      if (isChained(layer.arrangement) || !existing || buffer.duration > existing.duration) {
        padProgressInfo.set(pad.id, { startedAt: ctx.currentTime, duration: buffer.duration, isLooping: source.loop });
      }
    }

    voice.setOnEnded(() => {
      // endedCb is nulled on first fire — prevents double-call if the source
      // ends naturally while a stopWithRamp timeout is pending.
      if (audio) {
        const padLayerMap = padStreamingAudio.get(pad.id);
        if (padLayerMap) {
          const audioSet = padLayerMap.get(layer.id);
          if (audioSet) {
            audioSet.delete(audio);
            if (audioSet.size === 0) padLayerMap.delete(layer.id);
            if (padLayerMap.size === 0) padStreamingAudio.delete(pad.id);
          }
        }
      }
      usePlaybackStore.getState().clearLayerVoice(pad.id, layer.id, voice);
      // Chain to the next sound if one is queued (sequential/shuffled).
      // `remaining === undefined` means the queue was cleared externally (stop/reset).
      // `remaining.length === 0` means the chain ran to completion naturally.
      const remaining = layerChainQueue.get(layer.id);
      const liveMode = liveLayerField(pad.id, layer.id, "playbackMode", layer.playbackMode);
      if (remaining === undefined) {
        // Queue was externally cleared (e.g. stopAll, retrigger restart) — do not chain.
      } else if (remaining.length > 0) {
        const [next, ...rest] = remaining;
        layerChainQueue.set(layer.id, rest);
        startLayerSound(pad, layer, next, ctx, layerGain, getVoiceVolume(layer, next), allSounds);
      } else if (liveMode === "loop" || liveMode === "hold") {
        // Chain exhausted naturally — restart according to the current live arrangement.
        // Both liveMode and liveArr read from the store so mid-playback config changes
        // (e.g. switching arrangement while a chain is playing) take effect here.
        const liveArr = liveLayerField(pad.id, layer.id, "arrangement", layer.arrangement);
        if (isChained(liveArr)) {
          const newOrder = buildPlayOrder(liveArr, allSounds);
          if (newOrder.length === 0) { layerChainQueue.delete(layer.id); return; }
          const [first, ...rest] = newOrder;
          layerChainQueue.set(layer.id, rest);
          startLayerSound(pad, layer, first, ctx, layerGain, getVoiceVolume(layer, first), allSounds);
        } else {
          // Non-chained loop: start all sounds simultaneously. The new voices will
          // have source.loop=true and loop independently until the pad is stopped.
          layerChainQueue.delete(layer.id);
          const liveLayer = { ...layer, arrangement: liveArr, playbackMode: liveMode };
          for (const sound of allSounds) {
            // getVoiceVolume reads layer.selection.instances — unchanged by arrangement/mode edits
            startLayerSound(pad, liveLayer, sound, ctx, layerGain, getVoiceVolume(layer, sound), allSounds);
          }
        }
      } else {
        layerChainQueue.delete(layer.id);
      }
    });

    await voice.start();
    usePlaybackStore.getState().recordLayerVoice(pad.id, layer.id, voice);

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
      console.error(`[padPlayer] Failed to play "${sound.name}":`, err);
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

  const gain = layerGainMap.get(layer.id);
  const resetValue = layer.volume / 100;
  setTimeout(() => {
    const cleanupStore = usePlaybackStore.getState();
    for (const v of voices) cleanupStore.clearLayerVoice(padId, layer.id, v);
    if (gain) {
      const ctx = getAudioContext();
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setValueAtTime(resetValue, ctx.currentTime);
    }
  }, STOP_RAMP_S * 1000 + 5);
}

function stopLayerWithRamp(pad: Pad, layer: Layer): void {
  const voices = [...usePlaybackStore.getState().getLayerVoices(layer.id)];
  if (voices.length === 0) return;
  rampStopLayerVoices(pad.id, layer, voices);
}

// startVolume: 0–1. Pass 0 for drag-up gestures (silent start), defaults to 1.
export async function triggerPad(pad: Pad, startVolume = 1.0): Promise<void> {
  const { sounds } = useLibraryStore.getState();

  const ctx = await ensureResumed();
  const padGain = getPadGain(pad.id);
  padProgressInfo.delete(pad.id);
  // padStreamingAudio is NOT cleared here — per-layer tracking is managed by each retrigger
  // mode so that 'continue'-mode layers preserve their streaming progress across retriggers.
  padGain.gain.cancelScheduledValues(ctx.currentTime);
  padGain.gain.setValueAtTime(startVolume, ctx.currentTime);
  usePlaybackStore.getState().updatePadVolume(pad.id, startVolume);

  for (const layer of pad.layers) {
    const resolved = resolveSounds(layer, sounds);
    if (resolved.length === 0) continue;

    // Leading debounce — if startLayerSound is in-flight for this layer, ignore the trigger
    if (layerPendingMap.has(layer.id)) continue;

    const store = usePlaybackStore.getState();
    const isLayerPlaying = store.isLayerActive(layer.id);
    const layerGain = getOrCreateLayerGain(layer, padGain);

    // ── Retrigger handling ─────────────────────────────────────────────────
    switch (layer.retriggerMode) {
      case "stop":
        if (isLayerPlaying) {
          layerChainQueue.delete(layer.id);
          // rampStopLayerVoices nulls onended before stopping, so the normal cleanup
          // callback won't fire — delete the layer's streaming entry explicitly.
          clearLayerStreamingAudio(pad.id, layer.id);
          stopLayerWithRamp(pad, layer);
          continue;
        }
        break;

      case "continue":
        if (isLayerPlaying) continue;
        break;

      case "restart":
        if (isLayerPlaying) {
          layerChainQueue.delete(layer.id);
          store.stopLayer(pad.id, layer.id);
        }
        break;

      case "next":
        if (isLayerPlaying) {
          // Capture queue before clearing it
          const remaining = [...(layerChainQueue.get(layer.id) ?? [])];
          // setOnEnded(null) must come before stopLayer — stopLayer calls voice.stop() which
          // fires onended synchronously; nulling first prevents the chain-advance callback from re-firing.
          for (const v of store.getLayerVoices(layer.id)) v.setOnEnded(null);
          layerChainQueue.delete(layer.id);
          // setOnEnded(null) nulled the cleanup callback — delete streaming entry explicitly.
          clearLayerStreamingAudio(pad.id, layer.id);
          store.stopLayer(pad.id, layer.id);

          if (remaining.length > 0) {
            // Advance to next sound in chain
            const [next, ...rest] = remaining;
            layerChainQueue.set(layer.id, rest);
            await startLayerSound(pad, layer, next, ctx, layerGain, getVoiceVolume(layer, next), resolved);
          } else if ((layer.playbackMode === "loop" || layer.playbackMode === "hold") && isChained(layer.arrangement)) {
            // Chain exhausted — loop back to beginning
            const newOrder = buildPlayOrder(layer.arrangement, resolved);
            if (newOrder.length > 0) {
              const [first, ...rest] = newOrder;
              layerChainQueue.set(layer.id, rest);
              await startLayerSound(pad, layer, first, ctx, layerGain, getVoiceVolume(layer, first), resolved);
            }
          }
          // one-shot: queue exhausted → just stop (already done above)
          continue;
        }
        break;
    }

    // ── Start playback ─────────────────────────────────────────────────────
    layerPendingMap.add(layer.id);
    try {
      const playOrder = buildPlayOrder(layer.arrangement, resolved);

      if (isChained(layer.arrangement)) {
        const [first, ...rest] = playOrder;
        layerChainQueue.set(layer.id, rest);
        await startLayerSound(pad, layer, first, ctx, layerGain, getVoiceVolume(layer, first), resolved);
      } else {
        layerChainQueue.delete(layer.id);
        for (const sound of playOrder) {
          await startLayerSound(pad, layer, sound, ctx, layerGain, getVoiceVolume(layer, sound), resolved);
        }
      }
    } finally {
      layerPendingMap.delete(layer.id);
    }
  }
}
