import { create } from "zustand";

// Module-level voice maps — AudioBufferSourceNodes are non-serializable,
// kept outside Zustand state to avoid proxy issues.
const voiceMap = new Map<string, AudioBufferSourceNode[]>();
const layerVoiceMap = new Map<string, AudioBufferSourceNode[]>();

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
  recordVoice: (padId: string, source: AudioBufferSourceNode) => void;
  clearVoice: (padId: string, source: AudioBufferSourceNode) => void;
  stopPad: (padId: string) => void;
  stopAll: () => void;

  // ── Layer-level voice tracking ────────────────────────────────────────────
  isLayerActive: (layerId: string) => boolean;
  /** Record a voice for both its layer and its pad. */
  recordLayerVoice: (padId: string, layerId: string, source: AudioBufferSourceNode) => void;
  /** Clear a voice from both its layer and its pad. */
  clearLayerVoice: (padId: string, layerId: string, source: AudioBufferSourceNode) => void;
  /** Stop all voices for a single layer without affecting other layers. */
  stopLayer: (padId: string, layerId: string) => void;
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

  recordVoice: (padId, source) => {
    voiceMap.set(padId, [...(voiceMap.get(padId) ?? []), source]);
    set((s) =>
      s.playingPadIds.includes(padId)
        ? s
        : { playingPadIds: [...s.playingPadIds, padId] }
    );
  },

  clearVoice: (padId, source) => {
    const updated = (voiceMap.get(padId) ?? []).filter((v) => v !== source);
    if (updated.length === 0) {
      voiceMap.delete(padId);
      set((s) => ({ playingPadIds: s.playingPadIds.filter((id) => id !== padId) }));
    } else {
      voiceMap.set(padId, updated);
    }
  },

  stopPad: (padId) => {
    for (const source of voiceMap.get(padId) ?? []) {
      try { source.stop(); } catch { /* already ended */ }
    }
    voiceMap.delete(padId);
    set((s) => ({ playingPadIds: s.playingPadIds.filter((id) => id !== padId) }));
  },

  stopAll: () => {
    for (const voices of voiceMap.values()) {
      for (const source of voices) {
        try { source.stop(); } catch { /* already ended */ }
      }
    }
    voiceMap.clear();
    layerVoiceMap.clear();
    set({ playingPadIds: [] });
  },

  // ── Layer-level ───────────────────────────────────────────────────────────

  isLayerActive: (layerId) => (layerVoiceMap.get(layerId)?.length ?? 0) > 0,

  recordLayerVoice: (padId, layerId, source) => {
    layerVoiceMap.set(layerId, [...(layerVoiceMap.get(layerId) ?? []), source]);
    get().recordVoice(padId, source);
  },

  clearLayerVoice: (padId, layerId, source) => {
    const updated = (layerVoiceMap.get(layerId) ?? []).filter((v) => v !== source);
    if (updated.length === 0) {
      layerVoiceMap.delete(layerId);
    } else {
      layerVoiceMap.set(layerId, updated);
    }
    get().clearVoice(padId, source);
  },

  stopLayer: (padId, layerId) => {
    for (const source of layerVoiceMap.get(layerId) ?? []) {
      try { source.stop(); } catch { /* already ended */ }
    }
    const stoppedSources = new Set(layerVoiceMap.get(layerId) ?? []);
    layerVoiceMap.delete(layerId);

    // Remove stopped voices from the pad-level map
    const padVoices = (voiceMap.get(padId) ?? []).filter((v) => !stoppedSources.has(v));
    if (padVoices.length === 0) {
      voiceMap.delete(padId);
      set((s) => ({ playingPadIds: s.playingPadIds.filter((id) => id !== padId) }));
    } else {
      voiceMap.set(padId, padVoices);
    }
  },
}));
