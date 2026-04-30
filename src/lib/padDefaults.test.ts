import { describe, it, expect } from "vitest";
import { createMockLayer, createMockPad, createMockScene } from "@/test/factories";
import type { LayerConfigForm } from "@/lib/schemas";
import { buildPadMap, layerToFormLayer, formLayerToLayer } from "@/lib/padDefaults";

describe("buildPadMap", () => {
  it("returns an empty map for an empty scene list", () => {
    expect(buildPadMap([])).toEqual(new Map());
  });

  it("indexes pads from a single scene by id", () => {
    const pad1 = createMockPad({ id: "p1" });
    const pad2 = createMockPad({ id: "p2" });
    const scene = createMockScene({ pads: [pad1, pad2] });
    const map = buildPadMap([scene]);
    expect(map.get("p1")).toBe(pad1);
    expect(map.get("p2")).toBe(pad2);
  });

  it("indexes pads from multiple scenes", () => {
    const pad1 = createMockPad({ id: "p1" });
    const pad2 = createMockPad({ id: "p2" });
    const scene1 = createMockScene({ pads: [pad1] });
    const scene2 = createMockScene({ pads: [pad2] });
    const map = buildPadMap([scene1, scene2]);
    expect(map.get("p1")).toBe(pad1);
    expect(map.get("p2")).toBe(pad2);
  });

  it("returns undefined for an unknown id", () => {
    const scene = createMockScene({ pads: [createMockPad({ id: "p1" })] });
    expect(buildPadMap([scene]).get("nonexistent")).toBeUndefined();
  });
});

describe("layerToFormLayer", () => {
  it("converts all shared fields from Layer to LayerConfigForm", () => {
    const layer = createMockLayer({
      id: "abc",
      selection: { type: "assigned", instances: [] },
      arrangement: "simultaneous",
      cycleMode: false,
      playbackMode: "one-shot",
      retriggerMode: "restart",
      volume: 80,
    });
    const result = layerToFormLayer(layer);
    expect(result).toEqual({
      id: "abc",
      selection: { type: "assigned", instances: [] },
      arrangement: "simultaneous",
      cycleMode: false,
      playbackMode: "one-shot",
      retriggerMode: "restart",
      volume: 80,
    });
  });

  it("drops the optional name field", () => {
    const layer = createMockLayer({ name: "Kick" });
    const result = layerToFormLayer(layer);
    expect("name" in result).toBe(false);
  });

  it("preserves tag selection fields", () => {
    const layer = createMockLayer({
      selection: { type: "tag", tagIds: ["t1", "t2"], matchMode: "all", defaultVolume: 75 },
    });
    expect(layerToFormLayer(layer).selection).toEqual({
      type: "tag",
      tagIds: ["t1", "t2"],
      matchMode: "all",
      defaultVolume: 75,
    });
  });

  it("preserves set selection fields", () => {
    const layer = createMockLayer({
      selection: { type: "set", setId: "s1", defaultVolume: 90 },
    });
    expect(layerToFormLayer(layer).selection).toEqual({
      type: "set",
      setId: "s1",
      defaultVolume: 90,
    });
  });
});

describe("formLayerToLayer", () => {
  it("converts all shared fields from LayerConfigForm to Layer", () => {
    const form: LayerConfigForm = {
      id: "abc",
      selection: { type: "assigned", instances: [] },
      arrangement: "simultaneous",
      cycleMode: false,
      playbackMode: "one-shot",
      retriggerMode: "restart",
      volume: 80,
    };
    const result = formLayerToLayer(form);
    expect(result).toEqual({
      id: "abc",
      selection: { type: "assigned", instances: [] },
      arrangement: "simultaneous",
      cycleMode: false,
      playbackMode: "one-shot",
      retriggerMode: "restart",
      volume: 80,
    });
  });

  it("does not add a name field", () => {
    const form: LayerConfigForm = {
      id: "abc",
      selection: { type: "assigned", instances: [] },
      arrangement: "simultaneous",
      cycleMode: false,
      playbackMode: "one-shot",
      retriggerMode: "restart",
      volume: 100,
    };
    expect("name" in formLayerToLayer(form)).toBe(false);
  });

  it("round-trips with layerToFormLayer for a layer without a name", () => {
    const original = createMockLayer({
      id: "xyz",
      selection: { type: "assigned", instances: [] },
      arrangement: "shuffled",
      cycleMode: true,
      playbackMode: "loop",
      retriggerMode: "next",
      volume: 60,
    });
    expect(formLayerToLayer(layerToFormLayer(original))).toEqual(original);
  });

  it("preserves tag selection fields", () => {
    const form: LayerConfigForm = {
      id: "def",
      selection: { type: "tag", tagIds: ["t1"], matchMode: "any", defaultVolume: 50 },
      arrangement: "simultaneous",
      cycleMode: false,
      playbackMode: "one-shot",
      retriggerMode: "restart",
      volume: 100,
    };
    expect(formLayerToLayer(form).selection).toEqual({
      type: "tag",
      tagIds: ["t1"],
      matchMode: "any",
      defaultVolume: 50,
    });
  });

  it("preserves tag selection with matchMode 'all'", () => {
    const form: LayerConfigForm = {
      id: "jkl",
      selection: { type: "tag", tagIds: ["t1", "t2"], matchMode: "all", defaultVolume: 80 },
      arrangement: "simultaneous",
      cycleMode: false,
      playbackMode: "one-shot",
      retriggerMode: "restart",
      volume: 100,
    };
    expect(formLayerToLayer(form).selection).toEqual({
      type: "tag",
      tagIds: ["t1", "t2"],
      matchMode: "all",
      defaultVolume: 80,
    });
  });

  it("preserves set selection fields", () => {
    const form: LayerConfigForm = {
      id: "ghi",
      selection: { type: "set", setId: "s1", defaultVolume: 90 },
      arrangement: "simultaneous",
      cycleMode: false,
      playbackMode: "one-shot",
      retriggerMode: "restart",
      volume: 100,
    };
    expect(formLayerToLayer(form).selection).toEqual({
      type: "set",
      setId: "s1",
      defaultVolume: 90,
    });
  });
});
