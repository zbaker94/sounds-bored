import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRemoveMissing } from "./useRemoveMissing";
import { createMockSound, createMockGlobalFolder } from "@/test/factories";

describe("useRemoveMissing", () => {
  it("starts with empty queues", () => {
    const { result } = renderHook(() => useRemoveMissing());
    expect(result.current.soundDialogQueue).toEqual([]);
    expect(result.current.folderDialogQueue).toEqual([]);
  });

  it("allows pushing to the sound queue via setter", () => {
    const { result } = renderHook(() => useRemoveMissing());
    const a = createMockSound({ id: "a" });
    const b = createMockSound({ id: "b" });

    act(() => {
      result.current.setSoundDialogQueue([a, b]);
    });
    expect(result.current.soundDialogQueue.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("advances the sound queue when resolved + closed", () => {
    const { result } = renderHook(() => useRemoveMissing());
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

  it("clears the sound queue when closed without resolving", () => {
    const { result } = renderHook(() => useRemoveMissing());
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
    const { result } = renderHook(() => useRemoveMissing());
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

  it("advances the folder queue when resolved + closed", () => {
    const { result } = renderHook(() => useRemoveMissing());
    const f1 = createMockGlobalFolder({ id: "f1" });
    const f2 = createMockGlobalFolder({ id: "f2" });

    act(() => {
      result.current.setFolderDialogQueue([f1, f2]);
    });

    act(() => {
      result.current.handleFolderDialogResolved();
    });
    act(() => {
      result.current.handleFolderDialogClose();
    });

    expect(result.current.folderDialogQueue.map((f) => f.id)).toEqual(["f2"]);
  });

  it("clears the folder queue when closed without resolving", () => {
    const { result } = renderHook(() => useRemoveMissing());
    const f1 = createMockGlobalFolder({ id: "f1" });
    const f2 = createMockGlobalFolder({ id: "f2" });

    act(() => {
      result.current.setFolderDialogQueue([f1, f2]);
    });

    act(() => {
      result.current.handleFolderDialogClose();
    });

    expect(result.current.folderDialogQueue).toEqual([]);
  });

  it("resets folderWasResolved flag between invocations so a close-only event clears the chain", () => {
    const { result } = renderHook(() => useRemoveMissing());
    const f1 = createMockGlobalFolder({ id: "f1" });
    const f2 = createMockGlobalFolder({ id: "f2" });

    act(() => {
      result.current.setFolderDialogQueue([f1, f2]);
    });

    // First dialog: resolve + close → advance to [f2]
    act(() => {
      result.current.handleFolderDialogResolved();
    });
    act(() => {
      result.current.handleFolderDialogClose();
    });
    expect(result.current.folderDialogQueue.map((f) => f.id)).toEqual(["f2"]);

    // Second dialog: close without resolving → queue cleared (resolved flag
    // was properly reset, so close-only does not mistakenly advance)
    act(() => {
      result.current.handleFolderDialogClose();
    });
    expect(result.current.folderDialogQueue).toEqual([]);
  });

  it("handles multi-step review chain: resolve-resolve-bail clears queue", () => {
    const { result } = renderHook(() => useRemoveMissing());
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
