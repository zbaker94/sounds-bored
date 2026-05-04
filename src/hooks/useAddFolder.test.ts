import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAddFolder } from "./useAddFolder";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { useAppSettingsStore, initialAppSettingsState } from "@/state/appSettingsStore";
import { createMockAppSettings, createMockGlobalFolder } from "@/test/factories";

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/library.reconcile", () => ({
  addGlobalFolderAndReconcile: vi.fn(),
  scheduleAnalysisForUnanalyzed: vi.fn().mockResolvedValue(undefined),
}));

const mockSaveLibrary = vi.fn();
vi.mock("@/lib/library.queries", () => ({
  useSaveCurrentLibrary: () => ({ saveCurrentLibrary: mockSaveLibrary }),
}));

const mockSaveSettings = vi.fn();
vi.mock("@/lib/appSettings.queries", () => ({
  useSaveAppSettings: () => ({ mutateAsync: mockSaveSettings }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/lib/scope", () => ({
  pickFolder: vi.fn(),
  pickFile: vi.fn(),
  restorePathScope: vi.fn().mockResolvedValue(undefined),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

import { addGlobalFolderAndReconcile } from "@/lib/library.reconcile";
import { toast } from "sonner";
import { pickFolder } from "@/lib/scope";

const mockAddGlobalFolder = addGlobalFolderAndReconcile as ReturnType<typeof vi.fn>;
const mockPickFolder = pickFolder as unknown as ReturnType<typeof vi.fn>;
const mockToastSuccess = toast.success as ReturnType<typeof vi.fn>;
const mockToastError = toast.error as ReturnType<typeof vi.fn>;

beforeEach(() => {
  useLibraryStore.setState({ ...initialLibraryState });
  useAppSettingsStore.setState({ ...initialAppSettingsState });
  mockSaveLibrary.mockReset();
  mockSaveSettings.mockReset();
  mockAddGlobalFolder.mockReset();
  mockAddGlobalFolder.mockResolvedValue({ updatedSettings: createMockAppSettings(), changed: false });
  mockPickFolder.mockReset();
  mockToastSuccess.mockReset();
  mockToastError.mockReset();
});

describe("useAddFolder", () => {
  it("no-ops when settings are unavailable", async () => {
    // settings is null by default in initialAppSettingsState
    const { result } = renderHook(() => useAddFolder());

    await act(async () => {
      await result.current.handleAddFolder();
    });

    expect(mockPickFolder).not.toHaveBeenCalled();
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it("bails out silently when the user cancels the directory picker", async () => {
    useAppSettingsStore.setState({ ...initialAppSettingsState, settings: createMockAppSettings({ globalFolders: [] }) });
    mockPickFolder.mockResolvedValue(null);

    const { result } = renderHook(() => useAddFolder());
    await act(async () => {
      await result.current.handleAddFolder();
    });

    expect(mockAddGlobalFolder).not.toHaveBeenCalled();
  });

  it("shows an error toast and aborts when the folder path is already present", async () => {
    const existing = createMockGlobalFolder({ path: "/music/existing" });
    useAppSettingsStore.setState({ ...initialAppSettingsState, settings: createMockAppSettings({ globalFolders: [existing] }) });
    mockPickFolder.mockResolvedValue("/music/existing");

    const { result } = renderHook(() => useAddFolder());
    await act(async () => {
      await result.current.handleAddFolder();
    });

    expect(mockToastError).toHaveBeenCalledWith("That folder is already in your library.");
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it("calls addGlobalFolderAndReconcile with the new folder and saves the library when changed", async () => {
    useAppSettingsStore.setState({ ...initialAppSettingsState, settings: createMockAppSettings({ globalFolders: [] }) });
    mockPickFolder.mockResolvedValue("/music/new");
    mockAddGlobalFolder.mockResolvedValue({ updatedSettings: createMockAppSettings(), changed: true });

    const { result } = renderHook(() => useAddFolder());
    await act(async () => {
      await result.current.handleAddFolder();
    });

    expect(mockPickFolder).toHaveBeenCalledTimes(1);
    expect(mockAddGlobalFolder).toHaveBeenCalledTimes(1);
    const [folder] = mockAddGlobalFolder.mock.calls[0] as Parameters<typeof addGlobalFolderAndReconcile>;
    expect(folder.path).toBe("/music/new");
    expect(folder.name).toBe("new");
    expect(mockSaveLibrary).toHaveBeenCalledTimes(1);
    expect(mockToastSuccess).toHaveBeenCalledWith(`Folder "new" added`);
  });

  it("does not save the library when reconcile reports no changes", async () => {
    useAppSettingsStore.setState({ ...initialAppSettingsState, settings: createMockAppSettings({ globalFolders: [] }) });
    mockPickFolder.mockResolvedValue("/music/new");
    // default mock returns changed: false

    const { result } = renderHook(() => useAddFolder());
    await act(async () => {
      await result.current.handleAddFolder();
    });

    expect(mockAddGlobalFolder).toHaveBeenCalledTimes(1);
    expect(mockSaveLibrary).not.toHaveBeenCalled();
    expect(mockToastSuccess).toHaveBeenCalled();
  });

  it("exposes isAddingFolder as false after completion", async () => {
    useAppSettingsStore.setState({ ...initialAppSettingsState, settings: createMockAppSettings({ globalFolders: [] }) });
    mockPickFolder.mockResolvedValue(null);

    const { result } = renderHook(() => useAddFolder());
    expect(result.current.isAddingFolder).toBe(false);
    await act(async () => {
      await result.current.handleAddFolder();
    });
    expect(result.current.isAddingFolder).toBe(false);
  });

  it("sets isAddingFolder to true while folder is being added", async () => {
    useAppSettingsStore.setState({ ...initialAppSettingsState, settings: createMockAppSettings({ globalFolders: [] }) });

    let resolve!: (v: string | null) => void;
    mockPickFolder.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r as (v: string | null) => void;
        }),
    );

    const { result } = renderHook(() => useAddFolder());

    let addPromise!: Promise<void>;
    act(() => {
      addPromise = result.current.handleAddFolder();
    });

    expect(result.current.isAddingFolder).toBe(true);

    await act(async () => {
      resolve(null);
      await addPromise;
    });

    expect(result.current.isAddingFolder).toBe(false);
  });

  it("shows an error toast and resets isAddingFolder when addGlobalFolderAndReconcile rejects", async () => {
    useAppSettingsStore.setState({ ...initialAppSettingsState, settings: createMockAppSettings({ globalFolders: [] }) });
    mockPickFolder.mockResolvedValue("/music/new");
    mockAddGlobalFolder.mockRejectedValue(new Error("disk full"));

    const { result } = renderHook(() => useAddFolder());
    await act(async () => {
      await result.current.handleAddFolder();
    });

    expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining("disk full"));
    expect(result.current.isAddingFolder).toBe(false);
  });

  it("shows an error toast and resets isAddingFolder when saveCurrentLibrary rejects", async () => {
    useAppSettingsStore.setState({ ...initialAppSettingsState, settings: createMockAppSettings({ globalFolders: [] }) });
    mockPickFolder.mockResolvedValue("/music/new");
    mockAddGlobalFolder.mockResolvedValue({ updatedSettings: createMockAppSettings(), changed: true });
    mockSaveLibrary.mockRejectedValue(new Error("write failed"));

    const { result } = renderHook(() => useAddFolder());
    await act(async () => {
      await result.current.handleAddFolder();
    });

    expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining("write failed"));
    expect(result.current.isAddingFolder).toBe(false);
  });

  it("uses live store settings — settings changed after render are reflected in handler", async () => {
    // Prove the handler reads Zustand, not a stale React-render snapshot.
    // Seed with settingsA (empty folders), render, switch store to settingsB (one folder),
    // then open a dialog for a NEW path. The duplicate-check must use settingsB.
    const existingFolder = createMockGlobalFolder({ path: "/new-path" });
    const settingsA = createMockAppSettings({ globalFolders: [] });
    const settingsB = createMockAppSettings({ globalFolders: [existingFolder] });

    useAppSettingsStore.setState({ ...initialAppSettingsState, settings: settingsA });
    const { result } = renderHook(() => useAddFolder());

    // Update store after initial render (simulates a concurrent settings save)
    await act(async () => {
      useAppSettingsStore.setState({ ...initialAppSettingsState, settings: settingsB });
    });

    // Picking the path that NOW exists in settingsB — handler must see the updated list
    mockPickFolder.mockResolvedValue("/new-path");

    await act(async () => {
      await result.current.handleAddFolder();
    });

    // With stale settingsA, no duplicate would be detected and addGlobalFolderAndReconcile would be called.
    // With live settingsB, the duplicate check fires and it must NOT be called.
    expect(mockToastError).toHaveBeenCalledWith("That folder is already in your library.");
    expect(mockAddGlobalFolder).not.toHaveBeenCalled();
  });
});
