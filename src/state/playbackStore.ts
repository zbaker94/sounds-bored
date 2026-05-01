import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

// NOTE: All non-serializable audio engine state (voiceMap, layerVoiceMap, GainNodes,
// streaming audio, chain queues, fade tracking) lives in src/lib/audio/audioState.ts.
// This store contains only reactive Zustand state that drives UI re-renders.
//
// Three ownership categories:
//   TickManagedFields    — written exclusively by audioTick.ts via setAudioTick().
//   EventDrivenFields    — written imperatively from padPlayer, layerTrigger, etc.
//   PreviewManagedFields — written by preview.ts's own RAF loop and event handlers.
// masterVolume is intentionally ungrouped — app-level UI configuration, not audio event state.
//
// Authorized exception: clearVolumes() resets padVolumes/layerVolumes on project unmount.
// All other writes to TickManagedFields outside setAudioTick() are bugs.

// Tick-managed fields — written exclusively by audioTick.ts via setAudioTick().
// readonly prevents `state.padVolumes = x` reference reassignment at compile time.
// Note: readonly does NOT prevent `setState({ padVolumes: x })` via Zustand. The enforced
// invariant is that setAudioTick's Partial<TickManagedFields> signature rejects all non-tick
// keys at compile time; direct setState bypasses are caught only by code review convention.
export interface TickManagedFields {
  /** Per-pad runtime volume (0–1). Absent = full volume. Drives PadButton fill bar. */
  readonly padVolumes: Record<string, number>;

  /** Per-layer runtime volume (0–1). Absent = inactive layer; use projectStore layer.volume instead. */
  readonly layerVolumes: Record<string, number>;

  /** Per-pad playback progress (0–1). Present only for pads with active progress info. */
  readonly padProgress: Record<string, number>;

  /** Per-layer playback progress (0–1). Present for each active layer. */
  readonly layerProgress: Record<string, number>;

  /** Layer IDs with active voices. Replaces per-component RAF polling. */
  readonly activeLayerIds: Set<string>;

  /** Per-layer ordered play order (sound IDs). Present for active chained-arrangement layers. */
  readonly layerPlayOrder: Record<string, string[]>;

  /** Per-layer remaining chain queue (sound IDs). Present for active layers with a chain queue. */
  readonly layerChain: Record<string, string[]>;
}

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

interface PlaybackState extends TickManagedFields, EventDrivenFields, PreviewManagedFields {
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

  /** Batch-set any subset of tick-managed fields in a single Zustand mutation.
   *  Only TickManagedFields keys are accepted — passing EventDrivenFields or
   *  PreviewManagedFields keys is a compile error.
   *  When adding a new TickManagedFields key, also update the spread in the implementation below. */
  setAudioTick: (snapshot: Partial<TickManagedFields>) => void;

  /** Reset padVolumes and layerVolumes to empty objects.
   *  Called by MainPage's unmount effect on project close (alongside
   *  clearAllAudioState and clearAllPlayingPads) to ensure stale volumes
   *  from one session do not leak into the next.
   *  Callers must ensure stopAudioTick() has been called first; if the RAF tick
   *  is still active it will repopulate these maps on the next frame. */
  clearVolumes: () => void;
}

// Factory ensures each spread gets fresh Set/object instances — prevents tests from sharing mutable state.
export const initialPlaybackState = {
  masterVolume: 100,
  get playingPadIds() { return new Set<string>(); },
  get fadingOutPadIds() { return new Set<string>(); },
  get fadingPadIds() { return new Set<string>(); },
  get reversingPadIds() { return new Set<string>(); },
  get padVolumes() { return {} as Record<string, number>; },
  get layerVolumes() { return {} as Record<string, number>; },
  get padProgress() { return {} as Record<string, number>; },
  get layerProgress() { return {} as Record<string, number>; },
  get activeLayerIds() { return new Set<string>(); },
  get layerPlayOrder() { return {} as Record<string, string[]>; },
  get layerChain() { return {} as Record<string, string[]>; },
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

  padVolumes: {},
  layerVolumes: {},
  padProgress: {},
  layerProgress: {},
  activeLayerIds: new Set<string>(),
  layerPlayOrder: {},
  layerChain: {},

  setAudioTick: (snapshot) =>
    set(() => ({
      ...(snapshot.padVolumes !== undefined ? { padVolumes: snapshot.padVolumes } : {}),
      ...(snapshot.layerVolumes !== undefined ? { layerVolumes: snapshot.layerVolumes } : {}),
      ...(snapshot.padProgress !== undefined ? { padProgress: snapshot.padProgress } : {}),
      ...(snapshot.layerProgress !== undefined ? { layerProgress: snapshot.layerProgress } : {}),
      ...(snapshot.activeLayerIds !== undefined ? { activeLayerIds: snapshot.activeLayerIds } : {}),
      ...(snapshot.layerPlayOrder !== undefined ? { layerPlayOrder: snapshot.layerPlayOrder } : {}),
      ...(snapshot.layerChain !== undefined ? { layerChain: snapshot.layerChain } : {}),
    })),

  clearVolumes: () => set({ padVolumes: {}, layerVolumes: {} }),
  };
}));
