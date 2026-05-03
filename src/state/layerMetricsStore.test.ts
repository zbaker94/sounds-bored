import { describe, it, expect, beforeEach } from "vitest";
import { useLayerMetricsStore, initialLayerMetricsState } from "./layerMetricsStore";

beforeEach(() => {
  useLayerMetricsStore.setState({ ...initialLayerMetricsState });
});

describe("setLayerMetrics", () => {
  it("updates layerVolumes", () => {
    useLayerMetricsStore.getState().setLayerMetrics({ layerVolumes: { "layer-1": 0.7 } });
    expect(useLayerMetricsStore.getState().layerVolumes["layer-1"]).toBe(0.7);
  });

  it("updates layerProgress", () => {
    useLayerMetricsStore.getState().setLayerMetrics({ layerProgress: { "layer-1": 0.5 } });
    expect(useLayerMetricsStore.getState().layerProgress["layer-1"]).toBe(0.5);
  });

  it("updates activeLayerIds", () => {
    useLayerMetricsStore.getState().setLayerMetrics({ activeLayerIds: new Set(["layer-a", "layer-b"]) });
    expect(useLayerMetricsStore.getState().activeLayerIds.has("layer-a")).toBe(true);
    expect(useLayerMetricsStore.getState().activeLayerIds.has("layer-b")).toBe(true);
  });

  it("updates layerPlayOrder", () => {
    useLayerMetricsStore.getState().setLayerMetrics({ layerPlayOrder: { "layer-1": ["s1", "s2", "s3"] } });
    expect(useLayerMetricsStore.getState().layerPlayOrder["layer-1"]).toEqual(["s1", "s2", "s3"]);
  });

  it("updates layerChain", () => {
    useLayerMetricsStore.getState().setLayerMetrics({ layerChain: { "layer-1": ["s2", "s3"] } });
    expect(useLayerMetricsStore.getState().layerChain["layer-1"]).toEqual(["s2", "s3"]);
  });

  it("partial update does not clobber other fields", () => {
    useLayerMetricsStore.getState().setLayerMetrics({
      layerPlayOrder: { "layer-1": ["s1", "s2"] },
      layerChain: { "layer-1": ["s2"] },
    });
    useLayerMetricsStore.getState().setLayerMetrics({ layerVolumes: { "layer-1": 0.5 } });
    expect(useLayerMetricsStore.getState().layerPlayOrder["layer-1"]).toEqual(["s1", "s2"]);
    expect(useLayerMetricsStore.getState().layerChain["layer-1"]).toEqual(["s2"]);
  });

  it("empty records replace previous values", () => {
    useLayerMetricsStore.getState().setLayerMetrics({
      layerPlayOrder: { "layer-1": ["s1"] },
      layerChain: { "layer-1": ["s1"] },
    });
    useLayerMetricsStore.getState().setLayerMetrics({ layerPlayOrder: {}, layerChain: {} });
    expect(useLayerMetricsStore.getState().layerPlayOrder).toEqual({});
    expect(useLayerMetricsStore.getState().layerChain).toEqual({});
  });
});

describe("clearLayerMetrics", () => {
  it("resets all fields to empty", () => {
    useLayerMetricsStore.getState().setLayerMetrics({
      layerVolumes: { "layer-1": 0.7 },
      layerProgress: { "layer-1": 0.5 },
      activeLayerIds: new Set(["layer-1"]),
      layerPlayOrder: { "layer-1": ["s1"] },
      layerChain: { "layer-1": ["s1"] },
    });
    useLayerMetricsStore.getState().clearLayerMetrics();
    expect(useLayerMetricsStore.getState().layerVolumes).toEqual({});
    expect(useLayerMetricsStore.getState().layerProgress).toEqual({});
    expect(useLayerMetricsStore.getState().activeLayerIds.size).toBe(0);
    expect(useLayerMetricsStore.getState().layerPlayOrder).toEqual({});
    expect(useLayerMetricsStore.getState().layerChain).toEqual({});
  });

  it("is a no-op when already empty", () => {
    useLayerMetricsStore.getState().clearLayerMetrics();
    expect(useLayerMetricsStore.getState().activeLayerIds.size).toBe(0);
  });
});

describe("subscriber isolation", () => {
  it("activeLayerIds subscriber does not fire when only layerVolumes changes", () => {
    let callCount = 0;
    const unsub = useLayerMetricsStore.subscribe(
      (s) => s.activeLayerIds.size,
      () => { callCount++; },
    );
    useLayerMetricsStore.getState().setLayerMetrics({ layerVolumes: { "layer-1": 0.5 } });
    expect(callCount).toBe(0);
    unsub();
  });

  it("layerVolumes subscriber does not fire when only activeLayerIds changes", () => {
    let callCount = 0;
    const unsub = useLayerMetricsStore.subscribe(
      (s) => s.layerVolumes["layer-1"],
      () => { callCount++; },
    );
    useLayerMetricsStore.getState().setLayerMetrics({ activeLayerIds: new Set(["layer-1"]) });
    expect(callCount).toBe(0);
    unsub();
  });

  it("layerProgress subscriber does not fire when only layerPlayOrder changes", () => {
    let callCount = 0;
    const unsub = useLayerMetricsStore.subscribe(
      (s) => s.layerProgress["layer-1"],
      () => { callCount++; },
    );
    useLayerMetricsStore.getState().setLayerMetrics({ layerPlayOrder: { "layer-1": ["s1"] } });
    expect(callCount).toBe(0);
    unsub();
  });
});
