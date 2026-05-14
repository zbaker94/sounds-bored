import { renderHook, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { useProjectLifecycle } from "@/hooks/useProjectLifecycle";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { createMockProject, createMockHistoryEntry } from "@/test/factories";

// ── Hoisted mock fns (must be declared before vi.mock factories) ──────────────

const {
  mockNavigate,
  mockToastError,
  mockAllowClose,
  mockDiscardTemporaryProject,
  mockOpenOverlay,
  mockCloseOverlay,
  mockRequestSaveAndThen,
  mockUseWindowCloseHandler,
} = vi.hoisted(() => {
  const mockAllowClose = vi.fn();
  return {
    mockNavigate: vi.fn(),
    mockToastError: vi.fn(),
    mockAllowClose,
    mockDiscardTemporaryProject: vi.fn().mockResolvedValue(undefined),
    mockOpenOverlay: vi.fn(),
    mockCloseOverlay: vi.fn(),
    mockRequestSaveAndThen: vi.fn(),
    mockUseWindowCloseHandler: vi.fn<
      (hasUnsavedChanges: boolean, onCloseRequested: () => void) => { allowClose: () => void }
    >(() => ({ allowClose: mockAllowClose })),
  };
});

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("sonner", () => ({
  toast: { error: mockToastError, warning: vi.fn() },
}));

vi.mock("@/hooks/useWindowCloseHandler", () => ({
  useWindowCloseHandler: mockUseWindowCloseHandler,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({ close: vi.fn().mockResolvedValue(undefined) })),
}));

vi.mock("@/lib/project", () => ({
  discardTemporaryProject: mockDiscardTemporaryProject,
}));

const mockUiState = {
  openOverlay: mockOpenOverlay,
  closeOverlay: mockCloseOverlay,
};

vi.mock("@/state/uiStore", () => ({
  useUiStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector(mockUiState),
    { getState: () => mockUiState },
  ),
  OVERLAY_ID: {
    CONFIRM_CLOSE_DIALOG: "CONFIRM_CLOSE_DIALOG",
  },
  selectIsOverlayOpen: () => () => false,
}));

vi.mock("@/contexts/ProjectActionsContext", () => ({
  useProjectActions: () => ({ requestSaveAndThen: mockRequestSaveAndThen }),
}));

vi.mock("@/lib/constants", () => ({
  WINDOW_CLOSE_DELAY: 0,
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useProjectLifecycle — unexpected unload guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDiscardTemporaryProject.mockResolvedValue(undefined);
    useProjectStore.setState({ ...initialProjectState });
  });

  it("shows error toast and navigates to / when project becomes null unexpectedly", () => {
    const project = createMockProject();
    const historyEntry = createMockHistoryEntry();
    useProjectStore.getState().loadProject(historyEntry, project, false);

    const { rerender } = renderHook(() => useProjectLifecycle());

    act(() => {
      useProjectStore.getState().clearProject();
    });

    rerender();

    expect(mockToastError).toHaveBeenCalledWith(
      "No project loaded. Returning to start screen.",
    );
    expect(mockNavigate).toHaveBeenCalledWith("/");
  });

  it("does NOT show error toast or navigate when handleSaveAndClose clears the project", () => {
    const project = createMockProject();
    const historyEntry = createMockHistoryEntry();
    useProjectStore.getState().loadProject(historyEntry, project, false);

    const { result, rerender } = renderHook(() => useProjectLifecycle());

    act(() => {
      result.current.handleSaveAndClose();
      useProjectStore.getState().clearProject();
    });

    rerender();

    expect(mockToastError).not.toHaveBeenCalled();
    // navigate is driven by closeWindow, not the guard effect
    expect(mockNavigate).not.toHaveBeenCalledWith("/");
  });

  it("does NOT show error toast or navigate when handleDiscardAndClose clears the project", async () => {
    const project = createMockProject();
    const historyEntry = createMockHistoryEntry();
    useProjectStore.getState().loadProject(historyEntry, project, false);

    const { result, rerender } = renderHook(() => useProjectLifecycle());

    await act(async () => {
      await result.current.handleDiscardAndClose();
      useProjectStore.getState().clearProject();
    });

    rerender();

    expect(mockToastError).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalledWith("/");
  });

  it("re-arms the guard after a new project is loaded following an intentional close", () => {
    const project = createMockProject();
    const historyEntry = createMockHistoryEntry();
    useProjectStore.getState().loadProject(historyEntry, project, false);

    const { result, rerender } = renderHook(() => useProjectLifecycle());

    // Intentional close — flag goes true
    act(() => {
      result.current.handleSaveAndClose();
      useProjectStore.getState().clearProject();
    });
    rerender();
    expect(mockToastError).not.toHaveBeenCalled();

    // New project loaded — flag should reset to false
    const project2 = createMockProject({ name: "Project Two" });
    const historyEntry2 = createMockHistoryEntry();
    act(() => {
      useProjectStore.getState().loadProject(historyEntry2, project2, false);
    });
    rerender();

    // Now unexpected null → toast should fire
    act(() => {
      useProjectStore.getState().clearProject();
    });
    rerender();

    expect(mockToastError).toHaveBeenCalledWith(
      "No project loaded. Returning to start screen.",
    );
    expect(mockNavigate).toHaveBeenCalledWith("/");
  });
});

