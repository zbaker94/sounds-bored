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

vi.mock("@/lib/audio/bufferCache", () => ({
  evictBuffer: vi.fn(),
}));

vi.mock("@/lib/audio/streamingCache", () => ({
  evictStreamingElement: vi.fn(),
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
  grantPathAccess: vi.fn().mockResolvedValue(undefined),
  grantParentAccess: vi.fn().mockResolvedValue(undefined),
}));

import { pickFile } from "@/lib/scope";
const mockPickFile = pickFile as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  useLibraryStore.setState({ ...initialLibraryState });
  mockSaveLibrary.mockClear();
  mockPickFile.mockReset();
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
});
