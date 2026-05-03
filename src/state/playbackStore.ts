import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

// NOTE: All non-serializable audio engine state (voiceMap, layerVoiceMap, GainNodes,
// streaming audio, chain queues, fade tracking) lives in src/lib/audio/audioState.ts.
// This store contains only reactive Zustand state that drives UI re-renders.
//
// Tick-managed metrics (padVolumes, padProgress, layerVolumes, layerProgress,
// activeLayerIds, layerPlayOrder, layerChain) have been split out into two
// isolated stores so that pad-scoped and layer-scoped subscribers do not wake
// each other unnecessarily:
//   - src/state/padMetricsStore.ts   — padVolumes, padProgress
//   - src/state/layerMetricsStore.ts — layerVolumes, layerProgress, activeLayerIds,
//                                       layerPlayOrder, layerChain
// Both metric stores are written exclusively by audioTick.ts.
//
// This store now contains two ownership categories:
//   EventDrivenFields    — written imperatively from padPlayer, layerTrigger, etc.
//   PreviewManagedFields — written by preview.ts's own RAF loop and event handlers.
// masterVolume is intentionally ungrouped — app-level UI configuration, not audio event state.

// Event-driven fields — written imperatively from padPlayer, layerTrigger, etc.
// These are discrete state transitions, not derived from any RAF loop.
interface EventDrivenFields {
  /** Pad IDs with active voices. Toggled by padPlayer on trigger/stop. */
  playingPadIds: Set<string>;

  // Set when a fade-out ramp starts; cleared on completion or cancel.
  fadingOutPadIds: Set<string>;

  // Set when fadePad/triggerAndFade starts any ramp (up or down); cleared on completion or cancel.
  fadingPadIds: Set<string>;

  // Set after reverseFade calls fadePad; cleared at the start of any new fadePad call.
  reversingPadIds: Set<string>;
}

// Preview-managed fields — written by preview.ts's own RAF loop and event handlers.
// Independent of audioTick; preview.ts is not part of the padPlayer system.
interface PreviewManagedFields {
  /** Whether a sound preview is currently playing (for Stop All button state). */
  isPreviewPlaying: boolean;

  /** Playback progress of the currently previewing sound (0–1). null = not previewing. */
  previewProgress: number | null;
}

interface PlaybackState extends EventDrivenFields, PreviewManagedFields {
  // masterVolume is app-level UI configuration — intentionally not grouped with audio event state.
  masterVolume: number; // 0–100
  setMasterVolume: (volume: number) => void;

  addPlayingPad: (padId: string) => void;
  removePlayingPad: (padId: string) => void;
  clearAllPlayingPads: () => void;

  addFadingOutPad: (padId: string) => void;
  removeFadingOutPad: (padId: string) => void;

  addFadingPad: (padId: string) => void;
  removeFadingPad: (padId: string) => void;

  addReversingPad: (padId: string) => void;
  removeReversingPad: (padId: string) => void;

  setIsPreviewPlaying: (v: boolean) => void;

  setPreviewProgress: (v: number | null) => void;
}

// Factory ensures each spread gets fresh Set/object instances — prevents tests from sharing mutable state.
export const initialPlaybackState = {
  masterVolume: 100,
  get playingPadIds() { return new Set<string>(); },
  get fadingOutPadIds() { return new Set<string>(); },
  get fadingPadIds() { return new Set<string>(); },
  get reversingPadIds() { return new Set<string>(); },
  isPreviewPlaying: false,
  previewProgress: null,
};

export const usePlaybackStore = create<PlaybackState>()(subscribeWithSelector((set) => {
  // Extend this union whenever a new Set<string> field is added to PlaybackState.
  type SetField = "playingPadIds" | "fadingOutPadIds" | "fadingPadIds" | "reversingPadIds";

  const addToSet = (field: SetField) => (padId: string) =>
    set((s) => {
      if (s[field].has(padId)) return s;
      const next = new Set(s[field]);
      next.add(padId);
      return { [field]: next } as Partial<PlaybackState>;
    });

  const removeFromSet = (field: SetField) => (padId: string) =>
    set((s) => {
      if (!s[field].has(padId)) return s;
      const next = new Set(s[field]);
      next.delete(padId);
      return { [field]: next } as Partial<PlaybackState>;
    });

  return {
  masterVolume: 100,
  setMasterVolume: (volume) => set({ masterVolume: volume }),

  playingPadIds: new Set<string>(),
  addPlayingPad: addToSet("playingPadIds"),
  removePlayingPad: removeFromSet("playingPadIds"),
  clearAllPlayingPads: () => set({ playingPadIds: new Set() }),

  fadingOutPadIds: new Set<string>(),
  addFadingOutPad: addToSet("fadingOutPadIds"),
  removeFadingOutPad: removeFromSet("fadingOutPadIds"),

  fadingPadIds: new Set<string>(),
  addFadingPad: addToSet("fadingPadIds"),
  removeFadingPad: removeFromSet("fadingPadIds"),

  reversingPadIds: new Set<string>(),
  addReversingPad: addToSet("reversingPadIds"),
  removeReversingPad: removeFromSet("reversingPadIds"),

  isPreviewPlaying: false,
  setIsPreviewPlaying: (v) => set({ isPreviewPlaying: v }),

  previewProgress: null,
  setPreviewProgress: (v) => set({ previewProgress: v }),
  };
}));
