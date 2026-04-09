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

describe("updateLayerVolume / removeLayerVolume / removeLayerVolumes", () => {
  it("stores layer volume", () => {
    usePlaybackStore.getState().updateLayerVolume("layer-1", 0.75);
    expect(usePlaybackStore.getState().layerVolumes["layer-1"]).toBe(0.75);
  });

  it("updates existing layer volume", () => {
    usePlaybackStore.getState().updateLayerVolume("layer-1", 0.5);
    usePlaybackStore.getState().updateLayerVolume("layer-1", 0.8);
    expect(usePlaybackStore.getState().layerVolumes["layer-1"]).toBe(0.8);
  });

  it("removes a layer volume entry", () => {
    usePlaybackStore.getState().updateLayerVolume("layer-1", 0.6);
    expect(usePlaybackStore.getState().layerVolumes["layer-1"]).toBe(0.6);
    usePlaybackStore.getState().removeLayerVolume("layer-1");
    expect(usePlaybackStore.getState().layerVolumes["layer-1"]).toBeUndefined();
  });

  it("is a no-op when layerId does not exist", () => {
    usePlaybackStore.getState().updateLayerVolume("layer-1", 0.5);
    usePlaybackStore.getState().removeLayerVolume("layer-2");
    expect(usePlaybackStore.getState().layerVolumes["layer-1"]).toBe(0.5);
  });

  it("removes multiple layer volume entries", () => {
    usePlaybackStore.getState().updateLayerVolume("layer-1", 0.5);
    usePlaybackStore.getState().updateLayerVolume("layer-2", 0.6);
    usePlaybackStore.getState().updateLayerVolume("layer-3", 0.7);
    usePlaybackStore.getState().removeLayerVolumes(["layer-1", "layer-3"]);
    expect(usePlaybackStore.getState().layerVolumes["layer-1"]).toBeUndefined();
    expect(usePlaybackStore.getState().layerVolumes["layer-2"]).toBe(0.6);
    expect(usePlaybackStore.getState().layerVolumes["layer-3"]).toBeUndefined();
  });

  it("is a no-op for non-existent keys in removeLayerVolumes", () => {
    usePlaybackStore.getState().updateLayerVolume("layer-1", 0.5);
    usePlaybackStore.getState().removeLayerVolumes(["layer-2", "layer-3"]);
    expect(usePlaybackStore.getState().layerVolumes["layer-1"]).toBe(0.5);
  });
});
