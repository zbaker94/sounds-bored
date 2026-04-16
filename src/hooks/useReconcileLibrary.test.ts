import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useReconcileLibrary } from "./useReconcileLibrary";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { useAppSettingsStore, initialAppSettingsState } from "@/state/appSettingsStore";
import { createMockAppSettings } from "@/test/factories";
import { reconcileGlobalLibrary as _reconcileGlobalLibrary } from "@/lib/library.reconcile";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/library.reconcile", () => ({
  reconcileGlobalLibrary: vi.fn(),
  refreshMissingState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/projectSoundReconcile", () => ({
  reconcileProjectSounds: vi.fn().mockReturnValue({ project: null, removedCount: 0 }),
}));

vi.mock("@/lib/library.queries", () => ({
  useSaveCurrentLibrary: () => ({ saveCurrentLibrarySync: vi.fn() }),
}));

const mockReconcileGlobalLibrary = _reconcileGlobalLibrary as ReturnType<typeof vi.fn>;

beforeEach(() => {
  useLibraryStore.setState({ ...initialLibraryState });
  useAppSettingsStore.setState({
    ...initialAppSettingsState,
    settings: createMockAppSettings({ globalFolders: [] }),
  });
  mockReconcileGlobalLibrary.mockReset();
  mockReconcileGlobalLibrary.mockResolvedValue({
    sounds: [],
    inaccessibleFolderIds: [],
  });
});

describe("useReconcileLibrary — isReconciling stored in libraryStore", () => {
  it("isReconciling is false initially", () => {
    const { result } = renderHook(() => useReconcileLibrary());
    expect(result.current.isReconciling).toBe(false);
    expect(useLibraryStore.getState().isReconciling).toBe(false);
  });

  it("isReconciling reflects libraryStore value — not isolated per-component state", async () => {
    // Render two separate hook instances (as happens when MainPage + FoldersPanel both mount)
    let resolveReconcile!: () => void;
    mockReconcileGlobalLibrary.mockReturnValue(
      new Promise<{ sounds: []; inaccessibleFolderIds: [] }>((resolve) => {
        resolveReconcile = () => resolve({ sounds: [], inaccessibleFolderIds: [] });
      }),
    );

    const { result: instance1 } = renderHook(() => useReconcileLibrary());
    const { result: instance2 } = renderHook(() => useReconcileLibrary());

    // Start reconcile from instance1
    act(() => {
      void instance1.current.reconcile();
    });

    // Both instances should reflect isReconciling=true via shared libraryStore.
    // OLD behavior: instance2.current.isReconciling === false because each instance
    // had its own local useState(false) — the module-level lock blocked concurrent
    // runs but the per-component state was never updated on instance2.
    expect(instance1.current.isReconciling).toBe(true);
    expect(instance2.current.isReconciling).toBe(true);

    // Finish and verify both return to false
    await act(async () => {
      resolveReconcile();
      await Promise.resolve();
    });
    expect(instance1.current.isReconciling).toBe(false);
    expect(instance2.current.isReconciling).toBe(false);
  });

  it("libraryStore reset clears isReconciling — no module-level lock leakage between tests", async () => {
    let resolveReconcile!: () => void;
    mockReconcileGlobalLibrary.mockReturnValue(
      new Promise<{ sounds: []; inaccessibleFolderIds: [] }>((resolve) => {
        resolveReconcile = () => resolve({ sounds: [], inaccessibleFolderIds: [] });
      }),
    );

    const { result } = renderHook(() => useReconcileLibrary());
    act(() => {
      void result.current.reconcile();
    });
    expect(result.current.isReconciling).toBe(true);

    // Simulate what beforeEach does: reset the store (no vi.resetModules needed)
    useLibraryStore.setState({ ...initialLibraryState });

    // After store reset, isReconciling must be false — no stuck module-level lock
    expect(useLibraryStore.getState().isReconciling).toBe(false);

    // Clean up the hanging promise
    resolveReconcile();
  });

  it("concurrent reconcile call is blocked while first is in flight", async () => {
    let resolveFirst!: () => void;
    mockReconcileGlobalLibrary.mockReturnValue(
      new Promise<{ sounds: []; inaccessibleFolderIds: [] }>((resolve) => {
        resolveFirst = () => resolve({ sounds: [], inaccessibleFolderIds: [] });
      }),
    );

    const { result } = renderHook(() => useReconcileLibrary());

    // First call — starts reconciliation
    act(() => {
      void result.current.reconcile();
    });
    expect(mockReconcileGlobalLibrary).toHaveBeenCalledTimes(1);

    // Second call while first is in flight — must be blocked
    act(() => {
      void result.current.reconcile();
    });
    expect(mockReconcileGlobalLibrary).toHaveBeenCalledTimes(1);

    // Clean up
    await act(async () => {
      resolveFirst();
      await Promise.resolve();
    });
  });

  it("reconcile is permitted again after first run completes", async () => {
    const { result } = renderHook(() => useReconcileLibrary());

    await act(async () => {
      await result.current.reconcile();
    });
    expect(mockReconcileGlobalLibrary).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.reconcile();
    });
    expect(mockReconcileGlobalLibrary).toHaveBeenCalledTimes(2);
  });
});
