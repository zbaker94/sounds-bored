import { describe, it, expect, beforeEach } from "vitest";
import {
  usePadDisplayStore,
  initialPadDisplayState,
  _resetVoiceSeq,
  type PadVoiceInput,
} from "./padDisplayStore";

function makeInfo(overrides: Partial<PadVoiceInput> = {}): PadVoiceInput {
  return {
    soundName: "kick",
    layerName: "layer-a",
    playbackMode: "one-shot",
    durationMs: 1000,
    ...overrides,
  };
}

beforeEach(() => {
  usePadDisplayStore.setState({ ...initialPadDisplayState });
  _resetVoiceSeq();
});

describe("enqueueVoice", () => {
  it("sets current when currentVoice[padId] is null/absent (queue stays empty)", () => {
    const info = makeInfo({ soundName: "first" });
    usePadDisplayStore.getState().enqueueVoice("pad-1", info);

    const state = usePadDisplayStore.getState();
    expect(state.currentVoice["pad-1"]).toEqual({ ...info, seq: 1 });
    expect(state.voiceQueue["pad-1"] ?? []).toEqual([]);
  });

  it("sets current when currentVoice[padId] is explicitly null", () => {
    usePadDisplayStore.setState({
      currentVoice: { "pad-1": null },
      voiceQueue: {},
    });
    const info = makeInfo({ soundName: "fresh" });
    usePadDisplayStore.getState().enqueueVoice("pad-1", info);

    const state = usePadDisplayStore.getState();
    expect(state.currentVoice["pad-1"]).toEqual({ ...info, seq: 1 });
    expect(state.voiceQueue["pad-1"] ?? []).toEqual([]);
  });

  it("appends to voiceQueue[padId] when currentVoice[padId] already set", () => {
    const first = makeInfo({ soundName: "first" });
    const second = makeInfo({ soundName: "second" });

    usePadDisplayStore.getState().enqueueVoice("pad-1", first);
    usePadDisplayStore.getState().enqueueVoice("pad-1", second);

    const state = usePadDisplayStore.getState();
    expect(state.currentVoice["pad-1"]).toEqual({ ...first, seq: 1 });
    expect(state.voiceQueue["pad-1"]).toEqual([{ ...second, seq: 2 }]);
  });

  it("queue grows in order across multiple enqueues", () => {
    const first = makeInfo({ soundName: "first" });
    const second = makeInfo({ soundName: "second" });
    const third = makeInfo({ soundName: "third" });
    const fourth = makeInfo({ soundName: "fourth" });

    usePadDisplayStore.getState().enqueueVoice("pad-1", first);
    usePadDisplayStore.getState().enqueueVoice("pad-1", second);
    usePadDisplayStore.getState().enqueueVoice("pad-1", third);
    usePadDisplayStore.getState().enqueueVoice("pad-1", fourth);

    const state = usePadDisplayStore.getState();
    expect(state.currentVoice["pad-1"]).toEqual({ ...first, seq: 1 });
    expect(state.voiceQueue["pad-1"]).toEqual([
      { ...second, seq: 2 },
      { ...third, seq: 3 },
      { ...fourth, seq: 4 },
    ]);
  });

  it("assigns monotonically increasing seq values across enqueues", () => {
    usePadDisplayStore.getState().enqueueVoice("pad-1", makeInfo());
    usePadDisplayStore.getState().enqueueVoice("pad-2", makeInfo());
    usePadDisplayStore.getState().enqueueVoice("pad-1", makeInfo());

    const state = usePadDisplayStore.getState();
    expect(state.currentVoice["pad-1"]?.seq).toBe(1);
    expect(state.currentVoice["pad-2"]?.seq).toBe(2);
    expect(state.voiceQueue["pad-1"]?.[0].seq).toBe(3);
  });
});

describe("shiftVoice", () => {
  it("shifts first queued item into current when queue has items", () => {
    const first = makeInfo({ soundName: "first" });
    const second = makeInfo({ soundName: "second" });
    const third = makeInfo({ soundName: "third" });

    usePadDisplayStore.getState().enqueueVoice("pad-1", first);
    usePadDisplayStore.getState().enqueueVoice("pad-1", second);
    usePadDisplayStore.getState().enqueueVoice("pad-1", third);

    usePadDisplayStore.getState().shiftVoice("pad-1");

    const state = usePadDisplayStore.getState();
    expect(state.currentVoice["pad-1"]).toEqual({ ...second, seq: 2 });
    expect(state.voiceQueue["pad-1"]).toEqual([{ ...third, seq: 3 }]);
  });

  it("sets current to null when queue is empty", () => {
    const info = makeInfo({ soundName: "only" });
    usePadDisplayStore.getState().enqueueVoice("pad-1", info);

    usePadDisplayStore.getState().shiftVoice("pad-1");

    const state = usePadDisplayStore.getState();
    expect(state.currentVoice["pad-1"]).toBeNull();
  });

  it("sets current to null when both current and queue are absent", () => {
    usePadDisplayStore.getState().shiftVoice("pad-x");

    const state = usePadDisplayStore.getState();
    expect(state.currentVoice["pad-x"]).toBeNull();
  });
});

describe("clearPadDisplay", () => {
  it("clears both current and queue", () => {
    const first = makeInfo({ soundName: "first" });
    const second = makeInfo({ soundName: "second" });
    const third = makeInfo({ soundName: "third" });

    usePadDisplayStore.getState().enqueueVoice("pad-1", first);
    usePadDisplayStore.getState().enqueueVoice("pad-1", second);
    usePadDisplayStore.getState().enqueueVoice("pad-1", third);

    usePadDisplayStore.getState().clearPadDisplay("pad-1");

    const state = usePadDisplayStore.getState();
    expect(state.currentVoice["pad-1"]).toBeNull();
    expect(state.voiceQueue["pad-1"]).toEqual([]);
  });

  it("does not affect other pads' display state", () => {
    const a = makeInfo({ soundName: "a" });
    const b = makeInfo({ soundName: "b" });

    usePadDisplayStore.getState().enqueueVoice("pad-1", a);
    usePadDisplayStore.getState().enqueueVoice("pad-2", b);

    usePadDisplayStore.getState().clearPadDisplay("pad-1");

    const state = usePadDisplayStore.getState();
    expect(state.currentVoice["pad-1"]).toBeNull();
    expect(state.currentVoice["pad-2"]).toEqual({ ...b, seq: 2 });
  });
});

describe("clearAllPadDisplays", () => {
  it("clears every pad's currentVoice and voiceQueue", () => {
    const a = makeInfo({ soundName: "a" });
    const b = makeInfo({ soundName: "b" });
    const c = makeInfo({ soundName: "c" });

    usePadDisplayStore.getState().enqueueVoice("pad-1", a);
    usePadDisplayStore.getState().enqueueVoice("pad-1", b);
    usePadDisplayStore.getState().enqueueVoice("pad-2", c);

    usePadDisplayStore.getState().clearAllPadDisplays();

    const state = usePadDisplayStore.getState();
    expect(state.currentVoice).toEqual({});
    expect(state.voiceQueue).toEqual({});
  });
});
