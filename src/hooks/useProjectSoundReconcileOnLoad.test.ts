import { renderHook, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { useProjectSoundReconcileOnLoad } from "@/hooks/useProjectSoundReconcileOnLoad";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { createMockProject, createMockHistoryEntry } from "@/test/factories";

// ── Hoisted mock fns ──────────────────────────────────────────────────────────

const { mockApplyProjectSoundReconcile } = vi.hoisted(() => ({
  mockApplyProjectSoundReconcile: vi.fn(),
}));

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/project.reconcile", () => ({
  applyProjectSoundReconcile: mockApplyProjectSoundReconcile,
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useProjectSoundReconcileOnLoad", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectStore.setState({ ...initialProjectState });
  });

  it("does not call reconcile when project is null", () => {
    renderHook(() => useProjectSoundReconcileOnLoad());
    expect(mockApplyProjectSoundReconcile).not.toHaveBeenCalled();
  });

  it("calls reconcile once when a project is loaded", () => {
    const project = createMockProject();
    const historyEntry = createMockHistoryEntry();

    const { rerender } = renderHook(() => useProjectSoundReconcileOnLoad());

    act(() => {
      useProjectStore.getState().loadProject(historyEntry, project, false);
    });
    rerender();

    expect(mockApplyProjectSoundReconcile).toHaveBeenCalledTimes(1);
  });

  it("does not call reconcile again on re-render for the same load session", () => {
    const project = createMockProject();
    const historyEntry = createMockHistoryEntry();
    useProjectStore.getState().loadProject(historyEntry, project, false);

    const { rerender } = renderHook(() => useProjectSoundReconcileOnLoad());
    expect(mockApplyProjectSoundReconcile).toHaveBeenCalledTimes(1);

    rerender();
    rerender();

    expect(mockApplyProjectSoundReconcile).toHaveBeenCalledTimes(1);
  });

  it("calls reconcile again when a second project is loaded (new loadSessionId)", () => {
    const project1 = createMockProject({ name: "Project One" });
    const historyEntry1 = createMockHistoryEntry();
    useProjectStore.getState().loadProject(historyEntry1, project1, false);

    const { rerender } = renderHook(() => useProjectSoundReconcileOnLoad());
    expect(mockApplyProjectSoundReconcile).toHaveBeenCalledTimes(1);

    const project2 = createMockProject({ name: "Project Two" });
    const historyEntry2 = createMockHistoryEntry();
    act(() => {
      useProjectStore.getState().loadProject(historyEntry2, project2, false);
    });
    rerender();

    expect(mockApplyProjectSoundReconcile).toHaveBeenCalledTimes(2);
  });
});
