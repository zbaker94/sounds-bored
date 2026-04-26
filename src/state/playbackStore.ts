import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

// NOTE: All non-serializable audio engine state (voiceMap, layerVoiceMap, GainNodes,
// streaming audio, chain queues, fade tracking) lives in src/lib/audio/audioState.ts.
// This store contains only reactive Zustand state that drives UI re-renders.
//
// Tick-managed fields (padVolumes, layerVolumes, padProgress, activeLayerIds) are
// written by the single global audioTick RAF loop in src/lib/audio/audioTick.ts.
// All other writes to these fields are bugs.

interface AudioTickSnapshot {
  padVolumes?: Record<string, number>;
  layerVolumes?: Record<string, number>;
  padProgress?: Record<string, number>;
  layerProgress?: Record<string, number>;
  activeLayerIds?: Set<string>;
  /** Per-layer ordered play order as sound IDs. Entry exists for layers whose
   *  chained arrangement has computed a play order. Absence = no ordering yet. */
  layerPlayOrder?: Record<string, string[]>;
  /** Per-layer remaining chain queue as sound IDs (leading entry = currently playing).
   *  Entry exists only for layers with an active chain queue. */
  layerChain?: Record<string, string[]>;
}

interface PlaybackState {
  masterVolume: number; // 0–100
  setMasterVolume: (volume: number) => void;

  // Which pad IDs currently have active voices (for UI feedback)
  // Push-based (discrete events), NOT tick-managed.
  playingPadIds: Set<string>;
  addPlayingPad: (padId: string) => void;
  removePlayingPad: (padId: string) => void;
  clearAllPlayingPads: () => void;

  // Which pad IDs are currently fading out (for label direction in UI)
  // Push-based: set when a fade-out ramp starts, cleared on completion or cancel.
  fadingOutPadIds: Set<string>;
  addFadingOutPad: (padId: string) => void;
  removeFadingOutPad: (padId: string) => void;

  // Which pad IDs have any fade ramp in progress (up or down).
  // Push-based: set when fadePad/triggerAndFade starts a ramp, cleared on completion or cancel.
  fadingPadIds: Set<string>;
  addFadingPad: (padId: string) => void;
  removeFadingPad: (padId: string) => void;

  // Which pad IDs are currently running a reversal ramp (reversed by the user mid-fade).
  // Set after reverseFade calls fadePad; cleared at the start of any new fadePad call.
  reversingPadIds: Set<string>;
  addReversingPad: (padId: string) => void;
  removeReversingPad: (padId: string) => void;

  // Whether a sound preview is currently playing (for Stop All button state)
  isPreviewPlaying: boolean;
  setIsPreviewPlaying: (v: boolean) => void;

  // ---------------------------------------------------------------------------
  // Tick-managed fields — written exclusively by audioTick.ts via setAudioTick()
  // ---------------------------------------------------------------------------

  /** Per-pad runtime volume (0–1). Entry exists only when gain < 0.999 (pad is fading/adjusted).
   *  Absence of an entry means the pad is at full volume. Used to drive the fill bar in PadButton. */
  padVolumes: Record<string, number>;

  /** Per-layer runtime volume (0–1). Entry exists for playing layers with an active gain node.
   *  Written exclusively by audioTick. Absence of an entry means the layer is inactive;
   *  read `layer.volume` from `projectStore` via `getLayerNormalizedVolume` in that case. */
  layerVolumes: Record<string, number>;

  /** Per-pad playback progress (0–1). Entry exists for playing pads with progress info. */
  padProgress: Record<string, number>;

  /** Per-layer playback progress (0–1). Entry exists for each active layer. */
  layerProgress: Record<string, number>;

  /** Set of layer IDs currently playing (have active voices). Replaces per-component RAF polling. */
  activeLayerIds: Set<string>;

  /** Per-layer ordered play order (sound IDs). Tick-managed. Entry present only for
   *  active layers with chained arrangements. Replaces the per-LayerRow RAF poll of
   *  getLayerPlayOrder() in PadControlContent. */
  layerPlayOrder: Record<string, string[]>;

  /** Per-layer remaining chain queue (sound IDs). Tick-managed. Entry present only for
   *  active layers with a chain queue. Replaces the per-LayerRow RAF poll of
   *  getLayerChain() in PadControlContent. */
  layerChain: Record<string, string[]>;

  /** Batch-set any subset of tick-managed fields in a single Zustand mutation. */
  setAudioTick: (snapshot: AudioTickSnapshot) => void;

  /** Reset padVolumes and layerVolumes to empty objects.
   *  Called by clearAllAudioState() on project close to ensure stale volumes
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
};

export const usePlaybackStore = create<PlaybackState>()(subscribeWithSelector((set) => ({
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

  fadingOutPadIds: new Set<string>(),
  addFadingOutPad: (padId) =>
    set((s) => {
      if (s.fadingOutPadIds.has(padId)) return s;
      const next = new Set(s.fadingOutPadIds);
      next.add(padId);
      return { fadingOutPadIds: next };
    }),
  removeFadingOutPad: (padId) =>
    set((s) => {
      if (!s.fadingOutPadIds.has(padId)) return s;
      const next = new Set(s.fadingOutPadIds);
      next.delete(padId);
      return { fadingOutPadIds: next };
    }),

  fadingPadIds: new Set<string>(),
  addFadingPad: (padId) =>
    set((s) => {
      if (s.fadingPadIds.has(padId)) return s;
      const next = new Set(s.fadingPadIds);
      next.add(padId);
      return { fadingPadIds: next };
    }),
  removeFadingPad: (padId) =>
    set((s) => {
      if (!s.fadingPadIds.has(padId)) return s;
      const next = new Set(s.fadingPadIds);
      next.delete(padId);
      return { fadingPadIds: next };
    }),

  reversingPadIds: new Set<string>(),
  addReversingPad: (padId) =>
    set((s) => {
      if (s.reversingPadIds.has(padId)) return s;
      const next = new Set(s.reversingPadIds);
      next.add(padId);
      return { reversingPadIds: next };
    }),
  removeReversingPad: (padId) =>
    set((s) => {
      if (!s.reversingPadIds.has(padId)) return s;
      const next = new Set(s.reversingPadIds);
      next.delete(padId);
      return { reversingPadIds: next };
    }),

  isPreviewPlaying: false,
  setIsPreviewPlaying: (v) => set({ isPreviewPlaying: v }),

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
})));
