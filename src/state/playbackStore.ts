import { create } from "zustand";

// NOTE: All non-serializable audio engine state (voiceMap, layerVoiceMap, GainNodes,
// streaming audio, chain queues, fade tracking) lives in src/lib/audio/audioState.ts.
// This store contains only reactive Zustand state that drives UI re-renders.

interface PlaybackState {
  masterVolume: number; // 0–100
  setMasterVolume: (volume: number) => void;

  // Which pad IDs currently have active voices (for UI feedback)
  playingPadIds: Set<string>;

  addPlayingPad: (padId: string) => void;
  removePlayingPad: (padId: string) => void;
  clearAllPlayingPads: () => void;

  // Whether a sound preview is currently playing (for Stop All button state)
  isPreviewPlaying: boolean;
  setIsPreviewPlaying: (v: boolean) => void;

  // Per-pad runtime volume (0–1), mirrored from padGainMap for React reactivity
  padVolumes: Record<string, number>;
  updatePadVolume: (padId: string, volume: number) => void;

  // Per-layer runtime volume (0–1), mirrored from layerGainMap for React reactivity
  layerVolumes: Record<string, number>;
  updateLayerVolume: (layerId: string, volume: number) => void;
  removeLayerVolume: (layerId: string) => void;
  removeLayerVolumes: (layerIds: string[]) => void;

  // Which pad IDs currently have an active automated or gesture-driven volume transition (drives the fill bar)
  volumeTransitioningPadIds: Set<string>;
  startVolumeTransition: (padId: string) => void;
  clearVolumeTransition: (padId: string) => void;
  clearAllVolumeTransitions: () => void;
  /** Reset padVolumes to {} so stale values don't persist as the initial height on the next transition. */
  resetAllPadVolumes: () => void;
}

// Factory ensures each spread gets fresh Set/object instances — prevents tests from sharing mutable state.
export const initialPlaybackState = {
  masterVolume: 100,
  get playingPadIds() { return new Set<string>(); },
  get padVolumes() { return {} as Record<string, number>; },
  get layerVolumes() { return {} as Record<string, number>; },
  get volumeTransitioningPadIds() { return new Set<string>(); },
  isPreviewPlaying: false,
};

export const usePlaybackStore = create<PlaybackState>()((set) => ({
  masterVolume: 100,
  setMasterVolume: (volume) => set({ masterVolume: volume }),

  playingPadIds: new Set<string>(),

  addPlayingPad: (padId) =>
    set((s) => {
      if (s.playingPadIds.has(padId)) return s;
      const next = new Set(s.playingPadIds);
      next.add(padId);
      return { playingPadIds: next };
    }),

  removePlayingPad: (padId) =>
    set((s) => {
      if (!s.playingPadIds.has(padId)) return s;
      const next = new Set(s.playingPadIds);
      next.delete(padId);
      return { playingPadIds: next };
    }),

  clearAllPlayingPads: () => set({ playingPadIds: new Set() }),

  isPreviewPlaying: false,
  setIsPreviewPlaying: (v) => set({ isPreviewPlaying: v }),
  padVolumes: {},

  updatePadVolume: (padId, volume) =>
    set((s) => ({ padVolumes: { ...s.padVolumes, [padId]: volume } })),

  layerVolumes: {},

  updateLayerVolume: (layerId, volume) =>
    set((s) => ({ layerVolumes: { ...s.layerVolumes, [layerId]: volume } })),

  removeLayerVolume: (layerId) =>
    set((s) => {
      const next = { ...s.layerVolumes };
      delete next[layerId];
      return { layerVolumes: next };
    }),

  removeLayerVolumes: (layerIds) =>
    set((s) => {
      const next = { ...s.layerVolumes };
      for (const id of layerIds) {
        delete next[id];
      }
      return { layerVolumes: next };
    }),

  volumeTransitioningPadIds: new Set<string>(),
  startVolumeTransition: (padId) =>
    set((s) => {
      if (s.volumeTransitioningPadIds.has(padId)) return s;
      const next = new Set(s.volumeTransitioningPadIds);
      next.add(padId);
      return { volumeTransitioningPadIds: next };
    }),
  clearVolumeTransition: (padId) =>
    set((s) => {
      if (!s.volumeTransitioningPadIds.has(padId)) return s;
      const next = new Set(s.volumeTransitioningPadIds);
      next.delete(padId);
      return { volumeTransitioningPadIds: next };
    }),
  clearAllVolumeTransitions: () => set({ volumeTransitioningPadIds: new Set() }),
  resetAllPadVolumes: () => set({ padVolumes: {} }),
}));
