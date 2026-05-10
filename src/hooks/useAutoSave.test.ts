import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAutoSave } from "./useAutoSave";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { createMockProject, createMockHistoryEntry } from "@/test/factories";

// ── Module mocks ─────────────────────────────────────────────────────────────

const { mockSaveProject, mockSaveCurrentLibraryAndClearDirty } = vi.hoisted(() => ({
  mockSaveProject: vi.fn<() => Promise<void>>(),
  mockSaveCurrentLibraryAndClearDirty: vi.fn<() => Promise<void>>(),
}));

vi.mock("@/lib/project", () => ({
  saveProject: mockSaveProject,
}));

vi.mock("@/lib/library", () => ({
  saveCurrentLibraryAndClearDirty: mockSaveCurrentLibraryAndClearDirty,
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
  mockSaveProject.mockReset();
  mockSaveCurrentLibraryAndClearDirty.mockReset();
  mockToastError.mockReset();
  mockRefreshMissingState.mockReset();
  // Default: both resolve immediately (success path)
  mockSaveProject.mockResolvedValue(undefined);
  mockSaveCurrentLibraryAndClearDirty.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAutoSave", () => {
  // ── Guard conditions ────────────────────────────────────────────────────────

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

    expect(mockSaveProject).not.toHaveBeenCalled();
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

    expect(mockSaveProject).not.toHaveBeenCalled();
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

    expect(mockSaveProject).not.toHaveBeenCalled();
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

    expect(mockSaveProject).not.toHaveBeenCalled();
  });

  // ── Success path ────────────────────────────────────────────────────────────

  it("calls saveProject with folderPath and project when eligible", () => {
    seedDirtyPermanentProject();

    renderHook(() => useAutoSave(30_000));

    expect(mockSaveProject).toHaveBeenCalledTimes(1);
    expect(mockSaveProject).toHaveBeenCalledWith(
      "/path/to/project",
      expect.objectContaining({ name: "Auto Save Test" }),
    );
  });

  it("clears the dirty flag after a successful project save", async () => {
    seedDirtyPermanentProject();

    renderHook(() => useAutoSave(30_000));

    await act(async () => {});

    expect(useProjectStore.getState().isDirty).toBe(false);
  });

  it("stops saving on subsequent ticks once a successful save clears isDirty", async () => {
    seedDirtyPermanentProject();

    renderHook(() => useAutoSave(30_000));

    // Flush the initial save — clearDirtyFlag is called
    await act(async () => {});
    expect(useProjectStore.getState().isDirty).toBe(false);

    // Advance one interval — isDirty is now false, no re-save
    act(() => { vi.advanceTimersByTime(30_000); });

    expect(mockSaveProject).toHaveBeenCalledTimes(1);
  });

  // ── Error path ──────────────────────────────────────────────────────────────

  it("shows an error toast when project save fails", async () => {
    seedDirtyPermanentProject();
    mockSaveProject.mockRejectedValue(new Error("ENOSPC: no space left on device"));

    renderHook(() => useAutoSave(30_000));

    await act(async () => {});

    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalledWith(
      "Auto-save failed — your changes may not be saved to disk.",
    );
  });

  it("does NOT clear the dirty flag on error (keeps retrying)", async () => {
    seedDirtyPermanentProject();
    mockSaveProject.mockRejectedValue(new Error("ENOSPC"));

    renderHook(() => useAutoSave(30_000));

    await act(async () => {});

    // isDirty must remain true so the next interval tick retries the save
    expect(useProjectStore.getState().isDirty).toBe(true);
  });

  it("retries save on the next interval tick after an error", async () => {
    seedDirtyPermanentProject();
    mockSaveProject.mockRejectedValue(new Error("ENOSPC"));

    renderHook(() => useAutoSave(30_000));

    // First save fires and fails
    expect(mockSaveProject).toHaveBeenCalledTimes(1);
    await act(async () => {});  // flush: pending resets, dirty stays true

    // Advance one interval — should retry
    act(() => { vi.advanceTimersByTime(30_000); });

    expect(mockSaveProject).toHaveBeenCalledTimes(2);
    expect(useProjectStore.getState().isDirty).toBe(true);
  });

  // ── Debounce ────────────────────────────────────────────────────────────────

  it("debounces the error toast — repeated failures within 60s only toast once", async () => {
    seedDirtyPermanentProject();
    mockSaveProject.mockRejectedValue(new Error("ENOSPC"));

    renderHook(() => useAutoSave(30_000));

    // First failure (t=0)
    await act(async () => {});
    expect(mockToastError).toHaveBeenCalledTimes(1);

    // Advance 30s — second save tick fires and fails (within 60s debounce window)
    act(() => { vi.advanceTimersByTime(30_000); });
    await act(async () => {});

    // Still only one toast
    expect(mockToastError).toHaveBeenCalledTimes(1);
  });

  it("fires the error toast again after the 60s debounce window elapses", async () => {
    seedDirtyPermanentProject();
    mockSaveProject.mockRejectedValue(new Error("ENOSPC"));

    renderHook(() => useAutoSave(30_000));

    // First failure (t=0)
    await act(async () => {});
    expect(mockToastError).toHaveBeenCalledTimes(1);

    // Advance to t=30s (within debounce window) — no second toast
    act(() => { vi.advanceTimersByTime(30_000); });
    await act(async () => {});
    expect(mockToastError).toHaveBeenCalledTimes(1);

    // Advance to t=61s (past debounce window) — toast fires again
    act(() => { vi.advanceTimersByTime(31_000); });
    await act(async () => {});
    expect(mockToastError).toHaveBeenCalledTimes(2);
  });

  // ── In-flight guard (project) ───────────────────────────────────────────────

  it("skips project save when a previous save is still in flight", () => {
    seedDirtyPermanentProject();
    // saveProject never resolves — keeps isProjectSavePendingRef.current = true
    mockSaveProject.mockImplementation(() => new Promise(() => {}));

    renderHook(() => useAutoSave(30_000));

    // Initial save fires and is in-flight
    expect(mockSaveProject).toHaveBeenCalledTimes(1);

    // Advance two intervals — still in flight, both skipped
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(mockSaveProject).toHaveBeenCalledTimes(1);

    act(() => { vi.advanceTimersByTime(30_000); });
    expect(mockSaveProject).toHaveBeenCalledTimes(1);
  });

  it("resumes project saves after the in-flight save completes", async () => {
    seedDirtyPermanentProject();

    let resolveFirst!: () => void;
    mockSaveProject
      .mockImplementationOnce(() => new Promise<void>(resolve => { resolveFirst = resolve; }))
      .mockResolvedValue(undefined);

    renderHook(() => useAutoSave(30_000));

    // Initial save fires and is in-flight
    expect(mockSaveProject).toHaveBeenCalledTimes(1);

    // Advance interval — still in flight, skipped
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(mockSaveProject).toHaveBeenCalledTimes(1);

    // Complete the first save — clearDirtyFlag called, isDirty becomes false
    await act(async () => { resolveFirst(); });

    // Re-dirty so the next tick has something to save
    useProjectStore.getState().updateProject(useProjectStore.getState().project!);

    // Advance interval — pending cleared and isDirty is true again
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(mockSaveProject).toHaveBeenCalledTimes(2);
  });

  // ── Library save ────────────────────────────────────────────────────────────

  it("calls saveCurrentLibraryAndClearDirty when library is dirty", () => {
    seedDirtyPermanentProject();
    useLibraryStore.setState({ ...initialLibraryState, isDirty: true });

    renderHook(() => useAutoSave(30_000));

    expect(mockSaveCurrentLibraryAndClearDirty).toHaveBeenCalledTimes(1);
  });

  it("shows an error toast when library save fails", async () => {
    seedDirtyPermanentProject();
    useLibraryStore.setState({ ...initialLibraryState, isDirty: true });
    // Project save succeeds; only library save fails
    mockSaveCurrentLibraryAndClearDirty.mockRejectedValue(new Error("EACCES"));

    renderHook(() => useAutoSave(30_000));

    await act(async () => {});

    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalledWith(
      "Auto-save failed — your changes may not be saved to disk.",
    );
  });

  it("skips library save when a previous library save is still in flight", () => {
    seedDirtyPermanentProject();
    useLibraryStore.setState({ ...initialLibraryState, isDirty: true });
    mockSaveCurrentLibraryAndClearDirty.mockImplementation(() => new Promise(() => {}));

    renderHook(() => useAutoSave(30_000));

    expect(mockSaveCurrentLibraryAndClearDirty).toHaveBeenCalledTimes(1);

    act(() => { vi.advanceTimersByTime(30_000); });
    expect(mockSaveCurrentLibraryAndClearDirty).toHaveBeenCalledTimes(1);

    act(() => { vi.advanceTimersByTime(30_000); });
    expect(mockSaveCurrentLibraryAndClearDirty).toHaveBeenCalledTimes(1);
  });

  it("resumes library saves after the in-flight library save completes", async () => {
    seedDirtyPermanentProject();
    useLibraryStore.setState({ ...initialLibraryState, isDirty: true });

    let resolveFirst!: () => void;
    // First call hangs; subsequent calls resolve (mock doesn't clear isDirty so library stays dirty)
    mockSaveCurrentLibraryAndClearDirty
      .mockImplementationOnce(() => new Promise<void>(resolve => { resolveFirst = resolve; }))
      .mockResolvedValue(undefined);

    renderHook(() => useAutoSave(30_000));

    // Initial library save fires and is in-flight
    expect(mockSaveCurrentLibraryAndClearDirty).toHaveBeenCalledTimes(1);

    // Advance interval — still in flight, skipped
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(mockSaveCurrentLibraryAndClearDirty).toHaveBeenCalledTimes(1);

    // Complete the first library save — mock doesn't clear libraryStore.isDirty
    await act(async () => { resolveFirst(); });

    // Advance interval — pending cleared, library still dirty → fires again
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(mockSaveCurrentLibraryAndClearDirty).toHaveBeenCalledTimes(2);
  });

  // ── Shared debounce ─────────────────────────────────────────────────────────

  it("project-save error and library-save error share the same debounce window (only one toast total)", async () => {
    seedDirtyPermanentProject();
    useLibraryStore.setState({ ...initialLibraryState, isDirty: true });
    mockSaveProject.mockRejectedValue(new Error("ENOSPC"));
    mockSaveCurrentLibraryAndClearDirty.mockRejectedValue(new Error("ENOSPC"));

    renderHook(() => useAutoSave(30_000));

    // Both saves fire and fail — only one toast (shared debounce window)
    await act(async () => {});

    expect(mockToastError).toHaveBeenCalledTimes(1);
  });

  // ── Interval stability ──────────────────────────────────────────────────────

  it("does not restart the interval when the project store updates after a save", async () => {
    seedDirtyPermanentProject();

    renderHook(() => useAutoSave(30_000));

    // t=0: initial save fires
    expect(mockSaveProject).toHaveBeenCalledTimes(1);

    // Advance to t=25s (before the first interval tick)
    act(() => { vi.advanceTimersByTime(25_000); });

    // Flush: clearDirtyFlag called, isDirty becomes false
    await act(async () => {});
    expect(useProjectStore.getState().isDirty).toBe(false);

    // Re-dirty so the next tick has something to save
    useProjectStore.getState().updateProject(useProjectStore.getState().project!);

    // Advance remaining 5s to t=30s — interval fires (was NOT restarted by the store update)
    act(() => { vi.advanceTimersByTime(5_000); });

    // t=0 (initial) + t=30s (interval) = 2 total; if interval restarted it would fire at 55s
    expect(mockSaveProject).toHaveBeenCalledTimes(2);
  });

  it("saves library even when no project is open (folderPath is null)", () => {
    // Library is a global resource — it should save regardless of project state.
    useProjectStore.setState({ ...initialProjectState });
    useLibraryStore.setState({ ...initialLibraryState, isDirty: true });

    renderHook(() => useAutoSave(30_000));

    expect(mockSaveCurrentLibraryAndClearDirty).toHaveBeenCalledTimes(1);
    expect(mockSaveProject).not.toHaveBeenCalled();
  });

  // ── No filesystem scan ──────────────────────────────────────────────────────

  it("does NOT call refreshMissingState on mount or interval ticks", () => {
    seedDirtyPermanentProject();

    renderHook(() => useAutoSave(30_000));

    expect(mockRefreshMissingState).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(60_000); });

    // Saves were attempted but the missing-state scan was not triggered
    expect(mockSaveProject).toHaveBeenCalled();
    expect(mockRefreshMissingState).not.toHaveBeenCalled();
  });

  // ── Interval-driven saves ───────────────────────────────────────────────────

  it("saves on the next interval tick when project becomes dirty after mount", () => {
    seedDirtyPermanentProject();
    useProjectStore.getState().clearDirtyFlag(); // start clean — no initial save

    renderHook(() => useAutoSave(30_000));

    // No save on mount (isDirty=false)
    expect(mockSaveProject).not.toHaveBeenCalled();

    // User edits project — isDirty becomes true
    act(() => {
      useProjectStore.getState().updateProject(useProjectStore.getState().project!);
    });

    // Advance one interval — save should fire
    act(() => { vi.advanceTimersByTime(30_000); });

    expect(mockSaveProject).toHaveBeenCalledTimes(1);
  });
});
