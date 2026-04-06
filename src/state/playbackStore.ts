import { create } from "zustand";
import type { AudioVoice } from "@/lib/audio/audioVoice";

// Module-level voice maps — AudioVoice objects are non-serializable,
// kept outside Zustand state to avoid proxy issues.
const voiceMap = new Map<string, AudioVoice[]>();
const layerVoiceMap = new Map<string, AudioVoice[]>();

// NOTE: voiceMap and layerVoiceMap are the playbackStore half of the audio runtime state.
// The other half lives in src/lib/audio/audioState.ts (padGainMap, layerGainMap,
// padProgressInfo, padStreamingAudio, layerChainQueue, fadePadTimeouts, padFadeRafs,
// fadingOutPadIds, layerPendingMap). Both halves must always be cleared together.
// Use padPlayer.stopAllPads() as the single entry point — never call stopAll() directly
// from application code.

interface PlaybackState {
  masterVolume: number; // 0–100
  setMasterVolume: (volume: number) => void;

  // Which pad IDs currently have active voices (for UI feedback)
  playingPadIds: Set<string>;

  // Whether a sound preview is currently playing (for Stop All button state)
  isPreviewPlaying: boolean;
  setIsPreviewPlaying: (v: boolean) => void;

  // Per-pad runtime volume (0–1), mirrored from padGainMap for React reactivity
  padVolumes: Record<string, number>;
  updatePadVolume: (padId: string, volume: number) => void;

  // Which pad IDs currently have an active automated or gesture-driven volume transition (drives the fill bar)
  volumeTransitioningPadIds: Set<string>;
  startVolumeTransition: (padId: string) => void;
  clearVolumeTransition: (padId: string) => void;
  clearAllVolumeTransitions: () => void;
  /** Reset padVolumes to {} so stale values don't persist as the initial height on the next transition. */
  resetAllPadVolumes: () => void;

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

// Factory ensures each spread gets fresh Set/object instances — prevents tests from sharing mutable state.
export const initialPlaybackState = {
  masterVolume: 100,
  get playingPadIds() { return new Set<string>(); },
  get padVolumes() { return {} as Record<string, number>; },
  get volumeTransitioningPadIds() { return new Set<string>(); },
  isPreviewPlaying: false,
};

export const usePlaybackStore = create<PlaybackState>()((set, get) => ({
  masterVolume: 100,
  setMasterVolume: (volume) => set({ masterVolume: volume }),

  playingPadIds: new Set<string>(),
  isPreviewPlaying: false,
  setIsPreviewPlaying: (v) => set({ isPreviewPlaying: v }),
  padVolumes: {},

  updatePadVolume: (padId, volume) =>
    set((s) => ({ padVolumes: { ...s.padVolumes, [padId]: volume } })),

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

  // ── Pad-level ─────────────────────────────────────────────────────────────

  isPadActive: (padId) => (voiceMap.get(padId)?.length ?? 0) > 0,

  recordVoice: (padId, voice) => {
    voiceMap.set(padId, [...(voiceMap.get(padId) ?? []), voice]);
    set((s) => {
      if (s.playingPadIds.has(padId)) return s;
      const next = new Set(s.playingPadIds);
      next.add(padId);
      return { playingPadIds: next };
    });
  },

  clearVoice: (padId, voice) => {
    const updated = (voiceMap.get(padId) ?? []).filter((v) => v !== voice);
    if (updated.length === 0) {
      voiceMap.delete(padId);
      set((s) => {
        if (!s.playingPadIds.has(padId)) return s;
        const next = new Set(s.playingPadIds);
        next.delete(padId);
        return { playingPadIds: next };
      });
    } else {
      voiceMap.set(padId, updated);
    }
  },

  stopPad: (padId) => {
    const voices = voiceMap.get(padId) ?? [];
    const stoppedSet = new Set(voices);
    voiceMap.delete(padId);
    set((s) => {
      if (!s.playingPadIds.has(padId)) return s;
      const next = new Set(s.playingPadIds);
      next.delete(padId);
      return { playingPadIds: next };
    });
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
    // NOTE: This clears only the playbackStore half of audio runtime state (voiceMap, layerVoiceMap).
    // The padPlayer half (gain nodes, streaming audio, chain queues, fade tracking) lives in
    // src/lib/audio/audioState.ts and must be cleared separately.
    //
    // INVARIANT: Always call padPlayer.stopAllPads() instead of this method directly.
    // stopAllPads() ensures:
    //   1. Fade tracking is cancelled (clearAllFadeTracking)
    //   2. Chain queues are cleared (clearAllLayerChains) — prevents onended from advancing chains
    //   3. onended callbacks are nulled — prevents loop restarts during the gain ramp window
    //   4. Gain nodes are ramped to 0 (STOP_RAMP_S) before voices are stopped
    //   5. audioState Maps are cleared (padStreamingAudio, padProgressInfo, layer/pad gains)
    //   6. This method is called last to stop voices and clear reactive UI state

    // Collect from voiceMap only — every layer voice is also in voiceMap
    // by the recordLayerVoice → recordVoice invariant, so no voices are missed.
    const allVoices = [...voiceMap.values()].flat();
    voiceMap.clear();
    layerVoiceMap.clear();
    set({ playingPadIds: new Set() });
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
      set((s) => {
        if (!s.playingPadIds.has(padId)) return s;
        const next = new Set(s.playingPadIds);
        next.delete(padId);
        return { playingPadIds: next };
      });
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
