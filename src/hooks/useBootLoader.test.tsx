import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrictMode } from "react";
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
vi.mock("@/lib/library", async () => {
  const actual = await vi.importActual<typeof import("@/lib/library")>("@/lib/library");
  return {
    ...actual,
    loadGlobalLibrary: (options?: { onCorruption?: (msg: string) => void }) =>
      mockLoadGlobalLibrary(options),
  };
});

const mockReconcile = vi.fn();
const mockRefreshMissingState = vi.fn(() => Promise.resolve());
const mockScheduleAnalysisForUnanalyzed = vi.fn((..._args: unknown[]) => Promise.resolve());
vi.mock("@/lib/library.reconcile", () => ({
  reconcileGlobalLibrary: (...args: unknown[]) => mockReconcile(...args),
  refreshMissingState: () => mockRefreshMissingState(),
  scheduleAnalysisForUnanalyzed: (...args: unknown[]) =>
    mockScheduleAnalysisForUnanalyzed(...args),
}));

const mockSaveCurrentLibrarySync = vi.fn();
vi.mock("@/lib/library.queries", () => ({
  getCurrentLibraryPayload: vi.fn(() => ({ sounds: [], tags: [], sets: [] })),
  useSaveCurrentLibrary: () => ({
    saveCurrentLibrarySync: mockSaveCurrentLibrarySync,
  }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

const mockRestorePathScope = vi.fn();
vi.mock("@/lib/scope", () => ({
  restorePathScope: (...args: unknown[]) => mockRestorePathScope(...args),
  pickFolder: vi.fn(),
  pickFile: vi.fn(),
  pickFiles: vi.fn(),
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
  mockScheduleAnalysisForUnanalyzed.mockReset();
  mockSaveCurrentLibrarySync.mockReset();
  mockRestorePathScope.mockReset();

  mockLoadAppSettings.mockResolvedValue(defaultSettings);
  mockLoadGlobalLibrary.mockResolvedValue(defaultLibrary);
  mockReconcile.mockResolvedValue({ changed: false, sounds: [], inaccessibleFolderIds: [] });
  mockRefreshMissingState.mockResolvedValue(undefined);
  mockScheduleAnalysisForUnanalyzed.mockResolvedValue(undefined);
  // Simplified sync mock: real mutate() is async but act() flushes microtasks,
  // so the timing difference does not affect any current assertion.
  mockSaveCurrentLibrarySync.mockImplementation(() => {
    useLibraryStore.getState().clearDirtyFlag();
  });
  mockRestorePathScope.mockResolvedValue(undefined);
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

    expect(mockSaveCurrentLibrarySync).toHaveBeenCalledTimes(1);

    // dirty flag cleared after save
    await act(async () => {});
    expect(useLibraryStore.getState().isDirty).toBe(false);
  });

  it("does not save library when reconcile reports no changes and nothing is dirty", async () => {
    mockReconcile.mockResolvedValue({ changed: false, sounds: [], inaccessibleFolderIds: [] });

    await act(async () => {
      renderHook(() => useBootLoader());
    });

    expect(mockSaveCurrentLibrarySync).not.toHaveBeenCalled();
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

  it("shows error toast when library load fails with unexpected I/O error", async () => {
    const { toast } = await import("sonner");
    mockLoadGlobalLibrary.mockRejectedValue(new Error("disk read failed"));

    await act(async () => {
      renderHook(() => useBootLoader());
    });

    expect(toast.error).toHaveBeenCalledWith("Failed to load sound library");
  });

  it("shows warning toast when library load recovers from corruption", async () => {
    const { toast } = await import("sonner");
    const corruptionMessage =
      "library.json was corrupt and has been reset. Your sound library has been cleared.";
    mockLoadGlobalLibrary.mockImplementation(
      (options?: { onCorruption?: (msg: string) => void }) => {
        options?.onCorruption?.(corruptionMessage);
        return Promise.resolve(defaultLibrary);
      },
    );

    await act(async () => {
      renderHook(() => useBootLoader());
    });

    expect(toast.warning).toHaveBeenCalledWith(corruptionMessage);
  });

  it("does not run reconciliation twice under StrictMode (hasReconciled guard)", async () => {
    // React StrictMode deliberately double-invokes effects to surface side-effect bugs.
    // hasReconciled.current must block the second invocation — this test proves it.
    await act(async () => {
      renderHook(() => useBootLoader(), {
        wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
      });
    });

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

  it("shows error toast when save fails after reconcile changes sounds", async () => {
    const { toast } = await import("sonner");
    mockReconcile.mockResolvedValue({
      changed: true,
      sounds: [createMockSound({ id: "new-s" })],
      inaccessibleFolderIds: [],
    });
    mockSaveCurrentLibrarySync.mockImplementation(
      (options?: { onError?: (err: unknown) => void }) => {
        options?.onError?.(new Error("disk full"));
      },
    );

    await act(async () => {
      renderHook(() => useBootLoader());
    });

    expect(toast.error).toHaveBeenCalledWith("Failed to save sound library");
  });

  it("grants scope access for each globalFolder before reconciliation", async () => {
    const folderA = createMockGlobalFolder({ path: "/music/a" });
    const folderB = createMockGlobalFolder({ path: "/sounds/b" });
    const settings = createMockAppSettings({ globalFolders: [folderA, folderB] });
    mockLoadAppSettings.mockResolvedValue(settings);

    const grantCallOrder: string[] = [];
    mockRestorePathScope.mockImplementation((p: string) => {
      grantCallOrder.push(`grant:${p}`);
      return Promise.resolve();
    });
    mockReconcile.mockImplementation((..._args: unknown[]) => {
      grantCallOrder.push("reconcile");
      return Promise.resolve({ changed: false, sounds: [], inaccessibleFolderIds: [] });
    });

    await act(async () => {
      renderHook(() => useBootLoader());
    });

    expect(mockRestorePathScope).toHaveBeenCalledWith(folderA.path);
    expect(mockRestorePathScope).toHaveBeenCalledWith(folderB.path);
    // Both grants must appear before reconcile in the call order
    const reconcileIdx = grantCallOrder.indexOf("reconcile");
    expect(grantCallOrder.indexOf(`grant:${folderA.path}`)).toBeLessThan(reconcileIdx);
    expect(grantCallOrder.indexOf(`grant:${folderB.path}`)).toBeLessThan(reconcileIdx);
  });

  it("still becomes ready:true and runs reconciliation when a grant fails", async () => {
    const { toast } = await import("sonner");
    const folder = createMockGlobalFolder({ path: "/music/a" });
    const settings = createMockAppSettings({ globalFolders: [folder] });
    mockLoadAppSettings.mockResolvedValue(settings);
    mockRestorePathScope.mockRejectedValue(new Error("scope denied"));

    const { result } = renderHook(() => useBootLoader());
    await act(async () => {});

    expect(result.current.ready).toBe(true);
    expect(mockReconcile).toHaveBeenCalledTimes(1);
    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining("Could not re-grant access to 1 folder(s)")
    );
  });

  it("does not call restorePathScope when globalFolders is empty", async () => {
    mockLoadAppSettings.mockResolvedValue(createMockAppSettings({ globalFolders: [] }));

    await act(async () => {
      renderHook(() => useBootLoader());
    });

    expect(mockRestorePathScope).not.toHaveBeenCalled();
  });
});

describe("useBootLoader — analysis scheduling", () => {
  it("schedules analysis on boot when autoAnalysis is true", async () => {
    mockLoadAppSettings.mockResolvedValue(
      createMockAppSettings({ autoAnalysis: true, globalFolders: [] }),
    );

    await act(async () => {
      renderHook(() => useBootLoader());
    });

    expect(mockScheduleAnalysisForUnanalyzed).toHaveBeenCalledTimes(1);
  });

  it("does not schedule analysis on boot when autoAnalysis is false", async () => {
    mockLoadAppSettings.mockResolvedValue(
      createMockAppSettings({ autoAnalysis: false, globalFolders: [] }),
    );

    await act(async () => {
      renderHook(() => useBootLoader());
    });

    expect(mockScheduleAnalysisForUnanalyzed).not.toHaveBeenCalled();
  });

  it("does not schedule analysis when settings fail to load", async () => {
    mockLoadAppSettings.mockRejectedValue(new Error("disk read failed"));

    await act(async () => {
      renderHook(() => useBootLoader());
    });

    expect(mockScheduleAnalysisForUnanalyzed).not.toHaveBeenCalled();
  });

  it("schedules analysis with sounds from the post-reconcile store state", async () => {
    const unanalyzed = createMockSound({
      id: "unanalyzed-1",
      filePath: "/a/kick.wav",
      loudnessLufs: undefined,
    });
    mockLoadAppSettings.mockResolvedValue(
      createMockAppSettings({ autoAnalysis: true, globalFolders: [] }),
    );
    mockReconcile.mockResolvedValue({
      changed: true,
      sounds: [unanalyzed],
      inaccessibleFolderIds: [],
    });

    await act(async () => {
      renderHook(() => useBootLoader());
    });

    expect(mockScheduleAnalysisForUnanalyzed).toHaveBeenCalledTimes(1);
    // Reads from the store post-reconcile, so it sees the reconciled sound
    const passedSounds = mockScheduleAnalysisForUnanalyzed.mock.calls[0][0] as Array<{ id: string }>;
    expect(passedSounds.some((s) => s.id === "unanalyzed-1")).toBe(true);
  });
});
