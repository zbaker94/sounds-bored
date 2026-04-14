import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useResolveQueue } from "./useResolveQueue";

describe("useResolveQueue", () => {
  it("starts with an empty queue", () => {
    const { result } = renderHook(() => useResolveQueue<string>());
    expect(result.current.queue).toEqual([]);
  });

  it("allows setting the queue via setter", () => {
    const { result } = renderHook(() => useResolveQueue<string>());
    act(() => {
      result.current.setQueue(["a", "b"]);
    });
    expect(result.current.queue).toEqual(["a", "b"]);
  });

  it("advances the queue (slice head) when resolved then closed", () => {
    const { result } = renderHook(() => useResolveQueue<string>());
    act(() => { result.current.setQueue(["a", "b"]); });
    act(() => { result.current.handleResolved(); });
    act(() => { result.current.handleClose(); });
    expect(result.current.queue).toEqual(["b"]);
  });

  it("clears the queue when closed without resolving", () => {
    const { result } = renderHook(() => useResolveQueue<string>());
    act(() => { result.current.setQueue(["a", "b"]); });
    act(() => { result.current.handleClose(); });
    expect(result.current.queue).toEqual([]);
  });

  it("resets the resolved flag between invocations so a close-only event clears the chain", () => {
    const { result } = renderHook(() => useResolveQueue<string>());
    act(() => { result.current.setQueue(["a", "b", "c"]); });

    // First: resolve + close → advance to [b, c]
    act(() => { result.current.handleResolved(); });
    act(() => { result.current.handleClose(); });
    expect(result.current.queue).toEqual(["b", "c"]);

    // Second: close without resolving → cleared
    act(() => { result.current.handleClose(); });
    expect(result.current.queue).toEqual([]);
  });

  it("resolving the last item transitions to an empty queue", () => {
    const { result } = renderHook(() => useResolveQueue<string>());
    act(() => { result.current.setQueue(["only"]); });
    act(() => { result.current.handleResolved(); });
    act(() => { result.current.handleClose(); });
    expect(result.current.queue).toEqual([]);
  });

  it("handles multi-step review chain: resolve-resolve-bail", () => {
    const { result } = renderHook(() => useResolveQueue<string>());
    act(() => { result.current.setQueue(["a", "b", "c"]); });

    act(() => { result.current.handleResolved(); });
    act(() => { result.current.handleClose(); });
    expect(result.current.queue).toEqual(["b", "c"]);

    act(() => { result.current.handleResolved(); });
    act(() => { result.current.handleClose(); });
    expect(result.current.queue).toEqual(["c"]);

    act(() => { result.current.handleClose(); });
    expect(result.current.queue).toEqual([]);
  });
});
