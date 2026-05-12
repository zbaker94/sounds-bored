import { describe, it, expect } from "vitest";
import { isFadeablePad, buildPadMap, padToConfig, findPadAndScene } from "@/lib/padUtils";
import { createMockPad, createMockLayer, createMockScene } from "@/test/factories";

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

  it("last scene wins when the same pad id appears in multiple scenes", () => {
    const first = createMockPad({ id: "dup", name: "First" });
    const second = createMockPad({ id: "dup", name: "Second" });
    const map = buildPadMap([
      createMockScene({ pads: [first] }),
      createMockScene({ pads: [second] }),
    ]);
    expect(map.get("dup")).toBe(second);
  });
});

describe("padToConfig", () => {
  it("maps pad fields to config", () => {
    const layer = createMockLayer({ id: "l1" });
    const pad = createMockPad({
      name: "Kick",
      layers: [layer],
      color: "#ff0000",
      fadeDurationMs: 500,
      volume: 80,
      fadeTargetVol: 10,
    });
    const config = padToConfig(pad);
    expect(config.name).toBe("Kick");
    expect(config.layers).toEqual([layer]);
    expect(config.color).toBe("#ff0000");
    expect(config.fadeDurationMs).toBe(500);
    expect(config.volume).toBe(80);
    expect(config.fadeTargetVol).toBe(10);
  });

  it("uses provided layers array instead of pad.layers", () => {
    const padLayer = createMockLayer({ id: "pad-layer" });
    const newLayer = createMockLayer({ id: "new-layer" });
    const pad = createMockPad({ layers: [padLayer] });
    expect(padToConfig(pad, [newLayer]).layers).toEqual([newLayer]);
  });

  it("falls back to pad.layers when no layers argument given", () => {
    const layer = createMockLayer({ id: "l1" });
    const pad = createMockPad({ layers: [layer] });
    expect(padToConfig(pad).layers).toEqual([layer]);
  });

  it("preserves muteTargetPadIds from the original pad", () => {
    const pad = createMockPad({ muteTargetPadIds: ["pad-2", "pad-3"] });
    expect(padToConfig(pad).muteTargetPadIds).toEqual(["pad-2", "pad-3"]);
  });

  it("preserves muteGroupId from the original pad", () => {
    const pad = createMockPad({ muteGroupId: "hi-hat" });
    expect(padToConfig(pad).muteGroupId).toBe("hi-hat");
  });

  it("preserves muteTargetPadIds when layers argument is provided", () => {
    const newLayer = createMockLayer({ id: "new-layer" });
    const pad = createMockPad({ muteTargetPadIds: ["pad-5"] });
    const config = padToConfig(pad, [newLayer]);
    expect(config.muteTargetPadIds).toEqual(["pad-5"]);
    expect(config.layers).toEqual([newLayer]);
  });

  it("defaults volume to 100 when pad.volume is undefined", () => {
    const pad = createMockPad({ volume: undefined });
    expect(padToConfig(pad).volume).toBe(100);
  });

  it("defaults fadeTargetVol to 0 when pad.fadeTargetVol is undefined", () => {
    const pad = createMockPad({ fadeTargetVol: undefined });
    expect(padToConfig(pad).fadeTargetVol).toBe(0);
  });

  it("preserves volume of 0 without defaulting to 100", () => {
    const pad = createMockPad({ volume: 0 });
    expect(padToConfig(pad).volume).toBe(0);
  });

  it("preserves fadeTargetVol of non-zero value without defaulting", () => {
    const pad = createMockPad({ fadeTargetVol: 50 });
    expect(padToConfig(pad).fadeTargetVol).toBe(50);
  });

  it("preserves icon from the original pad", () => {
    const pad = createMockPad({ icon: "Kick01" });
    expect(padToConfig(pad).icon).toBe("Kick01");
  });

  it("uses empty layers array override instead of pad.layers", () => {
    const layer = createMockLayer({ id: "l1" });
    const pad = createMockPad({ layers: [layer] });
    expect(padToConfig(pad, []).layers).toEqual([]);
  });
});

describe("findPadAndScene", () => {
  it("returns null for an empty scene list", () => {
    expect(findPadAndScene([], "p1")).toBeNull();
  });

  it("returns null when pad id not found", () => {
    const scene = createMockScene({ pads: [createMockPad({ id: "p1" })] });
    expect(findPadAndScene([scene], "nonexistent")).toBeNull();
  });

  it("finds pad in the first scene", () => {
    const pad = createMockPad({ id: "p1" });
    const scene = createMockScene({ pads: [pad] });
    const result = findPadAndScene([scene], "p1");
    expect(result?.pad).toBe(pad);
    expect(result?.scene).toBe(scene);
  });

  it("finds pad in a later scene", () => {
    const pad = createMockPad({ id: "p2" });
    const scene1 = createMockScene({ pads: [createMockPad({ id: "p1" })] });
    const scene2 = createMockScene({ pads: [pad] });
    const result = findPadAndScene([scene1, scene2], "p2");
    expect(result?.pad).toBe(pad);
    expect(result?.scene).toBe(scene2);
  });

  it("returns null for a scene with an empty pads array", () => {
    const scene = createMockScene({ pads: [] });
    expect(findPadAndScene([scene], "p1")).toBeNull();
  });

  it("returns the first scene's match when the same pad id appears in two scenes", () => {
    const first = createMockPad({ id: "dup", name: "First" });
    const second = createMockPad({ id: "dup", name: "Second" });
    const scene1 = createMockScene({ pads: [first] });
    const scene2 = createMockScene({ pads: [second] });
    const result = findPadAndScene([scene1, scene2], "dup");
    expect(result?.pad).toBe(first);
    expect(result?.scene).toBe(scene1);
  });
});

describe("isFadeablePad", () => {
  it("returns true for a pad with only one-shot layers", () => {
    const pad = createMockPad({
      layers: [createMockLayer({ playbackMode: "one-shot" })],
    });
    expect(isFadeablePad(pad)).toBe(true);
  });

  it("returns true for a pad with only loop layers", () => {
    const pad = createMockPad({
      layers: [createMockLayer({ playbackMode: "loop" })],
    });
    expect(isFadeablePad(pad)).toBe(true);
  });

  it("returns true for a pad with multiple non-hold layers", () => {
    const pad = createMockPad({
      layers: [
        createMockLayer({ playbackMode: "one-shot" }),
        createMockLayer({ playbackMode: "loop" }),
      ],
    });
    expect(isFadeablePad(pad)).toBe(true);
  });

  it("returns false for a pad with no layers", () => {
    const pad = createMockPad({ layers: [] });
    expect(isFadeablePad(pad)).toBe(false);
  });

  it("returns false for a pad with a single hold-mode layer", () => {
    const pad = createMockPad({
      layers: [createMockLayer({ playbackMode: "hold" })],
    });
    expect(isFadeablePad(pad)).toBe(false);
  });

  it("returns false for a mixed-mode pad with one hold layer", () => {
    const pad = createMockPad({
      layers: [
        createMockLayer({ playbackMode: "one-shot" }),
        createMockLayer({ playbackMode: "hold" }),
      ],
    });
    expect(isFadeablePad(pad)).toBe(false);
  });

  it("returns false for a pad where all layers are hold", () => {
    const pad = createMockPad({
      layers: [
        createMockLayer({ playbackMode: "hold" }),
        createMockLayer({ playbackMode: "hold" }),
      ],
    });
    expect(isFadeablePad(pad)).toBe(false);
  });
});
