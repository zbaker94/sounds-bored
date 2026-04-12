import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useResolveFolderQueue } from "./useResolveFolderQueue";
import { createMockGlobalFolder } from "@/test/factories";

describe("useResolveFolderQueue", () => {
  it("starts with an empty queue", () => {
    const { result } = renderHook(() => useResolveFolderQueue());
    expect(result.current.folderDialogQueue).toEqual([]);
  });

  it("allows pushing to the folder queue via setter", () => {
    const { result } = renderHook(() => useResolveFolderQueue());
    const f1 = createMockGlobalFolder({ id: "f1" });
    const f2 = createMockGlobalFolder({ id: "f2" });

    act(() => {
      result.current.setFolderDialogQueue([f1, f2]);
    });
    expect(result.current.folderDialogQueue.map((f) => f.id)).toEqual([
      "f1",
      "f2",
    ]);
  });

  it("advances the queue when resolved + closed", () => {
    const { result } = renderHook(() => useResolveFolderQueue());
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

  it("clears the queue when closed without resolving", () => {
    const { result } = renderHook(() => useResolveFolderQueue());
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

  it("resets the resolved flag between invocations so a close-only event clears the chain", () => {
    const { result } = renderHook(() => useResolveFolderQueue());
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
    const { result } = renderHook(() => useResolveFolderQueue());
    const f1 = createMockGlobalFolder({ id: "f1" });
    const f2 = createMockGlobalFolder({ id: "f2" });
    const f3 = createMockGlobalFolder({ id: "f3" });

    act(() => {
      result.current.setFolderDialogQueue([f1, f2, f3]);
    });
    expect(result.current.folderDialogQueue.map((f) => f.id)).toEqual([
      "f1",
      "f2",
      "f3",
    ]);

    // Step 1: resolve + close f1 → queue [f2, f3]
    act(() => {
      result.current.handleFolderDialogResolved();
    });
    act(() => {
      result.current.handleFolderDialogClose();
    });
    expect(result.current.folderDialogQueue.map((f) => f.id)).toEqual([
      "f2",
      "f3",
    ]);

    // Step 2: resolve + close f2 → queue [f3]
    act(() => {
      result.current.handleFolderDialogResolved();
    });
    act(() => {
      result.current.handleFolderDialogClose();
    });
    expect(result.current.folderDialogQueue.map((f) => f.id)).toEqual(["f3"]);

    // Step 3: close f3 WITHOUT resolving (bail) → queue cleared
    act(() => {
      result.current.handleFolderDialogClose();
    });
    expect(result.current.folderDialogQueue).toEqual([]);
  });
});
