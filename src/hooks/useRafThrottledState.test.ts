import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRafThrottledState } from "./useRafThrottledState";

describe("useRafThrottledState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns initialValue before any schedule call", () => {
    const { result } = renderHook(() => useRafThrottledState<number | null>(null));
    expect(result.current.value).toBe(null);
  });

  it("updates value after RAF flush", () => {
    const { result } = renderHook(() => useRafThrottledState<number>(0));

    act(() => {
      result.current.schedule(42);
      vi.runAllTimers();
    });

    expect(result.current.value).toBe(42);
  });

  it("multiple schedule calls within one frame coalesce: only final value is ever observed and only one RAF is scheduled", () => {
    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame");
    const seenValues: number[] = [];
    const { result } = renderHook(() => {
      const r = useRafThrottledState<number>(0);
      seenValues.push(r.value);
      return r;
    });
    // seenValues = [0] (initial render)
    rafSpy.mockClear(); // reset after initial hook setup

    act(() => {
      result.current.schedule(1);
      result.current.schedule(2);
      result.current.schedule(3);
      vi.runAllTimers();
    });

    // Value transitions directly from 0 to 3 — intermediate values 1 and 2 never appear.
    expect(result.current.value).toBe(3);
    expect(seenValues).toEqual([0, 3]);
    // Only one RAF was scheduled despite three schedule() calls.
    expect(rafSpy).toHaveBeenCalledTimes(1);
    rafSpy.mockRestore();
  });

  it("re-arms RAF for each subsequent frame", () => {
    const { result } = renderHook(() => useRafThrottledState<number>(0));

    act(() => { result.current.schedule(1); vi.runAllTimers(); });
    expect(result.current.value).toBe(1);

    act(() => { result.current.schedule(2); vi.runAllTimers(); });
    expect(result.current.value).toBe(2);

    act(() => { result.current.schedule(3); vi.runAllTimers(); });
    expect(result.current.value).toBe(3);
  });

  it("cancel prevents pending RAF from updating value", () => {
    const { result } = renderHook(() => useRafThrottledState<number>(0));

    act(() => {
      result.current.schedule(42);
      result.current.cancel();
      vi.runAllTimers();
    });

    expect(result.current.value).toBe(0);
  });

  it("schedule works normally after cancel", () => {
    const { result } = renderHook(() => useRafThrottledState<number>(0));

    act(() => {
      result.current.schedule(42);
      result.current.cancel();
      result.current.schedule(99);
      vi.runAllTimers();
    });

    expect(result.current.value).toBe(99);
  });

  it("reset cancels pending RAF and synchronously resets to initialValue", () => {
    const { result } = renderHook(() => useRafThrottledState<number | null>(null));

    // Schedule a value and flush so it's live.
    act(() => {
      result.current.schedule(42);
      vi.runAllTimers();
    });
    expect(result.current.value).toBe(42);

    // Schedule another update, then reset before the RAF fires.
    act(() => {
      result.current.schedule(99);
      result.current.reset();
      vi.runAllTimers(); // RAF already cancelled; flush is a no-op
    });

    expect(result.current.value).toBe(null);
  });

  it("schedule works normally after reset", () => {
    const { result } = renderHook(() => useRafThrottledState<number | null>(null));

    act(() => {
      result.current.schedule(42);
      vi.runAllTimers();
    });
    act(() => { result.current.reset(); });
    expect(result.current.value).toBe(null);

    act(() => { result.current.schedule(99); vi.runAllTimers(); });
    expect(result.current.value).toBe(99);
  });

  it("cancel on idle hook does not throw", () => {
    const { result } = renderHook(() => useRafThrottledState<number>(0));

    expect(() => {
      act(() => { result.current.cancel(); });
    }).not.toThrow();
  });

  it("reset on idle hook does not throw and restores initialValue", () => {
    const { result } = renderHook(() => useRafThrottledState<number | null>(null));

    act(() => {
      result.current.schedule(42);
      vi.runAllTimers();
    });
    expect(result.current.value).toBe(42);

    expect(() => {
      act(() => { result.current.reset(); });
    }).not.toThrow();

    expect(result.current.value).toBe(null);
  });

  it("unmount cancels pending RAF via useEffect cleanup", () => {
    const cafSpy = vi.spyOn(globalThis, "cancelAnimationFrame");
    const { result, unmount } = renderHook(() => useRafThrottledState<number>(0));

    act(() => {
      result.current.schedule(42);
      // Leave RAF pending — do NOT flush.
    });

    expect(() => unmount()).not.toThrow();
    expect(cafSpy).toHaveBeenCalledWith(expect.any(Number));
    cafSpy.mockRestore();
  });

  it("cancel on idle hook after unmount does not throw", () => {
    const { result, unmount } = renderHook(() => useRafThrottledState<number>(0));

    act(() => {
      result.current.schedule(1);
      vi.runAllTimers();
    });

    unmount();

    expect(() => {
      act(() => { result.current.cancel(); });
    }).not.toThrow();
  });

  it("schedule, cancel, and reset references are stable across renders", () => {
    const { result, rerender } = renderHook(() => useRafThrottledState<number>(0));
    const first = {
      schedule: result.current.schedule,
      cancel: result.current.cancel,
      reset: result.current.reset,
    };

    act(() => {
      result.current.schedule(1);
      vi.runAllTimers();
    });
    rerender();

    expect(result.current.schedule).toBe(first.schedule);
    expect(result.current.cancel).toBe(first.cancel);
    expect(result.current.reset).toBe(first.reset);
  });

  it("reset uses first-render initialValue even when initialValue prop changes on rerender", () => {
    const { result, rerender } = renderHook(
      ({ init }: { init: number }) => useRafThrottledState<number>(init),
      { initialProps: { init: 0 } },
    );
    const firstReset = result.current.reset;

    act(() => {
      result.current.schedule(42);
      vi.runAllTimers();
    });

    // Pass a new initialValue — should be ignored by cancel/reset (first-render-only contract).
    rerender({ init: 999 });
    expect(result.current.reset).toBe(firstReset); // still same stable ref

    act(() => { result.current.reset(); });
    expect(result.current.value).toBe(0); // first-render value, not 999
  });
});
