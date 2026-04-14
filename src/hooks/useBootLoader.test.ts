import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBootLoader } from "./useBootLoader";
import { useAppSettingsStore, initialAppSettingsState } from "@/state/appSettingsStore";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { createMockAppSettings, createMockGlobalFolder, createMockSound } from "@/test/factories";

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
  it("returns ready:false before loads complete and ready:true after", async () => {
    let resolveSettings!: (v: unknown) => void;
    let resolveLibrary!: (v: unknown) => void;
    mockLoadAppSettings.mockReturnValue(new Promise((r) => { resolveSettings = r; }));
    mockLoadGlobalLibrary.mockReturnValue(new Promise((r) => { resolveLibrary = r; }));

    const { result } = renderHook(() => useBootLoader());
    expect(result.current.ready).toBe(false);

    await act(async () => { resolveSettings(defaultSettings); });
    // library still pending — not ready yet
    expect(result.current.ready).toBe(false);

    await act(async () => { resolveLibrary(defaultLibrary); });
    expect(result.current.ready).toBe(true);
  });

  it("still becomes ready:true when settings load fails", async () => {
    mockLoadAppSettings.mockRejectedValue(new Error("disk read failed"));
    const { result } = renderHook(() => useBootLoader());
    await act(async () => {});
    expect(result.current.ready).toBe(true);
  });

  it("still becomes ready:true when library load fails", async () => {
    mockLoadGlobalLibrary.mockRejectedValue(new Error("disk read failed"));
    const { result } = renderHook(() => useBootLoader());
    await act(async () => {});
    expect(result.current.ready).toBe(true);
  });

  it("loads app settings into the store at mount and does not re-load on re-render", async () => {
    const settings = createMockAppSettings({ globalFolders: [] });
    mockLoadAppSettings.mockResolvedValue(settings);

    const { rerender } = renderHook(() => useBootLoader());
    await act(async () => {});

    expect(useAppSettingsStore.getState().settings).toBe(settings);

    // Mutate store after load (simulates user changing settings)
    const updatedSettings = createMockAppSettings({ globalFolders: [createMockGlobalFolder()] });
    useAppSettingsStore.getState().loadSettings(updatedSettings);

    // Re-render must NOT trigger another disk read that would clobber the mutation
    rerender();
    await act(async () => {});
    expect(mockLoadAppSettings).toHaveBeenCalledTimes(1);
    expect(useAppSettingsStore.getState().settings).toBe(updatedSettings);
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

  it("skips applying reconcile result when a user mutation arrives while scan is in-flight", async () => {
    // The actual race: reconcile is running async, user mutates the store,
    // then reconcile resolves — the user's mutation must win.
    const dirtySound = createMockSound({ id: "user-edit" });
    const staleSound = createMockSound({ id: "stale-result" });

    let resolveReconcile!: (v: unknown) => void;
    mockReconcile.mockReturnValue(
      new Promise((r) => { resolveReconcile = r; }),
    );

    renderHook(() => useBootLoader());
    // Let effects fire so reconcile is now in-flight
    await act(async () => {});

    // User mutation arrives while scan is still running
    useLibraryStore.getState().updateLibrary((draft) => {
      draft.sounds = [dirtySound];
    });
    expect(useLibraryStore.getState().isDirty).toBe(true);

    // Reconcile resolves with stale data — dirty guard must block the overwrite
    await act(async () => {
      resolveReconcile({ changed: true, sounds: [staleSound], inaccessibleFolderIds: [] });
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

  it("shows error toast and still proceeds when settings load fails", async () => {
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

  it("does not run reconciliation more than once regardless of re-renders", async () => {
    const { rerender } = renderHook(() => useBootLoader());

    await act(async () => {});
    rerender();
    await act(async () => {});
    rerender();
    await act(async () => {});

    expect(mockReconcile).toHaveBeenCalledTimes(1);
  });

  it("still calls refreshMissingState when reconcile throws", async () => {
    const { toast } = await import("sonner");
    mockReconcile.mockRejectedValue(new Error("permission denied"));

    await act(async () => {
      renderHook(() => useBootLoader());
    });

    expect(toast.error).toHaveBeenCalledWith("Failed to scan sound folders");
    expect(mockRefreshMissingState).toHaveBeenCalledTimes(1);
  });

  it("shows error toast when saveGlobalLibrary throws after reconcile changes sounds", async () => {
    const { toast } = await import("sonner");
    mockReconcile.mockResolvedValue({
      changed: true,
      sounds: [createMockSound({ id: "new-s" })],
      inaccessibleFolderIds: [],
    });
    mockSaveGlobalLibrary.mockRejectedValue(new Error("disk full"));

    await act(async () => {
      renderHook(() => useBootLoader());
    });

    expect(toast.error).toHaveBeenCalledWith("Failed to save sound library");
  });
});
