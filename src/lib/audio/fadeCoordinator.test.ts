import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Imports ──────────────────────────────────────────────────────────────────

import {
  startFade,
  cancelFade,
  addFadingIn,
  removeFadingIn,
  isFading,
  isFadingOut,
  isFadingIn,
  getFadeFromVolume,
  isAnyFadeActive,
  clearAllFades,
} from "./fadeCoordinator";
import { usePlaybackStore, initialPlaybackState } from "@/state/playbackStore";

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  // Bulk reset between tests so prior fades / store state never leak.
  clearAllFades();
  usePlaybackStore.setState({ ...initialPlaybackState });
});

afterEach(() => {
  vi.useRealTimers();
});

// ── cancelFade ───────────────────────────────────────────────────────────────

describe("cancelFade", () => {
  it("is idempotent when no fade is active", () => {
    expect(() => cancelFade("pad-1")).not.toThrow();
    expect(isFading("pad-1")).toBe(false);
    expect(isFadingOut("pad-1")).toBe(false);
    expect(getFadeFromVolume("pad-1")).toBeUndefined();
  });

  it("clears all state when a fade is active", () => {
    startFade("pad-1", 0.7, true, 500);
    expect(isFading("pad-1")).toBe(true);
    expect(isFadingOut("pad-1")).toBe(true);
    expect(getFadeFromVolume("pad-1")).toBe(0.7);
    expect(usePlaybackStore.getState().fadingPadIds.has("pad-1")).toBe(true);
    expect(usePlaybackStore.getState().fadingOutPadIds.has("pad-1")).toBe(true);

    cancelFade("pad-1");

    expect(isFading("pad-1")).toBe(false);
    expect(isFadingOut("pad-1")).toBe(false);
    expect(getFadeFromVolume("pad-1")).toBeUndefined();
    expect(usePlaybackStore.getState().fadingPadIds.has("pad-1")).toBe(false);
    expect(usePlaybackStore.getState().fadingOutPadIds.has("pad-1")).toBe(false);
  });
});

// ── startFade ────────────────────────────────────────────────────────────────

describe("startFade", () => {
  it("marks isFading and stores fromVolume when fadingOut=false", () => {
    startFade("pad-up", 0.2, false, 1000);

    expect(isFading("pad-up")).toBe(true);
    expect(isFadingOut("pad-up")).toBe(false);
    expect(getFadeFromVolume("pad-up")).toBe(0.2);
    expect(usePlaybackStore.getState().fadingPadIds.has("pad-up")).toBe(true);
    expect(usePlaybackStore.getState().fadingOutPadIds.has("pad-up")).toBe(false);
  });

  it("marks isFadingOut and updates playbackStore when fadingOut=true", () => {
    startFade("pad-down", 1.0, true, 1000);

    expect(isFadingOut("pad-down")).toBe(true);
    expect(usePlaybackStore.getState().fadingOutPadIds.has("pad-down")).toBe(true);
    expect(usePlaybackStore.getState().fadingPadIds.has("pad-down")).toBe(true);
  });

  it("timeout fires — calls onComplete and clears state", () => {
    const onComplete = vi.fn();
    startFade("pad-1", 1.0, true, 500, onComplete);

    vi.advanceTimersByTime(600);

    expect(onComplete).toHaveBeenCalledOnce();
    expect(isFading("pad-1")).toBe(false);
    expect(isFadingOut("pad-1")).toBe(false);
    expect(getFadeFromVolume("pad-1")).toBeUndefined();
    expect(usePlaybackStore.getState().fadingPadIds.has("pad-1")).toBe(false);
    expect(usePlaybackStore.getState().fadingOutPadIds.has("pad-1")).toBe(false);
  });

  it("fade-up timeout fires — onComplete called and state cleared", () => {
    const onComplete = vi.fn();
    startFade("pad-up", 0.2, false, 500, onComplete);

    vi.advanceTimersByTime(600);

    expect(onComplete).toHaveBeenCalledOnce();
    expect(isFading("pad-up")).toBe(false);
    expect(getFadeFromVolume("pad-up")).toBeUndefined();
    expect(usePlaybackStore.getState().fadingPadIds.has("pad-up")).toBe(false);
  });

  it("re-startFade cancels first timeout and starts fresh", () => {
    const firstOnComplete = vi.fn();
    const secondOnComplete = vi.fn();

    startFade("pad-1", 1.0, true, 500, firstOnComplete);
    startFade("pad-1", 0.5, false, 1000, secondOnComplete);

    // The first fade's timeout was 500ms — even after that elapses, its onComplete
    // must NOT have been called because startFade cancelled it.
    vi.advanceTimersByTime(600);
    expect(firstOnComplete).not.toHaveBeenCalled();
    expect(isFading("pad-1")).toBe(true);
    expect(isFadingOut("pad-1")).toBe(false); // re-started with fadingOut=false
    expect(getFadeFromVolume("pad-1")).toBe(0.5);

    // Advance past the second fade's 1000ms duration (already 600ms elapsed)
    vi.advanceTimersByTime(500);
    expect(secondOnComplete).toHaveBeenCalledOnce();
  });
});