describe("useProjectLifecycle — close dialog handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDiscardTemporaryProject.mockResolvedValue(undefined);
    useProjectStore.setState({ ...initialProjectState });
  });

  it("handleSaveAndClose closes the overlay and requests save-then-close", () => {
    const project = createMockProject();
    const historyEntry = createMockHistoryEntry();
    useProjectStore.getState().loadProject(historyEntry, project, false);

    const { result } = renderHook(() => useProjectLifecycle());

    act(() => {
      result.current.handleSaveAndClose();
    });

    expect(mockCloseOverlay).toHaveBeenCalledWith("CONFIRM_CLOSE_DIALOG");
    expect(mockRequestSaveAndThen).toHaveBeenCalledTimes(1);
    expect(mockRequestSaveAndThen).toHaveBeenCalledWith(expect.any(Function));

    // Verify the passed callback triggers window close
    const callback = mockRequestSaveAndThen.mock.calls[0][0] as () => void;
    callback();
    expect(mockAllowClose).toHaveBeenCalled();
  });

  it("handleDiscardAndClose calls discardTemporaryProject for a temporary project", async () => {
    const project = createMockProject();
    const historyEntry = createMockHistoryEntry({ path: "/some/path" });
    useProjectStore.getState().loadProject(historyEntry, project, true);

    const { result } = renderHook(() => useProjectLifecycle());

    await act(async () => {
      await result.current.handleDiscardAndClose();
    });

    expect(mockDiscardTemporaryProject).toHaveBeenCalledWith("/some/path");
    expect(mockAllowClose).toHaveBeenCalled();
    expect(mockCloseOverlay).toHaveBeenCalledWith("CONFIRM_CLOSE_DIALOG");
  });

  it("handleDiscardAndClose skips discardTemporaryProject for a permanent project", async () => {
    const project = createMockProject();
    const historyEntry = createMockHistoryEntry();
    useProjectStore.getState().loadProject(historyEntry, project, false);

    const { result } = renderHook(() => useProjectLifecycle());

    await act(async () => {
      await result.current.handleDiscardAndClose();
    });

    expect(mockDiscardTemporaryProject).not.toHaveBeenCalled();
    expect(mockAllowClose).toHaveBeenCalled();
    expect(mockCloseOverlay).toHaveBeenCalledWith("CONFIRM_CLOSE_DIALOG");
  });

  it("handleDiscardAndClose skips discardTemporaryProject when folderPath is null", async () => {
    const project = createMockProject();
    // Set isTemporary=true but folderPath=null directly via setState
    // (ProjectHistoryEntry.path is non-nullable in the schema)
    useProjectStore.setState({ ...initialProjectState, project, isTemporary: true, folderPath: null });

    const { result } = renderHook(() => useProjectLifecycle());

    await act(async () => {
      await result.current.handleDiscardAndClose();
    });

    expect(mockDiscardTemporaryProject).not.toHaveBeenCalled();
    expect(mockAllowClose).toHaveBeenCalled(); // closeWindow still runs
  });

  it("handleDiscardAndClose still calls closeWindow when discardTemporaryProject rejects", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const project = createMockProject();
    const historyEntry = createMockHistoryEntry({ path: "/some/path" });
    useProjectStore.getState().loadProject(historyEntry, project, true);
    mockDiscardTemporaryProject.mockRejectedValue(new Error("Cannot delete"));

    const { result } = renderHook(() => useProjectLifecycle());

    await act(async () => {
      await result.current.handleDiscardAndClose();
    });

    expect(mockDiscardTemporaryProject).toHaveBeenCalledWith("/some/path");
    expect(mockAllowClose).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("handleCancelClose closes the overlay without any other action", () => {
    const project = createMockProject();
    const historyEntry = createMockHistoryEntry();
    useProjectStore.getState().loadProject(historyEntry, project, false);

    const { result } = renderHook(() => useProjectLifecycle());

    act(() => {
      result.current.handleCancelClose();
    });

    expect(mockCloseOverlay).toHaveBeenCalledWith("CONFIRM_CLOSE_DIALOG");
    expect(mockRequestSaveAndThen).not.toHaveBeenCalled();
    expect(mockDiscardTemporaryProject).not.toHaveBeenCalled();
  });
});

