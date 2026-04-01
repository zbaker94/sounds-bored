import { describe, it, expect, beforeEach } from "vitest";
import { usePlaybackStore } from "./playbackStore";

const initialState = {
  masterVolume: 100,
  playingPadIds: [],
  padVolumes: {},
};

beforeEach(() => {
  // stopAll() clears the module-level voiceMap and layerVoiceMap
  usePlaybackStore.getState().stopAll();
  usePlaybackStore.setState({ ...initialState });
});

describe("layer voice tracking", () => {
  it("layer is not active with no voices", () => {
    expect(usePlaybackStore.getState().isLayerActive("layer-1")).toBe(false);
  });

  it("layer becomes active after recording a voice", () => {
    const source = {} as AudioBufferSourceNode;
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-1", source);
    expect(usePlaybackStore.getState().isLayerActive("layer-1")).toBe(true);
  });

  it("layer becomes inactive after clearing its only voice", () => {
    const source = {} as AudioBufferSourceNode;
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-1", source);
    usePlaybackStore.getState().clearLayerVoice("pad-1", "layer-1", source);
    expect(usePlaybackStore.getState().isLayerActive("layer-1")).toBe(false);
  });

  it("layer stays active while other voices remain", () => {
    const s1 = {} as AudioBufferSourceNode;
    const s2 = {} as AudioBufferSourceNode;
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-1", s1);
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-1", s2);
    usePlaybackStore.getState().clearLayerVoice("pad-1", "layer-1", s1);
    expect(usePlaybackStore.getState().isLayerActive("layer-1")).toBe(true);
  });

  it("stopLayer stops all voices for a layer", () => {
    const stopped: boolean[] = [];
    const makeSource = () =>
      ({ stop: () => stopped.push(true) }) as unknown as AudioBufferSourceNode;

    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-1", makeSource());
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-1", makeSource());
    usePlaybackStore.getState().stopLayer("pad-1", "layer-1");

    expect(stopped).toHaveLength(2);
    expect(usePlaybackStore.getState().isLayerActive("layer-1")).toBe(false);
  });

  it("stopLayer does not affect other layers on the same pad", () => {
    const source = {} as AudioBufferSourceNode;
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-1", source);
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-2", source);

    usePlaybackStore.getState().stopLayer("pad-1", "layer-1");

    expect(usePlaybackStore.getState().isLayerActive("layer-1")).toBe(false);
    expect(usePlaybackStore.getState().isLayerActive("layer-2")).toBe(true);
  });

  it("recording a layer voice also marks the pad as active", () => {
    const source = {} as AudioBufferSourceNode;
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-1", source);
    expect(usePlaybackStore.getState().isPadActive("pad-1")).toBe(true);
  });

  it("clearing the last layer voice for a pad marks pad inactive", () => {
    const source = {} as AudioBufferSourceNode;
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-1", source);
    usePlaybackStore.getState().clearLayerVoice("pad-1", "layer-1", source);
    expect(usePlaybackStore.getState().isPadActive("pad-1")).toBe(false);
  });
});
