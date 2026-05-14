// Full integration tests for useProjectLifecycle + useWindowCloseHandler together.
// useWindowCloseHandler is NOT mocked — the real hook runs so the Tauri close-event
// listener is actually registered, exercising the complete close lifecycle path.

import { renderHook, act, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { useProjectLifecycle } from "@/hooks/useProjectLifecycle";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { createMockProject, createMockHistoryEntry } from "@/test/factories";

type CloseEvent = { preventDefault(): void };
type CloseCallback = (event: CloseEvent) => Promise<void>;

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockNavigate,
  mockWindowClose,
  mockOnCloseRequested,
  mockDiscardTemporaryProject,
  mockOpenOverlay,
  mockCloseOverlay,
  mockRequestSaveAndThen,
} = vi.hoisted(() => {
  const mockOnCloseRequested = vi.fn();
  mockOnCloseRequested.mockResolvedValue(vi.fn()); // unlisten stub
  return {
    mockNavigate: vi.fn(),
    mockWindowClose: vi.fn().mockResolvedValue(undefined),
    mockOnCloseRequested,
    mockDiscardTemporaryProject: vi.fn().mockResolvedValue(undefined),
    mockOpenOverlay: vi.fn(),
    mockCloseOverlay: vi.fn(),
    mockRequestSaveAndThen: vi.fn(),
  };
});

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), warning: vi.fn() },
}));

// useWindowCloseHandler is NOT mocked — intentionally excluded from this file.
// @tauri-apps/api/window IS mocked so we can capture and invoke the close callback.
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    onCloseRequested: mockOnCloseRequested,
    close: mockWindowClose,
  })),
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

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getRegisteredCloseCb(): Promise<CloseCallback> {
  await waitFor(() => expect(mockOnCloseRequested).toHaveBeenCalledTimes(1));
  await act(async () => {}); // flush resolved-promise continuation so unlisten is assigned
  return mockOnCloseRequested.mock.calls[0][0] as CloseCallback;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useProjectLifecycle + useWindowCloseHandler — full chain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOnCloseRequested.mockResolvedValue(vi.fn());
    mockDiscardTemporaryProject.mockResolvedValue(undefined);
    useProjectStore.setState({ ...initialProjectState });
  });

  it("Tauri close event prevents close and opens overlay when project has unsaved changes", async () => {
    const project = createMockProject();
    const historyEntry = createMockHistoryEntry();
    useProjectStore.getState().loadProject(historyEntry, project, true);

    renderHook(() => useProjectLifecycle());
    const cb = await getRegisteredCloseCb();

    const event = { preventDefault: vi.fn() };
    await act(async () => {
      await cb(event);
    });

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(mockOpenOverlay).toHaveBeenCalledWith("CONFIRM_CLOSE_DIALOG", "dialog");
  });

  it("Tauri close event does not prevent close when project has no unsaved changes", async () => {
    const project = createMockProject();
    const historyEntry = createMockHistoryEntry();
    useProjectStore.getState().loadProject(historyEntry, project, false);

    renderHook(() => useProjectLifecycle());
    const cb = await getRegisteredCloseCb();

    const event = { preventDefault: vi.fn() };
    await act(async () => {
      await cb(event);
    });

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(mockOpenOverlay).not.toHaveBeenCalled();
  });

  it("subsequent Tauri close event is not prevented after handleSaveAndClose save callback runs", async () => {
    const project = createMockProject();
    const historyEntry = createMockHistoryEntry();
    useProjectStore.getState().loadProject(historyEntry, project, true);

    const { result } = renderHook(() => useProjectLifecycle());
    const cb = await getRegisteredCloseCb();

    act(() => {
      result.current.handleSaveAndClose();
    });

    const saveCallback = mockRequestSaveAndThen.mock.calls[0][0] as () => void;
    act(() => {
      saveCallback(); // simulates save completing → calls closeWindow → allowClose() called
    });

    const event = { preventDefault: vi.fn() };
    await act(async () => {
      await cb(event);
    });

    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
