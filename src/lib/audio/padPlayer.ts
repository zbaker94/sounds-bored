import { ensureResumed, getAudioContext, getMasterGain } from "./audioContext";
import { loadBuffer } from "./bufferCache";
import { useLibraryStore } from "@/state/libraryStore";
import { usePlaybackStore } from "@/state/playbackStore";
import type { Layer, Pad, Sound } from "@/lib/schemas";
import { toast } from "sonner";

// Per-pad GainNodes: source(s) → padGain → masterGain → destination
// Kept module-level like voiceMap — GainNodes are non-serializable.
const padGainMap = new Map<string, GainNode>();

// Tracks the longest-duration voice per pad for playback progress display.
const padProgressInfo = new Map<string, { startedAt: number; duration: number }>();

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
  // Ramp over one frame to prevent audio clicks
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

function resolveSounds(layer: Layer, sounds: Sound[]): Sound[] {
  // Build a lookup map once per call — O(sounds) build, O(1) per lookup.
  const soundById = new Map(sounds.map((s) => [s.id, s]));
  const sel = layer.selection;
  switch (sel.type) {
    case "assigned":
      return sel.instances
        .map((inst) => soundById.get(inst.soundId))
        .filter((s): s is Sound => !!s && !!s.filePath);
    case "tag":
      // Union/OR semantics: a sound matches if it has ANY of the selected tagIds.
      return sounds.filter(
        (s) => sel.tagIds.some((tid) => s.tags.includes(tid)) && !!s.filePath
      );
    case "set":
      return sounds.filter((s) => s.sets.includes(sel.setId) && !!s.filePath);
  }
}

// startVolume: 0–1, sets the pad's gain before voices start.
// Pass 0 for drag-up gestures (silent start), defaults to 1.
export async function triggerPad(pad: Pad, startVolume = 1.0): Promise<void> {
  const { sounds } = useLibraryStore.getState();

  // Set pad volume before any voices connect
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
    const isActive = store.isPadActive(pad.id);

    switch (layer.retriggerMode) {
      case "stop":
        if (isActive) {
          store.stopPad(pad.id);
          resetPadGain(pad.id);
          return;
        }
        break;
      case "continue":
        break;
      case "restart":
      case "next": // Step 2: proper "next" with sequential index
        store.stopPad(pad.id);
        break;
    }

    for (const sound of resolved) {
      try {
        const buffer = await loadBuffer(sound);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(padGain);
        source.onended = () => usePlaybackStore.getState().clearVoice(pad.id, source);
        source.start();
        usePlaybackStore.getState().recordVoice(pad.id, source);

        // Track the longest voice for progress display
        const existing = padProgressInfo.get(pad.id);
        if (!existing || buffer.duration > existing.duration) {
          padProgressInfo.set(pad.id, { startedAt: ctx.currentTime, duration: buffer.duration });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[padPlayer] Failed to play "${sound.name}":`, err);
        toast.error(`Failed to play "${sound.name}": ${message}`);
      }
    }
  }
}
