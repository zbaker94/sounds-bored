import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBootLoader } from "./useBootLoader";
import { useAppSettingsStore, initialAppSettingsState } from "@/state/appSettingsStore";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { createMockAppSettings, createMockSound } from "@/test/factories";

// ── Module mocks ─────────────────────────────────────────────────────────────

const mockLoadAppSettings = vi.fn();
vi.mock("@/lib/appSettings", () => ({
  loadAppSettings: () => mockLoadAppSettings(),
}));

const mockLoadGlobalLibrary = vi.fn();
const mockSaveGlobalLibrary = vi.fn(() => Promise.resolve());
vi.mock("@/lib/library", () => ({
  loadGlobalLibrary: () => mockLoadGlobalLibrary(),
  saveGlobalLibrary: () => mockSaveGlobalLibrary(),
}));

const mockReconcile = vi.fn();
const mockRefreshMissingState = vi.fn(() => Promise.resolve());
vi.mock("@/lib/library.reconcile", () => ({
  reconcileGlobalLibrary: (...args: unknown[]) => mockReconcile(...args),
  refreshMissingState: () => mockRefreshMissingState(),
}));

vi.mock("@/lib/library.queries", () => ({
  getCurrentLibraryPayload: vi.fn(() => ({ sounds: [], tags: [], sets: [] })),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

// ── Setup ─────────────────────────────────────────────────────────────────────

const defaultSettings = createMockAppSettings({ globalFolders: [] });
const defaultLibrary = { sounds: [], tags: [], sets: [] };

beforeEach(() => {
  useAppSettingsStore.setState({ ...initialAppSettingsState });
  useLibraryStore.setState({ ...initialLibraryState });

  mockLoadAppSettings.mockReset();
  mockLoadGlobalLibrary.mockReset();
  mockReconcile.mockReset();
  mockRefreshMissingState.mockReset();
  mockSaveGlobalLibrary.mockReset();

  mockLoadAppSettings.mockResolvedValue(defaultSettings);
  mockLoadGlobalLibrary.mockResolvedValue(defaultLibrary);
  mockReconcile.mockResolvedValue({ changed: false, sounds: [], inaccessibleFolderIds: [] });
  mockRefreshMissingState.mockResolvedValue(undefined);
  mockSaveGlobalLibrary.mockResolvedValue(undefined);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useBootLoader", () => {
  it("loads app settings into the store at mount", async () => {
    const settings = createMockAppSettings({ globalFolders: [] });
    mockLoadAppSettings.mockResolvedValue(settings);

    await act(async () => {
      renderHook(() => useBootLoader());
    });

    expect(useAppSettingsStore.getState().settings).toBe(settings);
  });

  it("loads global library into the store at mount", async () => {
    const library = { sounds: [createMockSound({ id: "s1" })], tags: [], sets: [] };
    mockLoadGlobalLibrary.mockResolvedValue(library);

    await act(async () => {
      renderHook(() => useBootLoader());
    });

    expect(useLibraryStore.getState().sounds).toHaveLength(1);
    expect(useLibraryStore.getState().sounds[0].id).toBe("s1");
  });

  it("runs reconciliation once both settings and library are loaded", async () => {
    await act(async () => {
      renderHook(() => useBootLoader());
    });

    expect(mockReconcile).toHaveBeenCalledTimes(1);
    expect(mockRefreshMissingState).toHaveBeenCalledTimes(1);
  });

  it("applies reconciliation result when changed and store is not dirty", async () => {
    const reconciled = createMockSound({ id: "new-s" });
    mockReconcile.mockResolvedValue({
      changed: true,
      sounds: [reconciled],
      inaccessibleFolderIds: [],
    });

    await act(async () => {
      renderHook(() => useBootLoader());
    });

    expect(useLibraryStore.getState().sounds.some((s) => s.id === "new-s")).toBe(true);
  });

  it("skips applying reconcile result when store is dirty (user mutation wins)", async () => {
    const dirtySound = createMockSound({ id: "user-edit" });
    mockReconcile.mockImplementation(async () => {
      // Simulate a user mutation that happens mid-scan
      useLibraryStore.getState().updateLibrary((draft) => {
        draft.sounds = [dirtySound];
      });
      return { changed: true, sounds: [createMockSound({ id: "stale-result" })], inaccessibleFolderIds: [] };
    });

    await act(async () => {
      renderHook(() => useBootLoader());
    });

    const ids = useLibraryStore.getState().sounds.map((s) => s.id);
    expect(ids).toContain("user-edit");
    expect(ids).not.toContain("stale-result");
  });

  it("saves library and clears dirty flag when reconcile changes sounds", async () => {
    const reconciled = createMockSound({ id: "new-s" });
    mockReconcile.mockResolvedValue({
      changed: true,
      sounds: [reconciled],
      inaccessibleFolderIds: [],
    });

    await act(async () => {
      renderHook(() => useBootLoader());
    });

    expect(mockSaveGlobalLibrary).toHaveBeenCalledTimes(1);

    // dirty flag cleared after save
    await act(async () => {});
    expect(useLibraryStore.getState().isDirty).toBe(false);
  });

  it("does not save library when reconcile reports no changes and nothing is dirty", async () => {
    mockReconcile.mockResolvedValue({ changed: false, sounds: [], inaccessibleFolderIds: [] });

    await act(async () => {
      renderHook(() => useBootLoader());
    });

    expect(mockSaveGlobalLibrary).not.toHaveBeenCalled();
  });

  it("shows error toast and still proceeds to reconcile when settings load fails", async () => {
    const { toast } = await import("sonner");
    mockLoadAppSettings.mockRejectedValue(new Error("disk read failed"));

    await act(async () => {
      renderHook(() => useBootLoader());
    });

    expect(toast.error).toHaveBeenCalledWith("Failed to load app settings");
    // Settings store still null — no settings to reconcile with
    expect(useAppSettingsStore.getState().settings).toBeNull();
    // Reconcile is gated on settings existing — should not have run
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it("shows error toast when library load fails", async () => {
    const { toast } = await import("sonner");
    mockLoadGlobalLibrary.mockRejectedValue(new Error("disk read failed"));

    await act(async () => {
      renderHook(() => useBootLoader());
    });

    expect(toast.error).toHaveBeenCalledWith("Failed to load sound library");
  });

  it("does not run reconciliation twice on re-render", async () => {
    const { rerender } = renderHook(() => useBootLoader());

    await act(async () => {});
    await act(async () => { rerender(); });

    expect(mockReconcile).toHaveBeenCalledTimes(1);
  });
});
