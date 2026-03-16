import { create } from "zustand";

interface PlaybackState {
  masterVolume: number; // 0–100
  setMasterVolume: (volume: number) => void;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
}

export const usePlaybackStore = create<PlaybackState>()((set) => ({
  masterVolume: 100,
  setMasterVolume: (volume) => set({ masterVolume: volume }),
  isPlaying: false,
  setIsPlaying: (playing) => set({ isPlaying: playing }),
}));
