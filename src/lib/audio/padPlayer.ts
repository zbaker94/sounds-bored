import { ensureResumed, getAudioContext, getMasterGain } from "./audioContext";
import { loadBuffer, MissingFileError } from "./bufferCache";
import { buildPlayOrder, isChained } from "./arrangement";
import { useLibraryStore } from "@/state/libraryStore";
import { usePlaybackStore } from "@/state/playbackStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { checkMissingStatus } from "@/lib/library.reconcile";
import type { Layer, Pad, Sound } from "@/lib/schemas";
import { toast } from "sonner";

// Per-pad GainNodes: source(s) → padGain → masterGain → destination
const padGainMap = new Map<string, GainNode>();

// Tracks the longest-duration voice per pad for playback progress display.
const padProgressInfo = new Map<string, { startedAt: number; duration: number }>();

// Remaining sounds to auto-chain after the current one ends (sequential/shuffled).
// Keyed by layer ID. Deleted when the chain is broken (stop/restart) or exhausted.
const layerChainQueue = new Map<string, Sound[]>();

export function getPadProgress(padId: string): number | null {
  const info = padProgressInfo.get(padId);
  if (!info) return null;
  const elapsed = getAudioContext().currentTime - info.startedAt;
  return Math.min(1, Math.max(0, elapsed / info.duration));
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
 * Load and start a single sound for a layer. Sets up an onended handler that
 * auto-chains to the next sound in layerChainQueue (for sequential/shuffled).
 */
async function startLayerSound(
  pad: Pad,
  layer: Layer,
  sound: Sound,
  ctx: AudioContext,
  padGain: GainNode,
): Promise<void> {
  try {
    const buffer = await loadBuffer(sound);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(padGain);

    source.onended = () => {
      usePlaybackStore.getState().clearLayerVoice(pad.id, layer.id, source);
      // Chain to the next sound if one is queued (sequential/shuffled)
      const remaining = layerChainQueue.get(layer.id);
      if (remaining && remaining.length > 0) {
        const [next, ...rest] = remaining;
        layerChainQueue.set(layer.id, rest);
        startLayerSound(pad, layer, next, ctx, padGain);
      } else {
        layerChainQueue.delete(layer.id);
      }
    };

    source.start();
    usePlaybackStore.getState().recordLayerVoice(pad.id, layer.id, source);

    const existing = padProgressInfo.get(pad.id);
    if (!existing || buffer.duration > existing.duration) {
      padProgressInfo.set(pad.id, { startedAt: ctx.currentTime, duration: buffer.duration });
    }
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
          layerChainQueue.delete(layer.id); // break the chain before stopping
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
          layerChainQueue.delete(layer.id); // break old chain before stopping
          store.stopLayer(pad.id, layer.id);
          // fall through to start a new chain from the beginning
        }
        break;

      case "next":
        if (isLayerPlaying) {
          // Don't delete the queue — stopping the current source fires onended,
          // which picks up the remaining queue and chains to the next sound.
          store.stopLayer(pad.id, layer.id);
          continue; // chain advances via onended; don't start new playback here
        }
        break;
    }

    // ── Start playback ─────────────────────────────────────────────────────
    const playOrder = buildPlayOrder(layer.arrangement, resolved);

    if (isChained(layer.arrangement)) {
      // Sequential / shuffled: play first sound, queue the rest for auto-chaining.
      const [first, ...rest] = playOrder;
      layerChainQueue.set(layer.id, rest);
      await startLayerSound(pad, layer, first, ctx, padGain);
    } else {
      // Simultaneous: clear any stale chain, play all sounds at once.
      layerChainQueue.delete(layer.id);
      for (const sound of playOrder) {
        await startLayerSound(pad, layer, sound, ctx, padGain);
      }
    }
  }
}
