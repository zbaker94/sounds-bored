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
} = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockToastError: vi.fn(),
  mockAllowClose: vi.fn(),
  mockDiscardTemporaryProject: vi.fn().mockResolvedValue(undefined),
  mockOpenOverlay: vi.fn(),
  mockCloseOverlay: vi.fn(),
  mockRequestSaveAndThen: vi.fn(),
}));

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("sonner", () => ({
  toast: { error: mockToastError, warning: vi.fn() },
}));

vi.mock("@/hooks/useWindowCloseHandler", () => ({
  useWindowCloseHandler: () => ({ allowClose: mockAllowClose }),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({ close: vi.fn().mockResolvedValue(undefined) })),
}));

vi.mock("@/lib/project", () => ({
  discardTemporaryProject: mockDiscardTemporaryProject,
}));

const mockUiState = {
  activeSceneId: null as string | null,
  openOverlay: mockOpenOverlay,
  closeOverlay: mockCloseOverlay,
  setActiveSceneId: vi.fn((id: string | null, _sceneIds?: string[]) => { mockUiState.activeSceneId = id; }),
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