describe("useProjectLifecycle — useWindowCloseHandler integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDiscardTemporaryProject.mockResolvedValue(undefined);
    useProjectStore.setState({ ...initialProjectState });
  });

  it("passes false to useWindowCloseHandler when project has no unsaved changes", () => {
    const project = createMockProject();
    const historyEntry = createMockHistoryEntry();
    useProjectStore.getState().loadProject(historyEntry, project, false);

    renderHook(() => useProjectLifecycle());

    expect(mockUseWindowCloseHandler).toHaveBeenCalledWith(false, expect.any(Function));
  });

  it("passes true to useWindowCloseHandler when project isTemporary", () => {
    const project = createMockProject();
    const historyEntry = createMockHistoryEntry();
    useProjectStore.getState().loadProject(historyEntry, project, true);

    renderHook(() => useProjectLifecycle());

    expect(mockUseWindowCloseHandler).toHaveBeenCalledWith(true, expect.any(Function));
  });

  it("passes true to useWindowCloseHandler when project isDirty", () => {
    const project = createMockProject();
    const historyEntry = createMockHistoryEntry();
    useProjectStore.getState().loadProject(historyEntry, project, false);
    useProjectStore.setState({ isDirty: true });

    renderHook(() => useProjectLifecycle());

    expect(mockUseWindowCloseHandler).toHaveBeenCalledWith(true, expect.any(Function));
  });

  it("updates hasUnsavedChanges to false when isDirty changes to false", () => {
    const project = createMockProject();
    const historyEntry = createMockHistoryEntry();
    useProjectStore.getState().loadProject(historyEntry, project, false);
    useProjectStore.setState({ isDirty: true });

    const { rerender } = renderHook(() => useProjectLifecycle());
    expect(mockUseWindowCloseHandler).toHaveBeenLastCalledWith(true, expect.any(Function));

    act(() => {
      useProjectStore.setState({ isDirty: false });
    });
    rerender();

    expect(mockUseWindowCloseHandler).toHaveBeenLastCalledWith(false, expect.any(Function));
  });

  it("passes handleCloseRequested that opens the confirm dialog overlay", () => {
    const project = createMockProject();
    const historyEntry = createMockHistoryEntry();
    useProjectStore.getState().loadProject(historyEntry, project, false);

    renderHook(() => useProjectLifecycle());

    const [, onCloseRequested] = mockUseWindowCloseHandler.mock.calls.at(-1)!;
    act(() => {
      onCloseRequested();
    });

    expect(mockOpenOverlay).toHaveBeenCalledWith("CONFIRM_CLOSE_DIALOG", "dialog");
  });
});
