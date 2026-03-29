import { create } from "zustand";

// Module-level voice map — AudioBufferSourceNodes are non-serializable,
// kept outside Zustand state to avoid proxy issues.
const voiceMap = new Map<string, AudioBufferSourceNode[]>();

interface PlaybackState {
  masterVolume: number; // 0–100
  setMasterVolume: (volume: number) => void;

  // Which pad IDs currently have active voices (for UI feedback)
  playingPadIds: string[];

  // Per-pad runtime volume (0–1), mirrored from padGainMap for React reactivity
  padVolumes: Record<string, number>;
  updatePadVolume: (padId: string, volume: number) => void;

  isPadActive: (padId: string) => boolean;
  recordVoice: (padId: string, source: AudioBufferSourceNode) => void;
  clearVoice: (padId: string, source: AudioBufferSourceNode) => void;
  stopPad: (padId: string) => void;
  stopAll: () => void;
}

export const usePlaybackStore = create<PlaybackState>()((set, get) => ({
  masterVolume: 100,
  setMasterVolume: (volume) => set({ masterVolume: volume }),

  playingPadIds: [],
  padVolumes: {},

  updatePadVolume: (padId, volume) =>
    set((s) => ({ padVolumes: { ...s.padVolumes, [padId]: volume } })),

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
    set({ playingPadIds: [] });
  },
}));
