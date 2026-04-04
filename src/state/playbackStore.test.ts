import { describe, it, expect, beforeEach, vi } from "vitest";
import { usePlaybackStore } from "./playbackStore";
import type { AudioVoice } from "@/lib/audio/audioVoice";

const initialState = {
  masterVolume: 100,
  playingPadIds: [],
  padVolumes: {},
};

function makeVoice(opts: { onStop?: () => void } = {}): AudioVoice {
  return {
    start: async () => {},
    stop: opts.onStop ?? (() => {}),
    stopWithRamp: () => {},
    setVolume: () => {},
    setOnEnded: () => {},
  };
}

beforeEach(() => {
  usePlaybackStore.getState().stopAll();
  usePlaybackStore.setState({ ...initialState });
});

describe("layer voice tracking", () => {
  it("layer is not active with no voices", () => {
    expect(usePlaybackStore.getState().isLayerActive("layer-1")).toBe(false);
  });

  it("layer becomes active after recording a voice", () => {
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-1", makeVoice());
    expect(usePlaybackStore.getState().isLayerActive("layer-1")).toBe(true);
  });

  it("layer becomes inactive after clearing its only voice", () => {
    const voice = makeVoice();
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-1", voice);
    usePlaybackStore.getState().clearLayerVoice("pad-1", "layer-1", voice);
    expect(usePlaybackStore.getState().isLayerActive("layer-1")).toBe(false);
  });

  it("layer stays active while other voices remain", () => {
    const v1 = makeVoice();
    const v2 = makeVoice();
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-1", v1);
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-1", v2);
    usePlaybackStore.getState().clearLayerVoice("pad-1", "layer-1", v1);
    expect(usePlaybackStore.getState().isLayerActive("layer-1")).toBe(true);
  });

  it("stopLayer stops all voices for a layer", () => {
    const stopped: boolean[] = [];
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-1", makeVoice({ onStop: () => stopped.push(true) }));
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-1", makeVoice({ onStop: () => stopped.push(true) }));
    usePlaybackStore.getState().stopLayer("pad-1", "layer-1");
    expect(stopped).toHaveLength(2);
    expect(usePlaybackStore.getState().isLayerActive("layer-1")).toBe(false);
  });

  it("stopLayer does not affect other layers on the same pad", () => {
    const voice = makeVoice();
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-1", voice);
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-2", voice);
    usePlaybackStore.getState().stopLayer("pad-1", "layer-1");
    expect(usePlaybackStore.getState().isLayerActive("layer-1")).toBe(false);
    expect(usePlaybackStore.getState().isLayerActive("layer-2")).toBe(true);
  });

  it("recording a layer voice also marks the pad as active", () => {
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-1", makeVoice());
    expect(usePlaybackStore.getState().isPadActive("pad-1")).toBe(true);
  });

  it("clearing the last layer voice for a pad marks pad inactive", () => {
    const voice = makeVoice();
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-1", voice);
    usePlaybackStore.getState().clearLayerVoice("pad-1", "layer-1", voice);
    expect(usePlaybackStore.getState().isPadActive("pad-1")).toBe(false);
  });
});

describe("pad-level stop methods", () => {
  it("stopPad stops all voices for a pad", () => {
    const stopped: boolean[] = [];
    const voice1 = makeVoice({ onStop: () => stopped.push(true) });
    const voice2 = makeVoice({ onStop: () => stopped.push(true) });
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-1", voice1);
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-2", voice2);
    usePlaybackStore.getState().stopPad("pad-1");
    expect(stopped).toHaveLength(2);
    expect(usePlaybackStore.getState().isPadActive("pad-1")).toBe(false);
  });

  it("stopPad also clears layerVoiceMap — layers become inactive", () => {
    const voice = makeVoice();
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-1", voice);
    usePlaybackStore.getState().stopPad("pad-1");
    expect(usePlaybackStore.getState().isLayerActive("layer-1")).toBe(false);
  });

  it("stopAll stops all voices across all pads", () => {
    const stopped: boolean[] = [];
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-1", makeVoice({ onStop: () => stopped.push(true) }));
    usePlaybackStore.getState().recordLayerVoice("pad-2", "layer-2", makeVoice({ onStop: () => stopped.push(true) }));
    usePlaybackStore.getState().stopAll();
    expect(stopped).toHaveLength(2);
  });

  it("stopAll clears all active pad IDs", () => {
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-1", makeVoice());
    usePlaybackStore.getState().recordLayerVoice("pad-2", "layer-2", makeVoice());
    usePlaybackStore.getState().stopAll();
    expect(usePlaybackStore.getState().playingPadIds).toHaveLength(0);
    expect(usePlaybackStore.getState().isPadActive("pad-1")).toBe(false);
    expect(usePlaybackStore.getState().isPadActive("pad-2")).toBe(false);
  });
});

describe("getLayerVoices", () => {
  it("returns empty array for unknown layer", () => {
    expect(usePlaybackStore.getState().getLayerVoices("no-such-layer")).toEqual([]);
  });

  it("returns voices for a recorded layer", () => {
    const voice = { start: vi.fn(), stop: vi.fn(), stopWithRamp: vi.fn(), setVolume: vi.fn(), setOnEnded: vi.fn() };
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-1", voice as any);
    const voices = usePlaybackStore.getState().getLayerVoices("layer-1");
    expect(voices).toHaveLength(1);
    expect(voices[0]).toBe(voice);
  });
});

describe("nullAllOnEnded", () => {
  it("calls setOnEnded(null) on all recorded voices", () => {
    const voice1 = { start: vi.fn(), stop: vi.fn(), stopWithRamp: vi.fn(), setVolume: vi.fn(), setOnEnded: vi.fn() };
    const voice2 = { start: vi.fn(), stop: vi.fn(), stopWithRamp: vi.fn(), setVolume: vi.fn(), setOnEnded: vi.fn() };
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-1", voice1 as any);
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-2", voice2 as any);
    usePlaybackStore.getState().nullAllOnEnded();
    expect(voice1.setOnEnded).toHaveBeenCalledWith(null);
    expect(voice2.setOnEnded).toHaveBeenCalledWith(null);
  });
});
