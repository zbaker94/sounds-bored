import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { wrapBufferSource, wrapStreamingElement } from "./audioVoice";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockGain() {
  return {
    gain: {
      value: 1,
      cancelScheduledValues: vi.fn(),
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
  };
}

function makeMockCtx() {
  const gain = makeMockGain();
  return {
    currentTime: 0,
    createGain: vi.fn(() => gain),
    _gain: gain,
  };
}

function makeMockDestination() {
  return { connect: vi.fn() };
}

function makeMockSource() {
  let endedCb: ((ev: Event) => any) | null = null;
  return {
    start: vi.fn(),
    stop: vi.fn(),
    connect: vi.fn(),
    loop: false,
    get onended() { return endedCb; },
    set onended(cb: ((ev: Event) => any) | null) { endedCb = cb; },
  };
}

function makeMockAudio() {
  let endedCb: ((ev: Event) => any) | null = null;
  return {
    currentTime: 0,
    pause: vi.fn(),
    play: vi.fn().mockResolvedValue(undefined),
    get onended() { return endedCb; },
    set onended(cb: ((ev: Event) => any) | null) { endedCb = cb; },
    simulateEnd() { endedCb?.(new Event("ended")); },
  };
}

function makeMockSourceNode() {
  return { connect: vi.fn() };
}

// ── wrapBufferSource ──────────────────────────────────────────────────────────

describe("wrapBufferSource", () => {
  it("start() calls source.start()", async () => {
    const source = makeMockSource();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapBufferSource(source as any, ctx as any, dest as any);
    await voice.start();
    expect(source.start).toHaveBeenCalledOnce();
  });

  it("stop() calls source.stop()", () => {
    const source = makeMockSource();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapBufferSource(source as any, ctx as any, dest as any);
    voice.stop();
    expect(source.stop).toHaveBeenCalledOnce();
  });

  it("stop() does not throw if source.stop() throws (already ended)", () => {
    const source = makeMockSource();
    source.stop.mockImplementation(() => { throw new Error("already ended"); });
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapBufferSource(source as any, ctx as any, dest as any);
    expect(() => voice.stop()).not.toThrow();
  });

  it("setOnEnded wires callback to source.onended", () => {
    const source = makeMockSource();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapBufferSource(source as any, ctx as any, dest as any);
    const cb = vi.fn();
    voice.setOnEnded(cb);
    source.onended?.(new Event("ended"));
    expect(cb).toHaveBeenCalledOnce();
  });

  it("setOnEnded(null) clears callback", () => {
    const source = makeMockSource();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapBufferSource(source as any, ctx as any, dest as any);
    voice.setOnEnded(vi.fn());
    voice.setOnEnded(null);
    expect(source.onended).toBeNull();
  });

  it("stop() fires the onended callback synchronously", () => {
    const source = makeMockSource();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapBufferSource(source as any, ctx as any, dest as any);
    const cb = vi.fn();
    voice.setOnEnded(cb);
    voice.stop();
    expect(cb).toHaveBeenCalledOnce();
  });

  it("stop() fires onended exactly once — Web Audio ended event after stop is ignored", () => {
    const source = makeMockSource();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapBufferSource(source as any, ctx as any, dest as any);
    const cb = vi.fn();
    voice.setOnEnded(cb);
    voice.stop();
    source.onended?.(new Event("ended"));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("setOnEnded can be re-registered — only the new callback fires", () => {
    const source = makeMockSource();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapBufferSource(source as any, ctx as any, dest as any);
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    voice.setOnEnded(cb1);
    voice.setOnEnded(cb2);
    source.onended?.(new Event("ended"));
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledOnce();
  });

  it("creates a voiceGain and connects source → voiceGain → destination", () => {
    const source = makeMockSource();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    wrapBufferSource(source as any, ctx as any, dest as any, 0.8);
    expect(ctx.createGain).toHaveBeenCalledOnce();
    expect(ctx._gain.gain.value).toBe(0.8);
    expect(source.connect).toHaveBeenCalledWith(ctx._gain);
    expect(ctx._gain.connect).toHaveBeenCalledWith(dest);
  });

  it("setVolume updates voiceGain.gain.value", () => {
    const source = makeMockSource();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapBufferSource(source as any, ctx as any, dest as any, 1.0);
    voice.setVolume(0.5);
    expect(ctx._gain.gain.value).toBe(0.5);
  });

  describe("stopWithRamp", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("schedules a gain ramp to 0 then stops the source", () => {
      const source = makeMockSource();
      const ctx = makeMockCtx();
      const dest = makeMockDestination();
      const voice = wrapBufferSource(source as any, ctx as any, dest as any, 1.0);
      voice.stopWithRamp(0.025);
      expect(ctx._gain.gain.cancelScheduledValues).toHaveBeenCalled();
      expect(ctx._gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 0.025);
      expect(source.stop).not.toHaveBeenCalled();
      vi.advanceTimersByTime(30);
      expect(source.stop).toHaveBeenCalledOnce();
    });

    it("fires onended callback after ramp", () => {
      const source = makeMockSource();
      const ctx = makeMockCtx();
      const dest = makeMockDestination();
      const voice = wrapBufferSource(source as any, ctx as any, dest as any, 1.0);
      const cb = vi.fn();
      voice.setOnEnded(cb);
      voice.stopWithRamp(0.025);
      expect(cb).not.toHaveBeenCalled();
      vi.advanceTimersByTime(30);
      expect(cb).toHaveBeenCalledOnce();
    });

    it("does not fire onended if setOnEnded(null) was called before ramp completes", () => {
      const source = makeMockSource();
      const ctx = makeMockCtx();
      const dest = makeMockDestination();
      const voice = wrapBufferSource(source as any, ctx as any, dest as any, 1.0);
      const cb = vi.fn();
      voice.setOnEnded(cb);
      voice.stopWithRamp(0.025);
      voice.setOnEnded(null);
      vi.advanceTimersByTime(30);
      expect(cb).not.toHaveBeenCalled();
    });
  });
});

// ── wrapStreamingElement ──────────────────────────────────────────────────────

describe("wrapStreamingElement", () => {
  it("start() calls audio.play()", async () => {
    const audio = makeMockAudio();
    const sourceNode = makeMockSourceNode();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapStreamingElement(audio as any, sourceNode as any, ctx as any, dest as any);
    await voice.start();
    expect(audio.play).toHaveBeenCalledOnce();
  });

  it("stop() pauses the audio element", () => {
    const audio = makeMockAudio();
    const sourceNode = makeMockSourceNode();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapStreamingElement(audio as any, sourceNode as any, ctx as any, dest as any);
    voice.stop();
    expect(audio.pause).toHaveBeenCalledOnce();
  });

  it("stop() seeks audio back to 0", () => {
    const audio = makeMockAudio();
    const sourceNode = makeMockSourceNode();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapStreamingElement(audio as any, sourceNode as any, ctx as any, dest as any);
    audio.currentTime = 42;
    voice.stop();
    expect(audio.currentTime).toBe(0);
  });

  it("stop() fires the onended callback synchronously", () => {
    const audio = makeMockAudio();
    const sourceNode = makeMockSourceNode();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapStreamingElement(audio as any, sourceNode as any, ctx as any, dest as any);
    const cb = vi.fn();
    voice.setOnEnded(cb);
    voice.stop();
    expect(cb).toHaveBeenCalledOnce();
  });

  it("stop() does not throw when no onended callback is set", () => {
    const audio = makeMockAudio();
    const sourceNode = makeMockSourceNode();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapStreamingElement(audio as any, sourceNode as any, ctx as any, dest as any);
    expect(() => voice.stop()).not.toThrow();
  });

  it("stop() fires onended exactly once — not again on natural end after stop", () => {
    const audio = makeMockAudio();
    const sourceNode = makeMockSourceNode();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapStreamingElement(audio as any, sourceNode as any, ctx as any, dest as any);
    const cb = vi.fn();
    voice.setOnEnded(cb);
    voice.stop();
    audio.simulateEnd();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("natural audio end fires the onended callback", () => {
    const audio = makeMockAudio();
    const sourceNode = makeMockSourceNode();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapStreamingElement(audio as any, sourceNode as any, ctx as any, dest as any);
    const cb = vi.fn();
    voice.setOnEnded(cb);
    audio.simulateEnd();
    expect(cb).toHaveBeenCalledOnce();
  });

  it("setOnEnded(null) removes the callback — natural end is a no-op", () => {
    const audio = makeMockAudio();
    const sourceNode = makeMockSourceNode();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapStreamingElement(audio as any, sourceNode as any, ctx as any, dest as any);
    const cb = vi.fn();
    voice.setOnEnded(cb);
    voice.setOnEnded(null);
    audio.simulateEnd();
    expect(cb).not.toHaveBeenCalled();
  });

  it("setOnEnded can be re-registered — only the new callback fires", () => {
    const audio = makeMockAudio();
    const sourceNode = makeMockSourceNode();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapStreamingElement(audio as any, sourceNode as any, ctx as any, dest as any);
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    voice.setOnEnded(cb1);
    voice.setOnEnded(cb2);
    audio.simulateEnd();
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledOnce();
  });

  it("creates a voiceGain and connects sourceNode → voiceGain → destination", () => {
    const audio = makeMockAudio();
    const sourceNode = makeMockSourceNode();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    wrapStreamingElement(audio as any, sourceNode as any, ctx as any, dest as any, 0.7);
    expect(ctx.createGain).toHaveBeenCalledOnce();
    expect(ctx._gain.gain.value).toBe(0.7);
    expect(sourceNode.connect).toHaveBeenCalledWith(ctx._gain);
    expect(ctx._gain.connect).toHaveBeenCalledWith(dest);
  });

  it("setVolume updates voiceGain.gain.value", () => {
    const audio = makeMockAudio();
    const sourceNode = makeMockSourceNode();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapStreamingElement(audio as any, sourceNode as any, ctx as any, dest as any, 1.0);
    voice.setVolume(0.3);
    expect(ctx._gain.gain.value).toBe(0.3);
  });

  describe("stopWithRamp", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("schedules a gain ramp to 0 then pauses and resets audio", () => {
      const audio = makeMockAudio();
      const sourceNode = makeMockSourceNode();
      const ctx = makeMockCtx();
      const dest = makeMockDestination();
      const voice = wrapStreamingElement(audio as any, sourceNode as any, ctx as any, dest as any, 1.0);
      voice.stopWithRamp(0.025);
      expect(ctx._gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 0.025);
      expect(audio.pause).not.toHaveBeenCalled();
      vi.advanceTimersByTime(30);
      expect(audio.pause).toHaveBeenCalledOnce();
      expect(audio.currentTime).toBe(0);
    });

    it("fires onended callback after ramp", () => {
      const audio = makeMockAudio();
      const sourceNode = makeMockSourceNode();
      const ctx = makeMockCtx();
      const dest = makeMockDestination();
      const voice = wrapStreamingElement(audio as any, sourceNode as any, ctx as any, dest as any, 1.0);
      const cb = vi.fn();
      voice.setOnEnded(cb);
      voice.stopWithRamp(0.025);
      expect(cb).not.toHaveBeenCalled();
      vi.advanceTimersByTime(30);
      expect(cb).toHaveBeenCalledOnce();
    });
  });
});
