import { create } from "zustand";

interface PlaybackState {
  // Runtime-only state — never persisted to disk.
  // Populated in Phase 5: audioBuffers, activeVoices, masterVolume, etc.
}

export const usePlaybackStore = create<PlaybackState>()(() => ({}));