// ── addFadingIn / removeFadingIn / isFadingIn ────────────────────────────────

describe("fading-in tracking", () => {
  it("addFadingIn / removeFadingIn / isFadingIn — set and clear correctly", () => {
    expect(isFadingIn("pad-1")).toBe(false);

    addFadingIn("pad-1");
    expect(isFadingIn("pad-1")).toBe(true);

    removeFadingIn("pad-1");
    expect(isFadingIn("pad-1")).toBe(false);
  });

  it("isFadingIn stays true across cancelFade", () => {
    addFadingIn("pad-1");
    expect(isFadingIn("pad-1")).toBe(true);

    cancelFade("pad-1");

    // cancelFade must NOT touch fadingIn — triggerPad calls cancelFade
    // internally and must not pre-empt a triggerAndFade still in flight.
    expect(isFadingIn("pad-1")).toBe(true);
  });

  it("startFade clears fadingIn (explicit reversal)", () => {
    addFadingIn("pad-1");
    expect(isFadingIn("pad-1")).toBe(true);

    startFade("pad-1", 0.5, true, 500);

    expect(isFadingIn("pad-1")).toBe(false);
  });
});

// ── clearAllFades ────────────────────────────────────────────────────────────

describe("clearAllFades", () => {
  it("clears all state including fadingIn", () => {
    startFade("pad-1", 0.5, true, 500);
    startFade("pad-2", 0.7, false, 500);
    addFadingIn("pad-3");

    clearAllFades();

    expect(isFading("pad-1")).toBe(false);
    expect(isFadingOut("pad-1")).toBe(false);
    expect(getFadeFromVolume("pad-1")).toBeUndefined();
    expect(isFading("pad-2")).toBe(false);
    expect(getFadeFromVolume("pad-2")).toBeUndefined();
    expect(isFadingIn("pad-3")).toBe(false);
  });

  it("cancels timeouts before clearing — onComplete callbacks do not fire", () => {
    const onComplete = vi.fn();
    startFade("pad-1", 1.0, true, 500, onComplete);

    clearAllFades();

    vi.advanceTimersByTime(1000);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("cancels callbacks for all pads", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    startFade("pad-1", 1.0, true, 500, cb1);
    startFade("pad-2", 0.5, false, 500, cb2);

    clearAllFades();

    vi.advanceTimersByTime(1000);
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).not.toHaveBeenCalled();
  });
});

// ── getFadeFromVolume ────────────────────────────────────────────────────────

describe("getFadeFromVolume", () => {
  it("returns the stored value, undefined after cancelFade", () => {
    startFade("pad-1", 0.42, false, 500);
    expect(getFadeFromVolume("pad-1")).toBe(0.42);

    cancelFade("pad-1");
    expect(getFadeFromVolume("pad-1")).toBeUndefined();
  });
});

// ── isAnyFadeActive ──────────────────────────────────────────────────────────

describe("isAnyFadeActive", () => {
  it("is false in steady state", () => {
    expect(isAnyFadeActive()).toBe(false);
  });

  it("is true while a fade is active", () => {
    startFade("pad-1", 1.0, true, 500);
    expect(isAnyFadeActive()).toBe(true);
  });

  it("is true while a pad is fading-in (async gap)", () => {
    addFadingIn("pad-1");
    expect(isAnyFadeActive()).toBe(true);
  });

  it("is false after cancelFade (when no other fades / fading-in remain)", () => {
    startFade("pad-1", 1.0, true, 500);
    cancelFade("pad-1");
    expect(isAnyFadeActive()).toBe(false);
  });
});
