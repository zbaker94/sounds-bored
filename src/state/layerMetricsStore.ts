import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

// Layer-scoped metrics written exclusively by audioTick.ts on each RAF frame.
// Isolated from padMetricsStore so that subscribers to active-layer state and
// layer progress are not woken by pad volume/progress changes (and vice versa).
//
// Ownership:
//   setLayerMetrics() — called by audioTick.ts only in production code; tests may invoke
//                       directly to seed state.
//   clearLayerMetrics() — called by stopAudioTick() (via clearAllTickFields) on stop/close.

export interface LayerMetricsFields {
  /** Per-layer runtime volume (0–1). Absent = inactive layer; use projectStore layer.volume instead. */
  readonly layerVolumes: Record<string, number>;

  /** Per-layer playback progress (0–1). Present for each active layer. */
  readonly layerProgress: Record<string, number>;

  /** Layer IDs with active voices. Replaces per-component RAF polling. */
  readonly activeLayerIds: Set<string>;

  /** Per-layer ordered play order (sound IDs). Present for active chained-arrangement layers. */
  readonly layerPlayOrder: Record<string, string[]>;

  /** Per-layer remaining chain queue (sound IDs). Present for active layers with a chain queue. */
  readonly layerChain: Record<string, string[]>;
}

interface LayerMetricsState extends LayerMetricsFields {
  /** Batch-set any subset of layer-scoped tick fields in a single Zustand mutation. */
  setLayerMetrics: (snapshot: Partial<LayerMetricsFields>) => void;

  /** Reset all layer metrics to empty. Called on stop/project close. */
  clearLayerMetrics: () => void;
}

// Factory ensures each spread gets fresh Set/object instances — prevents tests from sharing mutable state.
export const initialLayerMetricsState: LayerMetricsFields = {
  get layerVolumes() { return {} as Record<string, number>; },
  get layerProgress() { return {} as Record<string, number>; },
  get activeLayerIds() { return new Set<string>(); },
  get layerPlayOrder() { return {} as Record<string, string[]>; },
  get layerChain() { return {} as Record<string, string[]>; },
};

export const useLayerMetricsStore = create<LayerMetricsState>()(subscribeWithSelector((set) => ({
  layerVolumes: {},
  layerProgress: {},
  activeLayerIds: new Set<string>(),
  layerPlayOrder: {},
  layerChain: {},

  setLayerMetrics: (snapshot) =>
    set(() => ({
      ...(snapshot.layerVolumes !== undefined ? { layerVolumes: snapshot.layerVolumes } : {}),
      ...(snapshot.layerProgress !== undefined ? { layerProgress: snapshot.layerProgress } : {}),
      ...(snapshot.activeLayerIds !== undefined ? { activeLayerIds: snapshot.activeLayerIds } : {}),
      ...(snapshot.layerPlayOrder !== undefined ? { layerPlayOrder: snapshot.layerPlayOrder } : {}),
      ...(snapshot.layerChain !== undefined ? { layerChain: snapshot.layerChain } : {}),
    })),

  clearLayerMetrics: () =>
    set({
      layerVolumes: {},
      layerProgress: {},
      activeLayerIds: new Set<string>(),
      layerPlayOrder: {},
      layerChain: {},
    }),
})));
