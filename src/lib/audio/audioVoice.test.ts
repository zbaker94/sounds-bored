import { describe, it, expect, vi } from "vitest";
import { wrapBufferSource, wrapStreamingElement } from "./audioVoice";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockSource() {
  let endedCb: ((ev: Event) => any) | null = null;
  return {
    start: vi.fn(),
    stop: vi.fn(),
    connect: vi.fn(),
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
    /** Simulate natural end of playback (fires onended). */
    simulateEnd() { endedCb?.(new Event("ended")); },
  };
}

// ── wrapBufferSource ──────────────────────────────────────────────────────────

describe("wrapBufferSource", () => {
  it("start() calls source.start()", async () => {
    const source = makeMockSource();
    const voice = wrapBufferSource(source as any);
    await voice.start();
    expect(source.start).toHaveBeenCalledOnce();
  });

  it("stop() calls source.stop()", () => {
    const source = makeMockSource();
    const voice = wrapBufferSource(source as any);
    voice.stop();
    expect(source.stop).toHaveBeenCalledOnce();
  });

  it("stop() does not throw if source.stop() throws (already ended)", () => {
    const source = makeMockSource();
    source.stop.mockImplementation(() => { throw new Error("already ended"); });
    const voice = wrapBufferSource(source as any);
    expect(() => voice.stop()).not.toThrow();
  });

  it("setOnEnded wires callback to source.onended", () => {
    const source = makeMockSource();
    const voice = wrapBufferSource(source as any);
    const cb = vi.fn();
    voice.setOnEnded(cb);
    source.onended?.(new Event("ended"));
    expect(cb).toHaveBeenCalledOnce();
  });

  it("setOnEnded(null) clears callback", () => {
    const source = makeMockSource();
    const voice = wrapBufferSource(source as any);
    voice.setOnEnded(vi.fn());
    voice.setOnEnded(null);
    expect(source.onended).toBeNull();
  });

  it("stop() fires the onended callback synchronously", () => {
    const source = makeMockSource();
    const voice = wrapBufferSource(source as any);
    const cb = vi.fn();
    voice.setOnEnded(cb);
    voice.stop();
    expect(cb).toHaveBeenCalledOnce();
  });

  it("stop() fires onended exactly once — Web Audio ended event after stop is ignored", () => {
    const source = makeMockSource();
    const voice = wrapBufferSource(source as any);
    const cb = vi.fn();
    voice.setOnEnded(cb);
    voice.stop();
    // Simulate Web Audio's async onended firing after stop — should be a no-op
    // because stop() cleared source.onended before calling source.stop().
    source.onended?.(new Event("ended"));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("setOnEnded can be re-registered — only the new callback fires", () => {
    const source = makeMockSource();
    const voice = wrapBufferSource(source as any);
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    voice.setOnEnded(cb1);
    voice.setOnEnded(cb2);
    // Simulate natural end via source.onended
    source.onended?.(new Event("ended"));
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledOnce();
  });
});

// ── wrapStreamingElement ──────────────────────────────────────────────────────

describe("wrapStreamingElement", () => {
  it("start() calls audio.play()", async () => {
    const audio = makeMockAudio();
    const voice = wrapStreamingElement(audio as any);
    await voice.start();
    expect(audio.play).toHaveBeenCalledOnce();
  });

  it("stop() pauses the audio element", () => {
    const audio = makeMockAudio();
    const voice = wrapStreamingElement(audio as any);
    voice.stop();
    expect(audio.pause).toHaveBeenCalledOnce();
  });

  it("stop() seeks audio back to 0", () => {
    const audio = makeMockAudio();
    const voice = wrapStreamingElement(audio as any);
    audio.currentTime = 42;
    voice.stop();
    expect(audio.currentTime).toBe(0);
  });

  it("stop() fires the onended callback synchronously", () => {
    const audio = makeMockAudio();
    const voice = wrapStreamingElement(audio as any);
    const cb = vi.fn();
    voice.setOnEnded(cb);
    voice.stop();
    expect(cb).toHaveBeenCalledOnce();
  });

  it("stop() does not throw when no onended callback is set", () => {
    const audio = makeMockAudio();
    const voice = wrapStreamingElement(audio as any);
    expect(() => voice.stop()).not.toThrow();
  });

  it("stop() fires onended exactly once — not again on natural end after stop", () => {
    const audio = makeMockAudio();
    const voice = wrapStreamingElement(audio as any);
    const cb = vi.fn();
    voice.setOnEnded(cb);
    voice.stop();
    audio.simulateEnd(); // natural end after stop should be a no-op
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("natural audio end fires the onended callback", () => {
    const audio = makeMockAudio();
    const voice = wrapStreamingElement(audio as any);
    const cb = vi.fn();
    voice.setOnEnded(cb);
    audio.simulateEnd();
    expect(cb).toHaveBeenCalledOnce();
  });

  it("setOnEnded(null) removes the callback — natural end is a no-op", () => {
    const audio = makeMockAudio();
    const voice = wrapStreamingElement(audio as any);
    const cb = vi.fn();
    voice.setOnEnded(cb);
    voice.setOnEnded(null);
    audio.simulateEnd();
    expect(cb).not.toHaveBeenCalled();
  });

  it("setOnEnded can be re-registered — only the new callback fires", () => {
    const audio = makeMockAudio();
    const voice = wrapStreamingElement(audio as any);
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    voice.setOnEnded(cb1);
    voice.setOnEnded(cb2);
    audio.simulateEnd();
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledOnce();
  });
});
