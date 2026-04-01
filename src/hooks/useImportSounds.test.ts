import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useImportSounds } from "./useImportSounds";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { createMockGlobalFolder, createMockSound } from "@/test/factories";

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/import", () => ({
  copyFilesToFolder: vi.fn(),
  tagImportedSounds: vi.fn(),
}));

vi.mock("@/lib/library.reconcile", () => ({
  reconcileGlobalLibrary: vi.fn(),
}));

const mockMutate = vi.fn();
vi.mock("@/lib/library.queries", () => ({
  useSaveGlobalLibrary: vi.fn(() => ({ mutateAsync: mockMutate })),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

import { copyFilesToFolder, tagImportedSounds } from "@/lib/import";
import { reconcileGlobalLibrary } from "@/lib/library.reconcile";

const mockCopy = copyFilesToFolder as ReturnType<typeof vi.fn>;
const mockReconcile = reconcileGlobalLibrary as ReturnType<typeof vi.fn>;
const mockTag = tagImportedSounds as ReturnType<typeof vi.fn>;

function makeFolder() {
  return createMockGlobalFolder({ id: "f1", path: "/sounds" });
}

beforeEach(() => {
  useLibraryStore.setState({ ...initialLibraryState });
  mockCopy.mockReset();
  mockReconcile.mockReset();
  mockTag.mockReset();
  mockMutate.mockReset();
});

describe("useImportSounds", () => {
  it("returns 0 and does nothing when importFolder is undefined", async () => {
    const { result } = renderHook(() =>
      useImportSounds(undefined, [])
    );
    let count: number;
    await act(async () => {
      count = await result.current(["/file.wav"]);
    });
    expect(count!).toBe(0);
    expect(mockCopy).not.toHaveBeenCalled();
  });

  it("returns 0 when no files were copied", async () => {
    mockCopy.mockResolvedValue([]);
    const folder = makeFolder();
    const { result } = renderHook(() => useImportSounds(folder, [folder]));
    let count: number;
    await act(async () => {
      count = await result.current(["/file.wav"]);
    });
    expect(count!).toBe(0);
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it("reconciles, tags, and saves when files are copied and library changed", async () => {
    const sound = createMockSound({ id: "s1" });
    useLibraryStore.setState({ ...initialLibraryState, sounds: [sound] });
    mockCopy.mockResolvedValue(["/sounds/file.wav"]);
    const newSound = createMockSound({ id: "s2" });
    mockReconcile.mockResolvedValue({ changed: true, sounds: [sound, newSound] });
    mockMutate.mockResolvedValue(undefined);

    const folder = makeFolder();
    const { result } = renderHook(() => useImportSounds(folder, [folder]));
    let count: number;
    await act(async () => {
      count = await result.current(["/file.wav"]);
    });

    expect(count!).toBe(1);
    expect(mockReconcile).toHaveBeenCalled();
    expect(mockTag).toHaveBeenCalledWith(
      [sound],           // soundsBeforeImport
      [sound, newSound], // soundsAfterImport
      expect.any(Function), // ensureTagExists
      expect.any(Function), // systemAssignTagsToSounds
    );
    expect(mockMutate).toHaveBeenCalled();
  });

  it("does not save when reconcile reports no changes", async () => {
    const sound = createMockSound({ id: "s1" });
    useLibraryStore.setState({ ...initialLibraryState, sounds: [sound] });
    mockCopy.mockResolvedValue(["/sounds/file.wav"]);
    mockReconcile.mockResolvedValue({ changed: false, sounds: [sound] });

    const folder = makeFolder();
    const { result } = renderHook(() => useImportSounds(folder, [folder]));
    await act(async () => {
      await result.current(["/file.wav"]);
    });

    expect(mockMutate).not.toHaveBeenCalled();
  });
});
