import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useResolveSoundQueue } from "./useResolveSoundQueue";
import { createMockSound } from "@/test/factories";

describe("useResolveSoundQueue", () => {
  it("starts with an empty queue", () => {
    const { result } = renderHook(() => useResolveSoundQueue());
    expect(result.current.soundDialogQueue).toEqual([]);
  });

  it("allows pushing to the sound queue via setter", () => {
    const { result } = renderHook(() => useResolveSoundQueue());
    const a = createMockSound({ id: "a" });
    const b = createMockSound({ id: "b" });

    act(() => {
      result.current.setSoundDialogQueue([a, b]);
    });
    expect(result.current.soundDialogQueue.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("advances the queue when resolved + closed", () => {
    const { result } = renderHook(() => useResolveSoundQueue());
    const a = createMockSound({ id: "a" });
    const b = createMockSound({ id: "b" });

    act(() => {
      result.current.setSoundDialogQueue([a, b]);
    });

    act(() => {
      result.current.handleSoundDialogResolved();
    });
    act(() => {
      result.current.handleSoundDialogClose();
    });

    expect(result.current.soundDialogQueue.map((s) => s.id)).toEqual(["b"]);
  });

  it("clears the queue when closed without resolving", () => {
    const { result } = renderHook(() => useResolveSoundQueue());
    const a = createMockSound({ id: "a" });
    const b = createMockSound({ id: "b" });

    act(() => {
      result.current.setSoundDialogQueue([a, b]);
    });

    act(() => {
      result.current.handleSoundDialogClose();
    });

    expect(result.current.soundDialogQueue).toEqual([]);
  });

  it("resets the resolved flag between invocations so a close-only event clears the chain", () => {
    const { result } = renderHook(() => useResolveSoundQueue());
    const a = createMockSound({ id: "a" });
    const b = createMockSound({ id: "b" });
    const c = createMockSound({ id: "c" });

    act(() => {
      result.current.setSoundDialogQueue([a, b, c]);
    });

    // First dialog: resolve + close → advance to [b, c]
    act(() => {
      result.current.handleSoundDialogResolved();
    });
    act(() => {
      result.current.handleSoundDialogClose();
    });
    expect(result.current.soundDialogQueue.map((s) => s.id)).toEqual(["b", "c"]);

    // Second dialog: close without resolving → queue cleared
    act(() => {
      result.current.handleSoundDialogClose();
    });
    expect(result.current.soundDialogQueue).toEqual([]);
  });

  it("handles multi-step review chain: resolve-resolve-bail clears queue", () => {
    const { result } = renderHook(() => useResolveSoundQueue());
    const a = createMockSound({ id: "a" });
    const b = createMockSound({ id: "b" });
    const c = createMockSound({ id: "c" });

    act(() => {
      result.current.setSoundDialogQueue([a, b, c]);
    });
    expect(result.current.soundDialogQueue.map((s) => s.id)).toEqual([
      "a",
      "b",
      "c",
    ]);

    // Step 1: resolve + close a → queue [b, c]
    act(() => {
      result.current.handleSoundDialogResolved();
    });
    act(() => {
      result.current.handleSoundDialogClose();
    });
    expect(result.current.soundDialogQueue.map((s) => s.id)).toEqual(["b", "c"]);

    // Step 2: resolve + close b → queue [c]
    act(() => {
      result.current.handleSoundDialogResolved();
    });
    act(() => {
      result.current.handleSoundDialogClose();
    });
    expect(result.current.soundDialogQueue.map((s) => s.id)).toEqual(["c"]);

    // Step 3: close c WITHOUT resolving (bail) → queue cleared
    act(() => {
      result.current.handleSoundDialogClose();
    });
    expect(result.current.soundDialogQueue).toEqual([]);
  });
});
