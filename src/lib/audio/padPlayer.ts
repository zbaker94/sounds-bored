import { ensureResumed, getAudioContext, getMasterGain } from "./audioContext";
import { loadBuffer, MissingFileError } from "./bufferCache";
import { checkIsLargeFile } from "./streamingCache";
import { wrapBufferSource, wrapStreamingElement } from "./audioVoice";
import type { AudioVoice } from "./audioVoice";
import { buildPlayOrder, isChained } from "./arrangement";
import { useLibraryStore } from "@/state/libraryStore";
import { usePlaybackStore } from "@/state/playbackStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { checkMissingStatus } from "@/lib/library.reconcile";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Layer, Pad, Sound } from "@/lib/schemas";
import { toast } from "sonner";

// Per-pad GainNodes: source(s) → padGain → masterGain → destination
const padGainMap = new Map<string, GainNode>();

// Tracks the longest-duration voice per pad for playback progress display (buffer path).
const padProgressInfo = new Map<string, { startedAt: number; duration: number }>();

// Tracks the most-recently-started streaming element per pad for progress display.
// HTMLAudioElement exposes currentTime/duration after loadedmetadata fires.
const padStreamingAudio = new Map<string, HTMLAudioElement>();

// Remaining sounds to auto-chain after the current one ends (sequential/shuffled).
// Keyed by layer ID. Deleted when the chain is broken (stop/restart) or exhausted.
const layerChainQueue = new Map<string, Sound[]>();

export function getPadProgress(padId: string): number | null {
  const info = padProgressInfo.get(padId);
  if (info) {
    const elapsed = getAudioContext().currentTime - info.startedAt;
    return Math.min(1, Math.max(0, elapsed / info.duration));
  }
  const audio = padStreamingAudio.get(padId);
  if (audio) {
    const d = audio.duration;
    if (d > 0 && isFinite(d)) {
      return Math.min(1, Math.max(0, audio.currentTime / d));
    }
    // duration not yet known (loadedmetadata hasn't fired) — return 0 to show bar started
    return 0;
  }
  return null;
}

/** True while a streaming (large-file) voice is active for this pad. */
export function isPadStreaming(padId: string): boolean {
  return padStreamingAudio.has(padId);
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

export function clearAllLayerChains(): void {
  layerChainQueue.clear();
}

/**
 * Stop all active pads and clear layer chains.
 * Always call this instead of usePlaybackStore.getState().stopAll() directly,
 * because stopAll() stops voices synchronously (firing onended), which would
 * advance layerChainQueue and re-start queued sounds if the queue is not
 * cleared first.
 */
export function stopAllPads(): void {
  clearAllLayerChains();
  clearAllPadGains();
  padStreamingAudio.clear();
  padProgressInfo.clear();
  usePlaybackStore.getState().stopAll();
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
      return sounds.filter(
        (s) => sel.tagIds.some((tid) => s.tags.includes(tid)) && !!s.filePath
      );
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
 */
async function startLayerSound(
  pad: Pad,
  layer: Layer,
  sound: Sound,
  ctx: AudioContext,
  padGain: GainNode,
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
      const sourceNode = ctx.createMediaElementSource(audio);
      sourceNode.connect(padGain);
      voice = wrapStreamingElement(audio);
      padStreamingAudio.set(pad.id, audio);
    } else {
      // ── Buffer path (short files) ──────────────────────────────────────────
      // Fully decoded AudioBuffer: instant retrigger, simultaneous instances.
      const buffer = await loadBuffer(sound);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(padGain);
      voice = wrapBufferSource(source);

      const existing = padProgressInfo.get(pad.id);
      if (!existing || buffer.duration > existing.duration) {
        padProgressInfo.set(pad.id, { startedAt: ctx.currentTime, duration: buffer.duration });
      }
    }

    voice.setOnEnded(() => {
      if (audio && padStreamingAudio.get(pad.id) === audio) padStreamingAudio.delete(pad.id);
      usePlaybackStore.getState().clearLayerVoice(pad.id, layer.id, voice);
      // Chain to the next sound if one is queued (sequential/shuffled)
      const remaining = layerChainQueue.get(layer.id);
      if (remaining && remaining.length > 0) {
        const [next, ...rest] = remaining;
        layerChainQueue.set(layer.id, rest);
        startLayerSound(pad, layer, next, ctx, padGain);
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

// startVolume: 0–1. Pass 0 for drag-up gestures (silent start), defaults to 1.
export async function triggerPad(pad: Pad, startVolume = 1.0): Promise<void> {
  const { sounds } = useLibraryStore.getState();

  const ctx = await ensureResumed();
  const padGain = getPadGain(pad.id);
  padProgressInfo.delete(pad.id);
  padStreamingAudio.delete(pad.id);
  padGain.gain.cancelScheduledValues(ctx.currentTime);
  padGain.gain.setValueAtTime(startVolume, ctx.currentTime);
  usePlaybackStore.getState().updatePadVolume(pad.id, startVolume);

  for (const layer of pad.layers) {
    const resolved = resolveSounds(layer, sounds);
    if (resolved.length === 0) continue;

    const store = usePlaybackStore.getState();
    const isLayerPlaying = store.isLayerActive(layer.id);

    // ── Retrigger handling ─────────────────────────────────────────────────
    switch (layer.retriggerMode) {
      case "stop":
        if (isLayerPlaying) {
          layerChainQueue.delete(layer.id);
          store.stopLayer(pad.id, layer.id);
          resetPadGain(pad.id);
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
          // Don't delete queue — stopping fires onended synchronously (both buffer
          // and streaming wrappers fire synchronously in stop()), which advances
          // the chain to the next sound.
          store.stopLayer(pad.id, layer.id);
          continue;
        }
        break;
    }

    // ── Start playback ─────────────────────────────────────────────────────
    const playOrder = buildPlayOrder(layer.arrangement, resolved);

    if (isChained(layer.arrangement)) {
      const [first, ...rest] = playOrder;
      layerChainQueue.set(layer.id, rest);
      await startLayerSound(pad, layer, first, ctx, padGain);
    } else {
      layerChainQueue.delete(layer.id);
      for (const sound of playOrder) {
        await startLayerSound(pad, layer, sound, ctx, padGain);
      }
    }
  }
}
