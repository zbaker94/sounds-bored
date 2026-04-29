/**
 * Integration tests verifying the REAL playbackStore has subscribeWithSelector
 * middleware active. audioTick.ts uses the selector overload to wire masterVolume
 * changes to the audio context gain node — if the middleware is removed, the
 * subscription silently stops filtering and every tick update would retrigger
 * the master gain setter, re-introducing issue #60.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { usePlaybackStore, initialPlaybackState } from "@/state/playbackStore";

// ── AudioContext mock ─────────────────────────────────────────────────────────

function MockAudioContext(this: any) {
  this.createGain = vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn() }));
  this.destination = {};
  this.state = "running";
  this.resume = vi.fn();
}
vi.stubGlobal("AudioContext", MockAudioContext);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("playbackStore — subscribeWithSelector middleware is active", () => {
  beforeEach(() => {
    usePlaybackStore.setState({ ...initialPlaybackState, masterVolume: 100 });
  });

  it("selector subscription fires ONLY when the selected value changes", () => {
    // Directly verifies the store has subscribeWithSelector middleware applied.
    // Without the middleware, subscribe(selector, callback) would treat selector
    // as the full-state listener and callback would never be invoked, making
    // the positive assertion fail even after setMasterVolume.
    let callCount = 0;
    const unsubscribe = usePlaybackStore.subscribe(
      (s) => s.masterVolume,
      () => { callCount++; },
    );

    // Unrelated state changes must NOT fire the selector callback
    usePlaybackStore.getState().addPlayingPad("pad-1");
    usePlaybackStore.getState().setAudioTick({ padVolumes: { "pad-1": 0.3 } });
    expect(callCount).toBe(0);

    // masterVolume change MUST fire the selector callback
    usePlaybackStore.getState().setMasterVolume(50);
    expect(callCount).toBe(1);

    unsubscribe();
  });

  it("selector callback receives the new and previous selected values", () => {
    let receivedNext: number | undefined;
    let receivedPrev: number | undefined;

    const unsubscribe = usePlaybackStore.subscribe(
      (s) => s.masterVolume,
      (next, prev) => { receivedNext = next; receivedPrev = prev; },
    );

    usePlaybackStore.getState().setMasterVolume(70);
    expect(receivedNext).toBe(70);
    expect(receivedPrev).toBe(100);

    unsubscribe();
  });
});
