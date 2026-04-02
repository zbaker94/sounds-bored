import { create } from "zustand";
import type { AudioVoice } from "@/lib/audio/audioVoice";

// Module-level voice maps — AudioVoice objects are non-serializable,
// kept outside Zustand state to avoid proxy issues.
const voiceMap = new Map<string, AudioVoice[]>();
const layerVoiceMap = new Map<string, AudioVoice[]>();

interface PlaybackState {
  masterVolume: number; // 0–100
  setMasterVolume: (volume: number) => void;

  // Which pad IDs currently have active voices (for UI feedback)
  playingPadIds: string[];

  // Per-pad runtime volume (0–1), mirrored from padGainMap for React reactivity
  padVolumes: Record<string, number>;
  updatePadVolume: (padId: string, volume: number) => void;

  // ── Pad-level voice tracking ──────────────────────────────────────────────
  isPadActive: (padId: string) => boolean;
  recordVoice: (padId: string, voice: AudioVoice) => void;
  clearVoice: (padId: string, voice: AudioVoice) => void;
  stopPad: (padId: string) => void;
  stopAll: () => void;

  // ── Layer-level voice tracking ────────────────────────────────────────────
  isLayerActive: (layerId: string) => boolean;
  /** Record a voice for both its layer and its pad. */
  recordLayerVoice: (padId: string, layerId: string, voice: AudioVoice) => void;
  /** Clear a voice from both its layer and its pad. */
  clearLayerVoice: (padId: string, layerId: string, voice: AudioVoice) => void;
  /** Stop all voices for a single layer without affecting other layers. */
  stopLayer: (padId: string, layerId: string) => void;
  /** Returns all active voices for a layer (read-only). Used by padPlayer for ramp-stop. */
  getLayerVoices: (layerId: string) => readonly AudioVoice[];
  /** Null all onended callbacks on all active voices. Prevents chain restarts during ramp. */
  nullAllOnEnded: () => void;
}

export const usePlaybackStore = create<PlaybackState>()((set, get) => ({
  masterVolume: 100,
  setMasterVolume: (volume) => set({ masterVolume: volume }),

  playingPadIds: [],
  padVolumes: {},

  updatePadVolume: (padId, volume) =>
    set((s) => ({ padVolumes: { ...s.padVolumes, [padId]: volume } })),

  // ── Pad-level ─────────────────────────────────────────────────────────────

  isPadActive: (padId) => (voiceMap.get(padId)?.length ?? 0) > 0,

  recordVoice: (padId, voice) => {
    voiceMap.set(padId, [...(voiceMap.get(padId) ?? []), voice]);
    set((s) =>
      s.playingPadIds.includes(padId)
        ? s
        : { playingPadIds: [...s.playingPadIds, padId] }
    );
  },

  clearVoice: (padId, voice) => {
    const updated = (voiceMap.get(padId) ?? []).filter((v) => v !== voice);
    if (updated.length === 0) {
      voiceMap.delete(padId);
      set((s) => ({ playingPadIds: s.playingPadIds.filter((id) => id !== padId) }));
    } else {
      voiceMap.set(padId, updated);
    }
  },

  stopPad: (padId) => {
    const voices = voiceMap.get(padId) ?? [];
    const stoppedSet = new Set(voices);
    voiceMap.delete(padId);
    set((s) => ({ playingPadIds: s.playingPadIds.filter((id) => id !== padId) }));
    // Also clean layerVoiceMap — layers whose voices were on this pad would
    // otherwise remain isLayerActive: true after stopPad.
    for (const [layerId, layerVoices] of layerVoiceMap) {
      const remaining = layerVoices.filter((v) => !stoppedSet.has(v));
      if (remaining.length === 0) {
        layerVoiceMap.delete(layerId);
      } else {
        layerVoiceMap.set(layerId, remaining);
      }
    }
    for (const voice of voices) {
      try { voice.stop(); } catch { /* already ended */ }
    }
  },

  stopAll: () => {
    // NOTE: layerChainQueue lives in padPlayer.ts (can't import here — circular dep).
    // Always call padPlayer.stopAllPads() instead of stopAll() directly to ensure
    // chains are cleared before voices are stopped.

    // Collect from voiceMap only — every layer voice is also in voiceMap
    // by the recordLayerVoice → recordVoice invariant, so no voices are missed.
    const allVoices = [...voiceMap.values()].flat();
    voiceMap.clear();
    layerVoiceMap.clear();
    set({ playingPadIds: [] });
    for (const voice of allVoices) {
      try { voice.stop(); } catch { /* already ended */ }
    }
  },

  // ── Layer-level ───────────────────────────────────────────────────────────

  isLayerActive: (layerId) => (layerVoiceMap.get(layerId)?.length ?? 0) > 0,

  recordLayerVoice: (padId, layerId, voice) => {
    layerVoiceMap.set(layerId, [...(layerVoiceMap.get(layerId) ?? []), voice]);
    get().recordVoice(padId, voice);
  },

  clearLayerVoice: (padId, layerId, voice) => {
    const updated = (layerVoiceMap.get(layerId) ?? []).filter((v) => v !== voice);
    if (updated.length === 0) {
      layerVoiceMap.delete(layerId);
    } else {
      layerVoiceMap.set(layerId, updated);
    }
    get().clearVoice(padId, voice);
  },

  stopLayer: (padId, layerId) => {
    const voices = layerVoiceMap.get(layerId) ?? [];
    const stoppedSet = new Set(voices);

    // Clean up maps BEFORE calling stop(), because wrapStreamingElement.stop()
    // fires onended synchronously, which calls clearLayerVoice. Cleaning up first
    // makes that a safe no-op rather than a double-removal.
    layerVoiceMap.delete(layerId);
    const padVoices = (voiceMap.get(padId) ?? []).filter((v) => !stoppedSet.has(v));
    if (padVoices.length === 0) {
      voiceMap.delete(padId);
      set((s) => ({ playingPadIds: s.playingPadIds.filter((id) => id !== padId) }));
    } else {
      voiceMap.set(padId, padVoices);
    }

    for (const voice of voices) {
      try { voice.stop(); } catch { /* already ended */ }
    }
  },

  getLayerVoices: (layerId) => layerVoiceMap.get(layerId) ?? [],

  nullAllOnEnded: () => {
    for (const voices of voiceMap.values()) {
      for (const voice of voices) {
        voice.setOnEnded(null);
      }
    }
  },
}));
