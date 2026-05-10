import { renderHook, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { useMissingSoundsNotification } from "@/hooks/useMissingSoundsNotification";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import {
  createMockProject,
  createMockHistoryEntry,
  createMockScene,
  createMockPad,
  createMockLayer,
  createMockSoundInstance,
} from "@/test/factories";

// ── Hoisted mock fns ──────────────────────────────────────────────────────────

const { mockToastWarning } = vi.hoisted(() => ({
  mockToastWarning: vi.fn(),
}));

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("sonner", () => ({
  toast: { warning: mockToastWarning, error: vi.fn() },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadProjectWithSounds(soundIds: string[]) {
  const instances = soundIds.map((soundId) =>
    createMockSoundInstance({ soundId }),
  );
  const layer = createMockLayer({
    selection: { type: "assigned", instances },
  });
  const pad = createMockPad({ layers: [layer] });
  const scene = createMockScene({ pads: [pad] });
  const project = createMockProject({ scenes: [scene] });
  const historyEntry = createMockHistoryEntry();
  useProjectStore.getState().loadProject(historyEntry, project, false);
  return project;
}

function setMissingSoundIds(ids: string[]) {
  useLibraryStore.setState({
    missingSoundIds: new Set(ids),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useMissingSoundsNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectStore.setState({ ...initialProjectState });
    useLibraryStore.setState({ ...initialLibraryState });
  });

  it("does not fire when no sounds are missing", () => {
    loadProjectWithSounds(["sound-1"]);
    renderHook(() => useMissingSoundsNotification());
    expect(mockToastWarning).not.toHaveBeenCalled();
  });

  it("does not fire when missing sounds are not referenced by the project", () => {
    loadProjectWithSounds(["sound-1"]);
    setMissingSoundIds(["sound-unrelated"]);

    renderHook(() => useMissingSoundsNotification());
    expect(mockToastWarning).not.toHaveBeenCalled();
  });

  it.each([
    { missingIds: ["sound-1"], expected: "1 sound used in this project are missing. Check the Sounds panel." },
    { missingIds: ["sound-1", "sound-2"], expected: "2 sounds used in this project are missing. Check the Sounds panel." },
  ])("fires with correct wording for $missingIds.length missing sound(s)", ({ missingIds, expected }) => {
    loadProjectWithSounds(["sound-1", "sound-2"]);
    setMissingSoundIds(missingIds);

    renderHook(() => useMissingSoundsNotification());
    expect(mockToastWarning).toHaveBeenCalledWith(expected);
  });

  it("does not fire a second time for the same load session (dedup)", () => {
    loadProjectWithSounds(["sound-1"]);
    setMissingSoundIds(["sound-1"]);

    const { rerender } = renderHook(() => useMissingSoundsNotification());
    expect(mockToastWarning).toHaveBeenCalledTimes(1);

    // Simulate missingSoundIds changing (e.g. second reconcile pass) — no re-toast
    act(() => {
      setMissingSoundIds(["sound-1", "sound-2"]);
    });
    rerender();

    expect(mockToastWarning).toHaveBeenCalledTimes(1);
  });

  it("fires again after a new project is loaded (new loadSessionId)", () => {
    loadProjectWithSounds(["sound-1"]);
    setMissingSoundIds(["sound-1"]);

    const { rerender } = renderHook(() => useMissingSoundsNotification());
    expect(mockToastWarning).toHaveBeenCalledTimes(1);

    act(() => {
      loadProjectWithSounds(["sound-1"]);
    });
    rerender();

    expect(mockToastWarning).toHaveBeenCalledTimes(2);
  });

  it("does not fire when project is null", () => {
    setMissingSoundIds(["sound-1"]);
    renderHook(() => useMissingSoundsNotification());
    expect(mockToastWarning).not.toHaveBeenCalled();
  });
});
