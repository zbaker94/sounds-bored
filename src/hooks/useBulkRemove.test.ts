import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBulkRemove } from "./useBulkRemove";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { useAppSettingsStore, initialAppSettingsState } from "@/state/appSettingsStore";
import { useUiStore, initialUiState } from "@/state/uiStore";
import {
  createMockAppSettings,
  createMockGlobalFolder,
  createMockSound,
} from "@/test/factories";

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/library.reconcile", () => ({
  refreshMissingState: vi.fn(),
}));

vi.mock("@/lib/audio/bufferCache", () => ({
  evictBuffer: vi.fn(),
}));

vi.mock("@/lib/audio/streamingCache", () => ({
  evictStreamingElement: vi.fn(),
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

// ── Helpers ──────────────────────────────────────────────────────────────────

import { refreshMissingState } from "@/lib/library.reconcile";
import { evictBuffer } from "@/lib/audio/bufferCache";
import { evictStreamingElement } from "@/lib/audio/streamingCache";
import { toast } from "sonner";

const mockRefreshMissingState = refreshMissingState as ReturnType<typeof vi.fn>;
const mockEvictBuffer = evictBuffer as ReturnType<typeof vi.fn>;
const mockEvictStreaming = evictStreamingElement as ReturnType<typeof vi.fn>;
const mockToastSuccess = toast.success as ReturnType<typeof vi.fn>;
const mockToastWarning = toast.warning as ReturnType<typeof vi.fn>;
const mockToastError = toast.error as ReturnType<typeof vi.fn>;

beforeEach(() => {
  useLibraryStore.setState({ ...initialLibraryState });
  useAppSettingsStore.setState({ ...initialAppSettingsState });
  useUiStore.setState({ ...initialUiState });
  mockSaveLibrary.mockReset();
  mockSaveSettings.mockReset();
  mockRefreshMissingState.mockReset();
  mockEvictBuffer.mockReset();
  mockEvictStreaming.mockReset();
  mockToastSuccess.mockReset();
  mockToastWarning.mockReset();
  mockToastError.mockReset();

  mockRefreshMissingState.mockResolvedValue(undefined);
});

describe("useBulkRemove", () => {
  describe("handleRemoveAllMissingSounds", () => {
    it("removes missing sounds from the library and re-checks missing state", async () => {
      const present = createMockSound({ id: "s-present" });
      const missing1 = createMockSound({ id: "s-missing-1" });
      const missing2 = createMockSound({ id: "s-missing-2" });

      useLibraryStore.setState({
        ...initialLibraryState,
        sounds: [present, missing1, missing2],
        missingSoundIds: new globalThis.Set(["s-missing-1", "s-missing-2"]),
      });
      useAppSettingsStore.setState({ ...initialAppSettingsState, settings: createMockAppSettings({ globalFolders: [] }) });

      const { result } = renderHook(() => useBulkRemove());
      await act(async () => {
        await result.current.handleRemoveAllMissingSounds();
      });

      const latest = useLibraryStore.getState().sounds;
      expect(latest.map((s) => s.id)).toEqual(["s-present"]);

      expect(mockEvictBuffer).toHaveBeenCalledWith("s-missing-1");
      expect(mockEvictBuffer).toHaveBeenCalledWith("s-missing-2");
      expect(mockEvictStreaming).toHaveBeenCalledTimes(2);

      expect(mockSaveLibrary).toHaveBeenCalledTimes(1);
      // Must pass explicit globalFolders so the check uses current settings, not Zustand store
      expect(mockRefreshMissingState).toHaveBeenCalledTimes(1);
      expect(mockRefreshMissingState).toHaveBeenCalledWith([]);
      expect(mockToastSuccess).toHaveBeenCalledWith("2 missing sounds removed");
    });

    it("no-ops when settings are unavailable", async () => {
      // settings is null by default in initialAppSettingsState
      const { result } = renderHook(() => useBulkRemove());

      await act(async () => {
        await result.current.handleRemoveAllMissingSounds();
      });

      expect(mockSaveLibrary).not.toHaveBeenCalled();
    });

    it("uses live store settings — settings updated after render are reflected in handler", async () => {
      // Prove the handler reads from Zustand, not a stale React-render closure.
      // Seed with settingsA, render, then change store to settingsB before invoking.
      const settingsA = createMockAppSettings({ globalFolders: [] });
      const settingsB = createMockAppSettings({ globalFolders: [createMockGlobalFolder({ path: "/new" })] });
      const missing = createMockSound({ id: "s-miss" });

      useAppSettingsStore.setState({ ...initialAppSettingsState, settings: settingsA });
      useLibraryStore.setState({
        ...initialLibraryState,
        sounds: [missing],
        missingSoundIds: new globalThis.Set(["s-miss"]),
      });

      const { result } = renderHook(() => useBulkRemove());

      // Update store after initial render (simulates settings save between renders)
      await act(async () => {
        useAppSettingsStore.setState({ ...initialAppSettingsState, settings: settingsB });
      });

      await act(async () => {
        await result.current.handleRemoveAllMissingSounds();
      });

      // Must use settingsB.globalFolders — not stale settingsA value
      expect(mockRefreshMissingState).toHaveBeenCalledWith(settingsB.globalFolders);
    });
  });

  describe("handleRemoveAllMissingFolders", () => {
    it("skips folders assigned as download/import destinations", async () => {
      const downloadFolder = createMockGlobalFolder({ id: "dl", name: "DL", path: "/dl" });
      const importFolder = createMockGlobalFolder({ id: "imp", name: "IMP", path: "/imp" });
      const regularFolder = createMockGlobalFolder({ id: "reg", name: "REG", path: "/reg" });

      const settings = createMockAppSettings({
        globalFolders: [downloadFolder, importFolder, regularFolder],
        downloadFolderId: "dl",
        importFolderId: "imp",
      });
      useAppSettingsStore.setState({ ...initialAppSettingsState, settings });

      const folderSound = createMockSound({ id: "fs", folderId: "reg" });
      useLibraryStore.setState({
        ...initialLibraryState,
        sounds: [folderSound],
        missingFolderIds: new globalThis.Set(["dl", "imp", "reg"]),
      });

      const { result } = renderHook(() => useBulkRemove());
      await act(async () => {
        await result.current.handleRemoveAllMissingFolders();
      });

      expect(mockSaveSettings).toHaveBeenCalledTimes(1);
      const savedSettings = mockSaveSettings.mock.calls[0][0];
      const savedFolderIds = savedSettings.globalFolders.map((f: { id: string }) => f.id);
      expect(savedFolderIds).toEqual(["dl", "imp"]);

      const remainingSoundIds = useLibraryStore.getState().sounds.map((s) => s.id);
      expect(remainingSoundIds).toEqual([]);

      expect(mockToastSuccess).toHaveBeenCalledWith(
        "1 missing folder and 1 sound removed",
      );
      expect(mockToastWarning).toHaveBeenCalledWith(
        "2 folders skipped — assigned as download or import destination",
      );
      // Must pass updatedSettings.globalFolders (not store) since settings were just saved
      expect(mockRefreshMissingState).toHaveBeenCalledTimes(1);
      const passedFolders = mockRefreshMissingState.mock.calls[0][0] as Array<{ id: string }>;
      expect(passedFolders.map((f) => f.id)).toContain("dl");
      expect(passedFolders.map((f) => f.id)).toContain("imp");
      expect(passedFolders.map((f) => f.id)).not.toContain("reg");
    });

    it("early-returns with a warning when every missing folder is assigned", async () => {
      const downloadFolder = createMockGlobalFolder({ id: "dl", path: "/dl" });
      const settings = createMockAppSettings({
        globalFolders: [downloadFolder],
        downloadFolderId: "dl",
        importFolderId: undefined,
      });
      useAppSettingsStore.setState({ ...initialAppSettingsState, settings });

      useLibraryStore.setState({
        ...initialLibraryState,
        missingFolderIds: new globalThis.Set(["dl"]),
      });

      const { result } = renderHook(() => useBulkRemove());
      await act(async () => {
        await result.current.handleRemoveAllMissingFolders();
      });

      expect(mockSaveSettings).not.toHaveBeenCalled();
      expect(mockSaveLibrary).not.toHaveBeenCalled();
      expect(mockToastWarning).toHaveBeenCalled();
    });
  });

  describe("state hooks", () => {
    it("closes the sounds confirm dialog via uiStore when the handler completes", async () => {
      useAppSettingsStore.setState({ ...initialAppSettingsState, settings: createMockAppSettings({ globalFolders: [] }) });
      useUiStore.getState().setConfirmRemoveMissingSoundsOpen(true);
      expect(useUiStore.getState().confirmRemoveMissingSoundsOpen).toBe(true);

      const { result } = renderHook(() => useBulkRemove());
      await act(async () => {
        await result.current.handleRemoveAllMissingSounds();
      });

      expect(useUiStore.getState().confirmRemoveMissingSoundsOpen).toBe(false);
    });
  });

  describe("error paths", () => {
    it("shows error toast and resets isBulkRemoving when saveLibrary throws in handleRemoveAllMissingSounds", async () => {
      const missing = createMockSound({ id: "s-missing" });
      useLibraryStore.setState({
        ...initialLibraryState,
        sounds: [missing],
        missingSoundIds: new globalThis.Set(["s-missing"]),
      });
      useAppSettingsStore.setState({ ...initialAppSettingsState, settings: createMockAppSettings({ globalFolders: [] }) });
      mockSaveLibrary.mockRejectedValueOnce(new Error("disk full"));
      useUiStore.getState().setConfirmRemoveMissingSoundsOpen(true);

      const { result } = renderHook(() => useBulkRemove());
      await act(async () => {
        await result.current.handleRemoveAllMissingSounds();
      });

      expect(mockToastError).toHaveBeenCalledWith("Failed to remove missing sounds");
      expect(result.current.isBulkRemoving).toBe(false);
      expect(useUiStore.getState().confirmRemoveMissingSoundsOpen).toBe(false);
    });

    it("shows error toast and resets isBulkRemoving when saveSettings throws in handleRemoveAllMissingFolders", async () => {
      const folder = createMockGlobalFolder({ id: "f1", path: "/f1" });
      const settings = createMockAppSettings({
        globalFolders: [folder],
        downloadFolderId: undefined,
        importFolderId: undefined,
      });
      useAppSettingsStore.setState({ ...initialAppSettingsState, settings });
      useLibraryStore.setState({
        ...initialLibraryState,
        missingFolderIds: new globalThis.Set(["f1"]),
      });
      mockSaveSettings.mockRejectedValueOnce(new Error("disk full"));
      useUiStore.getState().setConfirmRemoveMissingFoldersOpen(true);

      const { result } = renderHook(() => useBulkRemove());
      await act(async () => {
        await result.current.handleRemoveAllMissingFolders();
      });

      expect(mockToastError).toHaveBeenCalledWith("Failed to remove missing folders");
      expect(result.current.isBulkRemoving).toBe(false);
      expect(useUiStore.getState().confirmRemoveMissingFoldersOpen).toBe(false);
    });

    it("removes only non-assigned folders when some are assigned (mixed case)", async () => {
      const assignedDl = createMockGlobalFolder({ id: "dl", path: "/dl" });
      const removable1 = createMockGlobalFolder({ id: "r1", path: "/r1" });
      const removable2 = createMockGlobalFolder({ id: "r2", path: "/r2" });

      const settings = createMockAppSettings({
        globalFolders: [assignedDl, removable1, removable2],
        downloadFolderId: "dl",
        importFolderId: undefined,
      });
      useAppSettingsStore.setState({ ...initialAppSettingsState, settings });

      useLibraryStore.setState({
        ...initialLibraryState,
        sounds: [],
        missingFolderIds: new globalThis.Set(["dl", "r1", "r2"]),
      });

      const { result } = renderHook(() => useBulkRemove());
      await act(async () => {
        await result.current.handleRemoveAllMissingFolders();
      });

      expect(mockSaveSettings).toHaveBeenCalledTimes(1);
      const savedSettings = mockSaveSettings.mock.calls[0][0];
      const savedFolderIds = savedSettings.globalFolders.map(
        (f: { id: string }) => f.id,
      );
      expect(savedFolderIds).toEqual(["dl"]);

      expect(mockToastSuccess).toHaveBeenCalledWith(
        "2 missing folders and 0 sounds removed",
      );
      expect(mockToastWarning).toHaveBeenCalledWith(
        "1 folder skipped — assigned as download or import destination",
      );
    });
  });
});
