import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResolveMissingFolderDialog } from "./ResolveMissingFolderDialog";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { useAppSettingsStore, initialAppSettingsState } from "@/state/appSettingsStore";
import { createMockAppSettings, createMockGlobalFolder, createMockSound } from "@/test/factories";

vi.mock("@tauri-apps/plugin-fs", () => ({
  copyFile: vi.fn(() => Promise.resolve()),
  rename: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/path", () => ({
  basename: vi.fn(async (path: string) => {
    const normalized = (path as string).replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? "";
  }),
  dirname: vi.fn(async (path: string) => {
    const normalized = (path as string).replace(/\\/g, "/");
    const idx = normalized.lastIndexOf("/");
    return idx > 0 ? normalized.substring(0, idx) : "/";
  }),
  join: vi.fn(async (...paths: string[]) => paths.join("/")),
}));

vi.mock("@/lib/library.reconcile", () => ({
  reconcileGlobalLibrary: vi.fn(() =>
    Promise.resolve({ sounds: [], changed: false, inaccessibleFolderIds: [] }),
  ),
  refreshMissingState: vi.fn(() => Promise.resolve()),
  addGlobalFolderAndReconcile: vi.fn(() =>
    Promise.resolve({ updatedSettings: {}, changed: false }),
  ),
}));

vi.mock("@/lib/audio/cacheUtils", () => ({
  evictSoundCaches: vi.fn(),
  evictSoundCachesMany: vi.fn(),
}));

const mockSaveLibrary = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/library.queries", () => ({
  useSaveCurrentLibrary: () => ({ saveCurrentLibrary: mockSaveLibrary }),
}));

const mockSaveSettings = vi.fn().mockResolvedValue(undefined);
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
  grantPathAccess: vi.fn().mockResolvedValue(undefined),
  grantParentAccess: vi.fn().mockResolvedValue(undefined),
}));

import { pickFolder, pickFile } from "@/lib/scope";
const mockPickFolder = pickFolder as unknown as ReturnType<typeof vi.fn>;
const mockPickFile = pickFile as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  useLibraryStore.setState({ ...initialLibraryState });
  useAppSettingsStore.setState({ ...initialAppSettingsState });
  mockSaveLibrary.mockClear();
  mockSaveSettings.mockClear();
  mockPickFolder.mockReset();
  mockPickFile.mockReset();
});

describe("ResolveMissingFolderDialog — pickFolder / pickFile integration", () => {
  it("calls pickFolder when Locate Folder button is clicked", async () => {
    const folder = createMockGlobalFolder({
      id: "folder-1",
      path: "/music/old",
      name: "old",
    });
    useAppSettingsStore.setState({
      ...initialAppSettingsState,
      settings: createMockAppSettings({ globalFolders: [folder] }),
    });
    useLibraryStore.setState({ ...initialLibraryState });

    // Return a folder whose basename matches the existing folder.name ("old")
    // so the flow skips the rename-confirmation step.
    mockPickFolder.mockResolvedValue("/music/old");

    const onClose = vi.fn();
    render(<ResolveMissingFolderDialog folder={folder} onClose={onClose} />);

    await userEvent.click(screen.getByRole("button", { name: /locate folder/i }));

    expect(mockPickFolder).toHaveBeenCalledTimes(1);
  });

  it("does nothing when handleLocateFolder dialog is cancelled", async () => {
    const folder = createMockGlobalFolder({
      id: "folder-1",
      path: "/music/old",
      name: "old",
    });
    useAppSettingsStore.setState({
      ...initialAppSettingsState,
      settings: createMockAppSettings({ globalFolders: [folder] }),
    });

    mockPickFolder.mockResolvedValue(null);

    const onClose = vi.fn();
    render(<ResolveMissingFolderDialog folder={folder} onClose={onClose} />);

    await userEvent.click(screen.getByRole("button", { name: /locate folder/i }));

    expect(mockPickFolder).toHaveBeenCalledTimes(1);
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it("calls pickFile when Locate File button is clicked in per-file resolution step", async () => {
    const folder = createMockGlobalFolder({
      id: "folder-1",
      path: "/music/old",
      name: "old",
    });
    const missingSound = createMockSound({
      id: "snd-1",
      name: "Kick",
      folderId: folder.id,
      filePath: "/music/old/kick.wav",
    });
    useAppSettingsStore.setState({
      ...initialAppSettingsState,
      settings: createMockAppSettings({ globalFolders: [folder] }),
    });
    useLibraryStore.setState({
      ...initialLibraryState,
      sounds: [missingSound],
      missingSoundIds: new Set([missingSound.id]),
    });

    // First: folder picker — same-name folder so no rename confirmation step
    mockPickFolder.mockResolvedValue("/music/old");

    const onClose = vi.fn();
    render(<ResolveMissingFolderDialog folder={folder} onClose={onClose} />);

    await userEvent.click(screen.getByRole("button", { name: /locate folder/i }));

    // Now in "resolving-files" step — find the per-file locate button
    const locateFileBtn = await screen.findByRole("button", { name: /locate file/i });

    // Second: file picker
    mockPickFile.mockResolvedValue("/music/new/kick.wav");
    await userEvent.click(locateFileBtn);

    expect(mockPickFile).toHaveBeenCalledTimes(1);
    expect(mockPickFile).toHaveBeenCalledWith(
      expect.objectContaining({ filters: expect.any(Array) })
    );
  });
});
