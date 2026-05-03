import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

// Pad-scoped metrics written exclusively by audioTick.ts on each RAF frame.
// Isolated from layerMetricsStore so that subscribers to pad volumes and progress
// are not woken by layer-level state changes (and vice versa).
//
// subscribeWithSelector is applied for consistency with layerMetricsStore (which needs
// it for BackFaceLayerRow's throttled imperative subscription) and to future-proof
// this store against similar imperative use cases.
//
// Ownership:
//   setPadMetrics() — called by audioTick.ts only in production code; tests may invoke
//                     directly to seed state.
//   clearPadMetrics() — called by stopAudioTick() (via clearAllTickFields) on stop/close.

export interface PadMetricsFields {
  /** Per-pad runtime volume (0–1). Absent = full volume. Drives PadButton fill bar. */
  readonly padVolumes: Record<string, number>;

  /** Per-pad playback progress (0–1). Present only for pads with active progress info. */
  readonly padProgress: Record<string, number>;
}

interface PadMetricsState extends PadMetricsFields {
  /** Batch-set any subset of pad-scoped tick fields in a single Zustand mutation. */
  setPadMetrics: (snapshot: Partial<PadMetricsFields>) => void;

  /** Reset all pad metrics to empty. Called on stop/project close. */
  clearPadMetrics: () => void;
}

// Factory ensures each spread gets fresh object instances — prevents tests from sharing mutable state.
export const initialPadMetricsState: PadMetricsFields = {
  get padVolumes() { return {} as Record<string, number>; },
  get padProgress() { return {} as Record<string, number>; },
};

export const usePadMetricsStore = create<PadMetricsState>()(subscribeWithSelector((set) => ({
  padVolumes: {},
  padProgress: {},

  setPadMetrics: (snapshot) =>
    set(() => ({
      ...(snapshot.padVolumes !== undefined ? { padVolumes: snapshot.padVolumes } : {}),
      ...(snapshot.padProgress !== undefined ? { padProgress: snapshot.padProgress } : {}),
    })),

  clearPadMetrics: () => set({ padVolumes: {}, padProgress: {} }),
})));
