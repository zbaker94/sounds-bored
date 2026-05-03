import { describe, it, expect, beforeEach } from "vitest";
import { usePadMetricsStore, initialPadMetricsState } from "./padMetricsStore";

beforeEach(() => {
  usePadMetricsStore.setState({ ...initialPadMetricsState });
});

describe("setPadMetrics", () => {
  it("updates padVolumes", () => {
    usePadMetricsStore.getState().setPadMetrics({ padVolumes: { "pad-1": 0.5 } });
    expect(usePadMetricsStore.getState().padVolumes["pad-1"]).toBe(0.5);
  });

  it("updates padProgress", () => {
    usePadMetricsStore.getState().setPadMetrics({ padProgress: { "pad-1": 0.42 } });
    expect(usePadMetricsStore.getState().padProgress["pad-1"]).toBe(0.42);
  });

  it("can update both fields in one call", () => {
    usePadMetricsStore.getState().setPadMetrics({ padVolumes: { "pad-1": 0.3 }, padProgress: { "pad-1": 0.6 } });
    expect(usePadMetricsStore.getState().padVolumes["pad-1"]).toBe(0.3);
    expect(usePadMetricsStore.getState().padProgress["pad-1"]).toBe(0.6);
  });

  it("partial update does not clobber the other field", () => {
    usePadMetricsStore.getState().setPadMetrics({ padVolumes: { "pad-1": 0.5 } });
    usePadMetricsStore.getState().setPadMetrics({ padProgress: { "pad-1": 0.2 } });
    expect(usePadMetricsStore.getState().padVolumes["pad-1"]).toBe(0.5);
  });

  it("empty records replace previous values", () => {
    usePadMetricsStore.getState().setPadMetrics({ padVolumes: { "pad-1": 0.5 } });
    usePadMetricsStore.getState().setPadMetrics({ padVolumes: {} });
    expect(usePadMetricsStore.getState().padVolumes).toEqual({});
  });
});

describe("clearPadMetrics", () => {
  it("resets padVolumes to empty object", () => {
    usePadMetricsStore.getState().setPadMetrics({ padVolumes: { "pad-1": 0.5 } });
    usePadMetricsStore.getState().clearPadMetrics();
    expect(usePadMetricsStore.getState().padVolumes).toEqual({});
  });

  it("resets padProgress to empty object", () => {
    usePadMetricsStore.getState().setPadMetrics({ padProgress: { "pad-1": 0.3 } });
    usePadMetricsStore.getState().clearPadMetrics();
    expect(usePadMetricsStore.getState().padProgress).toEqual({});
  });

  it("is a no-op when already empty", () => {
    usePadMetricsStore.getState().clearPadMetrics();
    expect(usePadMetricsStore.getState().padVolumes).toEqual({});
    expect(usePadMetricsStore.getState().padProgress).toEqual({});
  });
});

describe("subscriber isolation", () => {
  it("padVolumes subscriber does not fire when only padProgress changes", () => {
    let callCount = 0;
    const unsub = usePadMetricsStore.subscribe(
      (s) => s.padVolumes["pad-1"],
      () => { callCount++; },
    );
    usePadMetricsStore.getState().setPadMetrics({ padProgress: { "pad-1": 0.5 } });
    expect(callCount).toBe(0);
    unsub();
  });

  it("padProgress subscriber does not fire when only padVolumes changes", () => {
    let callCount = 0;
    const unsub = usePadMetricsStore.subscribe(
      (s) => s.padProgress["pad-1"],
      () => { callCount++; },
    );
    usePadMetricsStore.getState().setPadMetrics({ padVolumes: { "pad-1": 0.5 } });
    expect(callCount).toBe(0);
    unsub();
  });
});
