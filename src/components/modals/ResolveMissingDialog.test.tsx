import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResolveMissingDialog } from "./ResolveMissingDialog";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { createMockSound } from "@/test/factories";

vi.mock("@tauri-apps/api/path", () => ({
  basename: vi.fn(async (path: string) => {
    const normalized = (path as string).replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? "";
  }),
}));

vi.mock("@/lib/library.reconcile", () => ({
  refreshMissingState: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/audio/cacheUtils", () => ({
  evictSoundCaches: vi.fn(),
  evictSoundCachesMany: vi.fn(),
}));

const mockSaveLibrary = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/library.queries", () => ({
  useSaveCurrentLibrary: () => ({ saveCurrentLibrary: mockSaveLibrary }),
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

import { pickFile } from "@/lib/scope";
const mockPickFile = pickFile as unknown as ReturnType<typeof vi.fn>;

import { evictSoundCaches } from "@/lib/audio/cacheUtils";
const mockEvictSoundCaches = evictSoundCaches as ReturnType<typeof vi.fn>;

beforeEach(() => {
  useLibraryStore.setState({ ...initialLibraryState });
  mockSaveLibrary.mockClear();
  mockPickFile.mockReset();
  mockEvictSoundCaches.mockReset();
});

describe("ResolveMissingDialog — pickFile integration", () => {
  it("calls pickFile when Locate button is clicked and processes the selected path", async () => {
    const sound = createMockSound({
      name: "Kick",
      filePath: "/music/old/kick.wav",
    });
    useLibraryStore.setState({ ...initialLibraryState, sounds: [sound] });

    // Return a path whose basename matches the existing one so the flow
    // proceeds directly to applyLocate (no extra confirmation dialogs).
    mockPickFile.mockResolvedValue("/music/new/kick.wav");

    const onClose = vi.fn();
    render(<ResolveMissingDialog sound={sound} onClose={onClose} />);

    await userEvent.click(screen.getByRole("button", { name: /locate file/i }));

    expect(mockPickFile).toHaveBeenCalledTimes(1);
    expect(mockPickFile).toHaveBeenCalledWith(
      expect.objectContaining({ filters: expect.any(Array) })
    );
  });

  it("does nothing when the user cancels the Locate dialog", async () => {
    const sound = createMockSound({
      name: "Kick",
      filePath: "/music/old/kick.wav",
    });
    useLibraryStore.setState({ ...initialLibraryState, sounds: [sound] });

    mockPickFile.mockResolvedValue(null);

    const onClose = vi.fn();
    render(<ResolveMissingDialog sound={sound} onClose={onClose} />);

    await userEvent.click(screen.getByRole("button", { name: /locate file/i }));

    expect(mockPickFile).toHaveBeenCalledTimes(1);
    expect(mockSaveLibrary).not.toHaveBeenCalled();
  });

  it("evicts duplicate sound cache when confirming a duplicate resolution", async () => {
    const sound = createMockSound({
      id: "snd-missing",
      name: "Kick",
      filePath: "/music/old/kick.wav",
    });
    const dupSound = createMockSound({
      id: "snd-dup",
      name: "Kick",
      filePath: "/music/new/kick.wav",
    });
    useLibraryStore.setState({ ...initialLibraryState, sounds: [sound, dupSound] });

    // Same basename → bypasses name-mismatch; same filePath as dupSound → triggers duplicate branch
    mockPickFile.mockResolvedValue("/music/new/kick.wav");

    const onClose = vi.fn();
    render(<ResolveMissingDialog sound={sound} onClose={onClose} />);

    await userEvent.click(screen.getByRole("button", { name: /locate file/i }));
    await userEvent.click(await screen.findByRole("button", { name: /proceed & remove duplicate/i }));

    expect(mockEvictSoundCaches).toHaveBeenCalledTimes(2);
    // dup evicted before updateLibrary, sound.id evicted after — assert ordering
    expect(mockEvictSoundCaches.mock.calls[0][0]).toBe(dupSound.id);
    expect(mockEvictSoundCaches.mock.calls[1][0]).toBe(sound.id);
  });

  it("evicts sound cache when removing a sound from the library", async () => {
    const sound = createMockSound({
      id: "snd-1",
      name: "Kick",
      filePath: "/music/kick.wav",
    });
    useLibraryStore.setState({ ...initialLibraryState, sounds: [sound] });

    const onClose = vi.fn();
    render(<ResolveMissingDialog sound={sound} onClose={onClose} />);

    await userEvent.click(screen.getByRole("button", { name: /remove from library/i }));
    await userEvent.click(await screen.findByRole("button", { name: /^remove$/i }));

    expect(mockEvictSoundCaches).toHaveBeenCalledTimes(1);
    expect(mockEvictSoundCaches).toHaveBeenCalledWith(sound.id);
  });
});
