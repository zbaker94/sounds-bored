import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAutoSave } from "./useAutoSave";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { createMockProject, createMockHistoryEntry } from "@/test/factories";

// ── Module mocks ─────────────────────────────────────────────────────────────

const mockSaveProjectMutate = vi.fn();
// Mutable object — tests can set .isPending = true to simulate an in-flight save
const mockProjectMutation = { mutate: mockSaveProjectMutate, isPending: false };
vi.mock("@/lib/project.queries", () => ({
  useSaveProject: () => mockProjectMutation,
}));

const mockSaveLibrarySync = vi.fn();
// Mutable object — tests can set .isPending = true to simulate an in-flight library save
const mockLibraryMutation = { saveCurrentLibrarySync: mockSaveLibrarySync, isPending: false };
vi.mock("@/lib/library.queries", () => ({
  useSaveCurrentLibrary: () => mockLibraryMutation,
}));

vi.mock("@/lib/library.reconcile", () => ({
  refreshMissingState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

import { toast } from "sonner";
import { refreshMissingState } from "@/lib/library.reconcile";

const mockToastError = toast.error as ReturnType<typeof vi.fn>;
const mockRefreshMissingState = refreshMissingState as ReturnType<typeof vi.fn>;

/**
 * Put projectStore into a state where auto-save is eligible to run:
 * - a non-null project
 * - a folderPath
 * - isTemporary = false
 * - isDirty = true (so the save path is entered)
 */
function seedDirtyPermanentProject() {
  const project = createMockProject({ name: "Auto Save Test" });
  const historyEntry = createMockHistoryEntry({ path: "/path/to/project" });
  useProjectStore.setState({
    ...initialProjectState,
    project,
    folderPath: historyEntry.path,
    historyEntry,
    isTemporary: false,
    isDirty: true,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  useProjectStore.setState({ ...initialProjectState });
  useLibraryStore.setState({ ...initialLibraryState });
  mockSaveProjectMutate.mockReset();
  mockSaveLibrarySync.mockReset();
  mockToastError.mockReset();
  mockRefreshMissingState.mockReset();
  mockProjectMutation.isPending = false;
  mockLibraryMutation.isPending = false;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAutoSave", () => {
  it("does not save when isDirty is false", () => {
    const project = createMockProject();
    useProjectStore.setState({
      ...initialProjectState,
      project,
      folderPath: "/path/to/project",
      isTemporary: false,
      isDirty: false,
    });

    renderHook(() => useAutoSave(30_000));

    expect(mockSaveProjectMutate).not.toHaveBeenCalled();
  });

  it("does not save when project is null", () => {
    useProjectStore.setState({
      ...initialProjectState,
      project: null,
      folderPath: "/path/to/project",
      isTemporary: false,
      isDirty: true,
    });

    renderHook(() => useAutoSave(30_000));

    expect(mockSaveProjectMutate).not.toHaveBeenCalled();
  });

  it("does not save when folderPath is null", () => {
    const project = createMockProject();
    useProjectStore.setState({
      ...initialProjectState,
      project,
      folderPath: null,
      isTemporary: false,
      isDirty: true,
    });

    renderHook(() => useAutoSave(30_000));

    expect(mockSaveProjectMutate).not.toHaveBeenCalled();
  });

  it("does not save when project is temporary", () => {
    const project = createMockProject();
    useProjectStore.setState({
      ...initialProjectState,
      project,
      folderPath: "/path/to/project",
      isTemporary: true,
      isDirty: true,
    });

    renderHook(() => useAutoSave(30_000));

    expect(mockSaveProjectMutate).not.toHaveBeenCalled();
  });

  it("calls saveProjectMutation.mutate when dirty and eligible", () => {
    seedDirtyPermanentProject();

    renderHook(() => useAutoSave(30_000));

    expect(mockSaveProjectMutate).toHaveBeenCalledTimes(1);
    const [args, options] = mockSaveProjectMutate.mock.calls[0];
    expect(args).toEqual({
      folderPath: "/path/to/project",
      project: expect.objectContaining({ name: "Auto Save Test" }),
    });
    expect(options).toEqual(
      expect.objectContaining({
        onError: expect.any(Function),
      }),
    );
    // onSuccess should NOT be present — isDirty drives re-save, not a stored JSON snapshot
    expect(options.onSuccess).toBeUndefined();
  });

  it("stops saving on subsequent ticks once a successful save clears isDirty", () => {
    seedDirtyPermanentProject();

    // Simulate the real useSaveProject behavior: on success, clearDirtyFlag() is called.
    mockSaveProjectMutate.mockImplementation(() => {
      useProjectStore.getState().clearDirtyFlag();
    });

    renderHook(() => useAutoSave(30_000));

    // Initial tick fires and the mock immediately clears isDirty.
    expect(mockSaveProjectMutate).toHaveBeenCalledTimes(1);
    expect(useProjectStore.getState().isDirty).toBe(false);

    // Advance one interval — isDirty is now false, so no re-save.
    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(mockSaveProjectMutate).toHaveBeenCalledTimes(1);
  });

  it("saves on the next interval tick even when project data is identical to the last successful save", () => {
    // Regression test: the old code had a JSON.stringify equality gate that blocked a
    // second save if the project data hadn't changed since the last successful save.
    // isDirty alone must control whether a save fires — if the store says dirty, save.
    seedDirtyPermanentProject();

    renderHook(() => useAutoSave(30_000));

    // Initial save fires immediately.
    expect(mockSaveProjectMutate).toHaveBeenCalledTimes(1);

    // Simulate the old-style onSuccess that stored the JSON snapshot (no-op after fix,
    // but calling it here ensures the test catches any lingering snapshot logic).
    const firstOptions = mockSaveProjectMutate.mock.calls[0][1];
    if (firstOptions?.onSuccess) {
      act(() => { firstOptions.onSuccess(); });
    }

    // isDirty was never cleared (clearDirtyFlag was not called) — advance one tick.
    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    // Must fire again because isDirty is still true.
    expect(mockSaveProjectMutate).toHaveBeenCalledTimes(2);
  });

  it("shows an error toast when auto-save fails", () => {
    seedDirtyPermanentProject();

    renderHook(() => useAutoSave(30_000));

    // Simulate the mutation invoking its onError callback (disk full, permission lost, etc).
    const options = mockSaveProjectMutate.mock.calls[0][1];
    act(() => {
      options.onError(new Error("ENOSPC: no space left on device"));
    });

    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalledWith(
      "Auto-save failed — your changes may not be saved to disk.",
    );
  });

  it("debounces the error toast — repeated failures within 60s only toast once", () => {
    seedDirtyPermanentProject();

    renderHook(() => useAutoSave(30_000));

    // First save tick — trigger a failure on the initial (synchronous) save call.
    const firstOptions = mockSaveProjectMutate.mock.calls[0][1];
    act(() => {
      firstOptions.onError(new Error("ENOSPC"));
    });
    expect(mockToastError).toHaveBeenCalledTimes(1);

    // Advance 30s so the next interval tick fires a second save attempt.
    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    // A new mutate call should have happened for the interval tick.
    expect(mockSaveProjectMutate.mock.calls.length).toBeGreaterThanOrEqual(2);
    const secondOptions =
      mockSaveProjectMutate.mock.calls[mockSaveProjectMutate.mock.calls.length - 1][1];
    act(() => {
      secondOptions.onError(new Error("ENOSPC"));
    });

    // Still only one toast — the second failure is within the 60s debounce window.
    expect(mockToastError).toHaveBeenCalledTimes(1);
  });

  it("fires the error toast again after the 60s debounce window elapses", () => {
    seedDirtyPermanentProject();

    renderHook(() => useAutoSave(30_000));

    // First failure
    const firstOptions = mockSaveProjectMutate.mock.calls[0][1];
    act(() => {
      firstOptions.onError(new Error("ENOSPC"));
    });
    expect(mockToastError).toHaveBeenCalledTimes(1);

    // Advance well past the debounce window (60s). Using 61s keeps the interval
    // ticks (every 30s) still firing along the way.
    act(() => {
      vi.advanceTimersByTime(61_000);
    });

    // Pull the options from the most recent save attempt and fire another failure.
    const lastOptions =
      mockSaveProjectMutate.mock.calls[mockSaveProjectMutate.mock.calls.length - 1][1];
    act(() => {
      lastOptions.onError(new Error("ENOSPC"));
    });

    // Debounce window has passed — the toast should show again.
    expect(mockToastError).toHaveBeenCalledTimes(2);
  });

  it("does NOT clear the dirty flag on error (keeps retrying)", () => {
    seedDirtyPermanentProject();

    renderHook(() => useAutoSave(30_000));

    const options = mockSaveProjectMutate.mock.calls[0][1];
    act(() => {
      options.onError(new Error("ENOSPC"));
    });

    // isDirty must remain true so the next interval tick retries the save.
    expect(useProjectStore.getState().isDirty).toBe(true);
  });

  it("retries save on the next interval tick after an error (dirty flag unchanged)", () => {
    seedDirtyPermanentProject();

    renderHook(() => useAutoSave(30_000));

    // First tick — save attempt fires, then fails.
    expect(mockSaveProjectMutate).toHaveBeenCalledTimes(1);
    const firstOptions = mockSaveProjectMutate.mock.calls[0][1];
    act(() => {
      firstOptions.onError(new Error("ENOSPC"));
    });

    // Advance one interval tick — should retry because isDirty is still true.
    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(mockSaveProjectMutate.mock.calls.length).toBeGreaterThanOrEqual(2);
    // isDirty is still true — nothing cleared it.
    expect(useProjectStore.getState().isDirty).toBe(true);
  });

  it("project-save error and library-save error share the same debounce window (only one toast total)", () => {
    seedDirtyPermanentProject();
    // Mark the library dirty so the library path is also entered.
    useLibraryStore.setState({
      ...initialLibraryState,
      isDirty: true,
    });

    renderHook(() => useAutoSave(30_000));

    // Both mutations are called on the initial tick.
    const projectOptions = mockSaveProjectMutate.mock.calls[0][1];
    const libraryOptions = mockSaveLibrarySync.mock.calls[0][0];

    // Project save fails first — toast fires.
    act(() => {
      projectOptions.onError(new Error("ENOSPC"));
    });
    expect(mockToastError).toHaveBeenCalledTimes(1);

    // Library save fails in the same tick (within debounce window) — no second toast.
    act(() => {
      libraryOptions.onError(new Error("ENOSPC"));
    });
    expect(mockToastError).toHaveBeenCalledTimes(1);
  });

  it("skips project save when a previous project save is still in flight", () => {
    seedDirtyPermanentProject();
    // Simulate an in-flight save from a previous tick
    mockProjectMutation.isPending = true;

    renderHook(() => useAutoSave(30_000));

    // Even though isDirty is true, mutate must not be called while isPending is true
    expect(mockSaveProjectMutate).not.toHaveBeenCalled();

    // Advance one full interval — still in flight, still no save
    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(mockSaveProjectMutate).not.toHaveBeenCalled();
  });

  it("resumes project saves once the in-flight save completes", () => {
    seedDirtyPermanentProject();
    mockProjectMutation.isPending = true;

    const { rerender } = renderHook(() => useAutoSave(30_000));

    // First tick — skipped because isPending
    expect(mockSaveProjectMutate).not.toHaveBeenCalled();

    // Simulate TanStack Query re-rendering the component when the save completes.
    // rerender() is required: it re-executes the hook body, which writes the new
    // isPending value to the ref. Without rerender(), the ref stays stale.
    mockProjectMutation.isPending = false;
    rerender();

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    // Next tick fires now that isPending is false and isDirty is still true
    expect(mockSaveProjectMutate).toHaveBeenCalledTimes(1);
  });

  it("skips the next interval tick when the initial save (from mount) is still in flight", () => {
    seedDirtyPermanentProject();

    // Simulate TanStack Query: when mutate() is called, isPending goes true
    mockSaveProjectMutate.mockImplementation(() => {
      mockProjectMutation.isPending = true;
    });

    const { rerender } = renderHook(() => useAutoSave(30_000));

    // Mount fires the first save — mutate is called, which sets isPending = true
    expect(mockSaveProjectMutate).toHaveBeenCalledTimes(1);

    // Simulate TanStack Query re-rendering the hook with the new isPending = true
    rerender();

    // Advance one interval — save still in flight, should skip
    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(mockSaveProjectMutate).toHaveBeenCalledTimes(1);
  });

  it("skips library save when a previous library save is still in flight", () => {
    seedDirtyPermanentProject();
    useLibraryStore.setState({ ...initialLibraryState, isDirty: true });
    mockLibraryMutation.isPending = true;

    renderHook(() => useAutoSave(30_000));

    expect(mockSaveLibrarySync).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(mockSaveLibrarySync).not.toHaveBeenCalled();
  });

  it("resumes library saves once the in-flight library save completes", () => {
    seedDirtyPermanentProject();
    useLibraryStore.setState({ ...initialLibraryState, isDirty: true });
    mockLibraryMutation.isPending = true;

    const { rerender } = renderHook(() => useAutoSave(30_000));

    expect(mockSaveLibrarySync).not.toHaveBeenCalled();

    // Simulate TanStack Query re-rendering the component when the save completes.
    // rerender() updates the ref — without it the ref stays stale.
    mockLibraryMutation.isPending = false;
    rerender();

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(mockSaveLibrarySync).toHaveBeenCalledTimes(1);
  });

  it("does NOT call refreshMissingState on mount or interval ticks", () => {
    seedDirtyPermanentProject();

    renderHook(() => useAutoSave(30_000));

    // Initial mount must not trigger a filesystem scan
    expect(mockRefreshMissingState).not.toHaveBeenCalled();

    // Advance two full intervals — still no filesystem scan
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    // The effect did run (saves were attempted) but the missing-state scan did not
    expect(mockSaveProjectMutate).toHaveBeenCalled();
    expect(mockRefreshMissingState).not.toHaveBeenCalled();
  });

  it("wires an onError handler to the library save as well", () => {
    seedDirtyPermanentProject();
    // Mark the library dirty so saveLibrary() is entered.
    useLibraryStore.setState({
      ...initialLibraryState,
      isDirty: true,
    });

    renderHook(() => useAutoSave(30_000));

    expect(mockSaveLibrarySync).toHaveBeenCalledTimes(1);
    const libOptions = mockSaveLibrarySync.mock.calls[0][0];
    expect(libOptions).toEqual(
      expect.objectContaining({
        onError: expect.any(Function),
      }),
    );
    // onSuccess should NOT be present — isDirty drives re-save, not a stored JSON snapshot
    expect(libOptions.onSuccess).toBeUndefined();

    // A library-save failure also triggers the (debounced) auto-save error toast.
    act(() => {
      libOptions.onError(new Error("EACCES"));
    });
    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalledWith(
      "Auto-save failed — your changes may not be saved to disk.",
    );
  });
});
