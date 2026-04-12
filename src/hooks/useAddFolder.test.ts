import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAddFolder } from "./useAddFolder";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { createMockAppSettings, createMockGlobalFolder } from "@/test/factories";
import { open } from "@tauri-apps/plugin-dialog";

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/library.reconcile", () => ({
  reconcileGlobalLibrary: vi.fn(),
}));

const mockSaveLibrary = vi.fn();
vi.mock("@/lib/library.queries", () => ({
  useSaveGlobalLibrary: () => ({ mutateAsync: mockSaveLibrary }),
}));

const mockSaveSettings = vi.fn();
const mockUseAppSettings = vi.fn();
vi.mock("@/lib/appSettings.queries", () => ({
  useAppSettings: () => mockUseAppSettings(),
  useSaveAppSettings: () => ({ mutateAsync: mockSaveSettings }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

import { reconcileGlobalLibrary } from "@/lib/library.reconcile";
import { toast } from "sonner";

const mockReconcile = reconcileGlobalLibrary as ReturnType<typeof vi.fn>;
const mockOpen = open as unknown as ReturnType<typeof vi.fn>;
const mockToastSuccess = toast.success as ReturnType<typeof vi.fn>;
const mockToastError = toast.error as ReturnType<typeof vi.fn>;

beforeEach(() => {
  useLibraryStore.setState({ ...initialLibraryState });
  mockSaveLibrary.mockReset();
  mockSaveSettings.mockReset();
  mockUseAppSettings.mockReset();
  mockReconcile.mockReset();
  mockOpen.mockReset();
  mockToastSuccess.mockReset();
  mockToastError.mockReset();
});

describe("useAddFolder", () => {
  it("no-ops when settings are unavailable", async () => {
    mockUseAppSettings.mockReturnValue({ data: undefined });
    const { result } = renderHook(() => useAddFolder());

    await act(async () => {
      await result.current.handleAddFolder();
    });

    expect(mockOpen).not.toHaveBeenCalled();
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it("bails out silently when the user cancels the directory picker", async () => {
    mockUseAppSettings.mockReturnValue({ data: createMockAppSettings({ globalFolders: [] }) });
    mockOpen.mockResolvedValue(null);

    const { result } = renderHook(() => useAddFolder());
    await act(async () => {
      await result.current.handleAddFolder();
    });

    expect(mockSaveSettings).not.toHaveBeenCalled();
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it("shows an error toast and aborts when the folder path is already present", async () => {
    const existing = createMockGlobalFolder({ path: "/music/existing" });
    mockUseAppSettings.mockReturnValue({
      data: createMockAppSettings({ globalFolders: [existing] }),
    });
    mockOpen.mockResolvedValue("/music/existing");

    const { result } = renderHook(() => useAddFolder());
    await act(async () => {
      await result.current.handleAddFolder();
    });

    expect(mockToastError).toHaveBeenCalledWith("That folder is already in your library.");
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it("calls open, saves settings, reconciles, and saves the library when changed", async () => {
    mockUseAppSettings.mockReturnValue({
      data: createMockAppSettings({ globalFolders: [] }),
    });
    mockOpen.mockResolvedValue("/music/new");
    mockReconcile.mockResolvedValue({ changed: true, sounds: [] });

    const { result } = renderHook(() => useAddFolder());
    await act(async () => {
      await result.current.handleAddFolder();
    });

    expect(mockOpen).toHaveBeenCalledWith({ directory: true });
    expect(mockSaveSettings).toHaveBeenCalledTimes(1);
    const savedSettings = mockSaveSettings.mock.calls[0][0];
    expect(savedSettings.globalFolders).toHaveLength(1);
    expect(savedSettings.globalFolders[0].path).toBe("/music/new");
    expect(savedSettings.globalFolders[0].name).toBe("new");

    expect(mockReconcile).toHaveBeenCalledTimes(1);
    expect(mockSaveLibrary).toHaveBeenCalledTimes(1);
    expect(mockToastSuccess).toHaveBeenCalledWith(`Folder "new" added`);
  });

  it("does not save the library when reconcile reports no changes", async () => {
    mockUseAppSettings.mockReturnValue({
      data: createMockAppSettings({ globalFolders: [] }),
    });
    mockOpen.mockResolvedValue("/music/new");
    mockReconcile.mockResolvedValue({ changed: false, sounds: [] });

    const { result } = renderHook(() => useAddFolder());
    await act(async () => {
      await result.current.handleAddFolder();
    });

    expect(mockSaveSettings).toHaveBeenCalledTimes(1);
    expect(mockReconcile).toHaveBeenCalledTimes(1);
    expect(mockSaveLibrary).not.toHaveBeenCalled();
    expect(mockToastSuccess).toHaveBeenCalled();
  });

  it("exposes isAddingFolder as false after completion", async () => {
    mockUseAppSettings.mockReturnValue({
      data: createMockAppSettings({ globalFolders: [] }),
    });
    mockOpen.mockResolvedValue(null);

    const { result } = renderHook(() => useAddFolder());
    expect(result.current.isAddingFolder).toBe(false);
    await act(async () => {
      await result.current.handleAddFolder();
    });
    expect(result.current.isAddingFolder).toBe(false);
  });

  it("sets isAddingFolder to true while folder is being added", async () => {
    mockUseAppSettings.mockReturnValue({
      data: createMockAppSettings({ globalFolders: [] }),
    });

    let resolve!: (v: string | null) => void;
    mockOpen.mockImplementationOnce(
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
});
