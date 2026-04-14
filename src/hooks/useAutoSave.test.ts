import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAutoSave } from "./useAutoSave";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { createMockProject, createMockHistoryEntry } from "@/test/factories";

// ── Module mocks ─────────────────────────────────────────────────────────────

const mockSaveProjectMutate = vi.fn();
vi.mock("@/lib/project.queries", () => ({
  useSaveProject: () => ({ mutate: mockSaveProjectMutate }),
}));

const mockSaveLibrarySync = vi.fn();
vi.mock("@/lib/library.queries", () => ({
  useSaveCurrentLibrary: () => ({ saveCurrentLibrarySync: mockSaveLibrarySync }),
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

const mockToastError = toast.error as ReturnType<typeof vi.fn>;

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
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
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
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );

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
