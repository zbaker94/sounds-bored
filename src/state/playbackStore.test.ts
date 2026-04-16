import { describe, it, expect, beforeEach } from "vitest";
import { usePlaybackStore, initialPlaybackState } from "./playbackStore";

beforeEach(() => {
  usePlaybackStore.setState({ ...initialPlaybackState });
});

describe("addPlayingPad / removePlayingPad / clearAllPlayingPads", () => {
  it("addPlayingPad adds to playingPadIds", () => {
    usePlaybackStore.getState().addPlayingPad("pad-1");
    expect(usePlaybackStore.getState().playingPadIds.has("pad-1")).toBe(true);
  });

  it("addPlayingPad is idempotent", () => {
    usePlaybackStore.getState().addPlayingPad("pad-1");
    usePlaybackStore.getState().addPlayingPad("pad-1");
    expect(usePlaybackStore.getState().playingPadIds.size).toBe(1);
  });

  it("removePlayingPad removes from playingPadIds", () => {
    usePlaybackStore.getState().addPlayingPad("pad-1");
    usePlaybackStore.getState().removePlayingPad("pad-1");
    expect(usePlaybackStore.getState().playingPadIds.has("pad-1")).toBe(false);
  });

  it("clearAllPlayingPads clears all", () => {
    usePlaybackStore.getState().addPlayingPad("pad-1");
    usePlaybackStore.getState().addPlayingPad("pad-2");
    usePlaybackStore.getState().clearAllPlayingPads();
    expect(usePlaybackStore.getState().playingPadIds.size).toBe(0);
  });
});

describe("setAudioTick", () => {
  beforeEach(() => {
    usePlaybackStore.setState({ ...initialPlaybackState });
  });

  it("updates padVolumes", () => {
    usePlaybackStore.getState().setAudioTick({ padVolumes: { "pad-1": 0.5 } });
    expect(usePlaybackStore.getState().padVolumes["pad-1"]).toBe(0.5);
  });

  it("updates layerVolumes", () => {
    usePlaybackStore.getState().setAudioTick({ layerVolumes: { "layer-1": 0.7 } });
    expect(usePlaybackStore.getState().layerVolumes["layer-1"]).toBe(0.7);
  });

  it("updates padProgress", () => {
    usePlaybackStore.getState().setAudioTick({ padProgress: { "pad-1": 0.42 } });
    expect(usePlaybackStore.getState().padProgress["pad-1"]).toBe(0.42);
  });

  it("updates activeLayerIds", () => {
    usePlaybackStore.getState().setAudioTick({ activeLayerIds: new Set(["layer-a", "layer-b"]) });
    expect(usePlaybackStore.getState().activeLayerIds.has("layer-a")).toBe(true);
    expect(usePlaybackStore.getState().activeLayerIds.has("layer-b")).toBe(true);
  });

  it("updates layerPlayOrder", () => {
    usePlaybackStore.getState().setAudioTick({
      layerPlayOrder: { "layer-1": ["s1", "s2", "s3"] },
    });
    expect(usePlaybackStore.getState().layerPlayOrder["layer-1"]).toEqual([
      "s1",
      "s2",
      "s3",
    ]);
  });

  it("updates layerChain", () => {
    usePlaybackStore.getState().setAudioTick({
      layerChain: { "layer-1": ["s2", "s3"] },
    });
    expect(usePlaybackStore.getState().layerChain["layer-1"]).toEqual(["s2", "s3"]);
  });

  it("partial update does not clobber layerPlayOrder / layerChain", () => {
    usePlaybackStore.getState().setAudioTick({
      layerPlayOrder: { "layer-1": ["s1", "s2"] },
      layerChain: { "layer-1": ["s2"] },
    });
    usePlaybackStore.getState().setAudioTick({ padVolumes: { "pad-1": 0.5 } });
    expect(usePlaybackStore.getState().layerPlayOrder["layer-1"]).toEqual(["s1", "s2"]);
    expect(usePlaybackStore.getState().layerChain["layer-1"]).toEqual(["s2"]);
  });

  it("setAudioTick with empty records replaces prior layerPlayOrder / layerChain", () => {
    usePlaybackStore.getState().setAudioTick({
      layerPlayOrder: { "layer-1": ["s1"] },
      layerChain: { "layer-1": ["s1"] },
    });
    usePlaybackStore.getState().setAudioTick({
      layerPlayOrder: {},
      layerChain: {},
    });
    expect(usePlaybackStore.getState().layerPlayOrder).toEqual({});
    expect(usePlaybackStore.getState().layerChain).toEqual({});
  });

  it("can update multiple fields in one call", () => {
    usePlaybackStore.getState().setAudioTick({
      padVolumes: { "pad-1": 0.3 },
      padProgress: { "pad-1": 0.6 },
    });
    expect(usePlaybackStore.getState().padVolumes["pad-1"]).toBe(0.3);
    expect(usePlaybackStore.getState().padProgress["pad-1"]).toBe(0.6);
  });

  it("partial update does not clobber unspecified fields", () => {
    usePlaybackStore.getState().setAudioTick({ padVolumes: { "pad-1": 0.5 } });
    usePlaybackStore.getState().setAudioTick({ padProgress: { "pad-1": 0.2 } });
    expect(usePlaybackStore.getState().padVolumes["pad-1"]).toBe(0.5);
  });
});

describe("updateLayerVolume (non-playing fallback)", () => {
  beforeEach(() => {
    usePlaybackStore.setState({ ...initialPlaybackState });
  });

  it("stores volume for non-playing layer", () => {
    usePlaybackStore.getState().updateLayerVolume("layer-1", 0.75);
    expect(usePlaybackStore.getState().layerVolumes["layer-1"]).toBe(0.75);
  });
});

describe("clearVolumes", () => {
  beforeEach(() => {
    usePlaybackStore.setState({ ...initialPlaybackState });
  });

  it("resets padVolumes to empty object", () => {
    usePlaybackStore.getState().setAudioTick({ padVolumes: { "pad-1": 0.5, "pad-2": 0.3 } });
    usePlaybackStore.getState().clearVolumes();
    expect(usePlaybackStore.getState().padVolumes).toEqual({});
  });

  it("resets layerVolumes to empty object", () => {
    usePlaybackStore.getState().setAudioTick({ layerVolumes: { "layer-1": 0.7, "layer-2": 0.2 } });
    usePlaybackStore.getState().clearVolumes();
    expect(usePlaybackStore.getState().layerVolumes).toEqual({});
  });

  it("resets both padVolumes and layerVolumes in a single call", () => {
    usePlaybackStore.getState().setAudioTick({
      padVolumes: { "pad-1": 0.5 },
      layerVolumes: { "layer-1": 0.7 },
    });
    usePlaybackStore.getState().clearVolumes();
    expect(usePlaybackStore.getState().padVolumes).toEqual({});
    expect(usePlaybackStore.getState().layerVolumes).toEqual({});
  });

  it("is a no-op when volumes are already empty", () => {
    usePlaybackStore.getState().clearVolumes();
    expect(usePlaybackStore.getState().padVolumes).toEqual({});
    expect(usePlaybackStore.getState().layerVolumes).toEqual({});
  });

  it("does not affect other store fields", () => {
    usePlaybackStore.getState().addPlayingPad("pad-1");
    usePlaybackStore.getState().setAudioTick({ padProgress: { "pad-1": 0.5 } });
    usePlaybackStore.getState().clearVolumes();
    expect(usePlaybackStore.getState().playingPadIds.has("pad-1")).toBe(true);
    expect(usePlaybackStore.getState().padProgress["pad-1"]).toBe(0.5);
  });
});
