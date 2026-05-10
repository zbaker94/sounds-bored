import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SoundList } from "./SoundList";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import {
  useAppSettingsStore,
  initialAppSettingsState,
} from "@/state/appSettingsStore";
import {
  usePlaybackStore,
  initialPlaybackState,
} from "@/state/playbackStore";
import { useUiStore, initialUiState, OVERLAY_ID, selectIsOverlayOpen } from "@/state/uiStore";
import {
  createMockAppSettings,
  createMockSound,
} from "@/test/factories";

// Tauri plugin mocks (per-test control)
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  remove: vi.fn(() => Promise.resolve()),
  exists: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    onDragDropEvent: vi.fn(() => Promise.resolve(() => {})),
  })),
}));

vi.mock("@/lib/library.reconcile", () => ({
  reconcileGlobalLibrary: vi.fn(() =>
    Promise.resolve({
      sounds: [],
      changed: false,
      inaccessibleFolderIds: [],
    }),
  ),
  checkMissingStatus: vi.fn(() =>
    Promise.resolve({
      missingSoundIds: new Set<string>(),
      missingFolderIds: new Set<string>(),
    }),
  ),
  refreshMissingState: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/audio/cacheUtils", () => ({
  evictSoundCaches: vi.fn(),
  evictSoundCachesMany: vi.fn(),
}));

vi.mock("@/lib/audio/preview", () => ({
  playPreview: vi.fn(() => Promise.resolve()),
  stopPreview: vi.fn(),
}));

// useSoundPreview is mocked so we can deterministically control `previewingId`
// without dispatching pointer events through unlabeled icon buttons.
const mockUseSoundPreview = vi.fn(() => ({
  previewingId: null as string | null,
  togglePreview: vi.fn(),
  stopPreview: vi.fn(),
}));

vi.mock("@/hooks/useSoundPreview", () => ({
  useSoundPreview: () => mockUseSoundPreview(),
}));

const mockMutateAsync = vi.fn(() => Promise.resolve());

vi.mock("@/lib/library.queries", () => ({
  useSaveCurrentLibrary: vi.fn(() => ({ saveCurrentLibrary: mockMutateAsync })),
}));

vi.mock("@/lib/appSettings.queries", () => ({
  useSaveAppSettings: vi.fn(() => ({ mutateAsync: mockMutateAsync })),
}));

vi.mock("@/hooks/useDownloadEventListener", () => ({
  useDownloadEventListener: vi.fn(),
}));

// Mock the ResolveMissingDialog so we can assert it gets a sound
vi.mock("@/components/modals/ResolveMissingDialog", () => ({
  ResolveMissingDialog: ({
    sound,
  }: {
    sound: { id: string; name: string } | null;
    onResolved?: () => void;
    onClose: () => void;
  }) =>
    sound ? (
      <div data-testid="resolve-missing-dialog">
        ResolveMissingDialog open ({sound.id})
      </div>
    ) : null,
}));

// ---------- helpers ----------

interface SoundListProps {
  selectedId: string | null;
  searchQuery: string;
  selectedSoundIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  onOpenAddToSet: () => void;
  onOpenAddTags: () => void;
}

function renderList(props?: Partial<SoundListProps>) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <SoundList
          selectedId={props?.selectedId ?? null}
          searchQuery={props?.searchQuery ?? ""}
          selectedSoundIds={
            props?.selectedSoundIds ?? new Set<string>()
          }
          onSelectionChange={props?.onSelectionChange ?? vi.fn()}
          onOpenAddToSet={props?.onOpenAddToSet ?? vi.fn()}
          onOpenAddTags={props?.onOpenAddTags ?? vi.fn()}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

// ---------- setup ----------

beforeEach(() => {
  useLibraryStore.setState({ ...initialLibraryState });
  useProjectStore.setState({ ...initialProjectState });
  useAppSettingsStore.setState({ ...initialAppSettingsState, settings: createMockAppSettings() });
  useUiStore.setState({ ...initialUiState });
  usePlaybackStore.setState({ ...initialPlaybackState });
  mockUseSoundPreview.mockReturnValue({
    previewingId: null,
    togglePreview: vi.fn(),
    stopPreview: vi.fn(),
  });
  mockMutateAsync.mockClear();
});

// ---------- tests ----------

describe("SoundList", () => {
  it("renders the list of sounds from the library store", () => {
    const kick = createMockSound({ name: "Kick" });
    const snare = createMockSound({ name: "Snare" });
    useLibraryStore.setState({
      ...initialLibraryState,
      sounds: [kick, snare],
    });

    renderList();
    expect(screen.getByText("Kick")).toBeInTheDocument();
    expect(screen.getByText("Snare")).toBeInTheDocument();
  });

  it("'Remove All' banner button opens the confirm-remove-missing-sounds overlay", async () => {
    const user = userEvent.setup();
    const missing = createMockSound({ id: "missing-1", name: "Ghost" });
    useLibraryStore.setState({
      ...initialLibraryState,
      sounds: [missing],
      missingSoundIds: new Set<string>(["missing-1"]),
    });

    renderList();

    // Banner visible
    expect(screen.getByText(/sound missing/i)).toBeInTheDocument();

    expect(selectIsOverlayOpen(OVERLAY_ID.CONFIRM_REMOVE_MISSING_SOUNDS)(useUiStore.getState())).toBe(false);

    const removeAllBtn = screen.getByRole("button", { name: /remove all/i });
    await user.click(removeAllBtn);

    expect(selectIsOverlayOpen(OVERLAY_ID.CONFIRM_REMOVE_MISSING_SOUNDS)(useUiStore.getState())).toBe(true);
  });

  it("clicking a missing sound opens the resolve dialog for that sound", async () => {
    const user = userEvent.setup();
    const missing = createMockSound({ id: "missing-1", name: "Ghost" });
    useLibraryStore.setState({
      ...initialLibraryState,
      sounds: [missing],
      missingSoundIds: new Set<string>(["missing-1"]),
    });

    renderList();

    expect(
      screen.queryByTestId("resolve-missing-dialog"),
    ).not.toBeInTheDocument();

    const row = screen.getByText("Ghost");
    await user.click(row);

    const dialog = screen.getByTestId("resolve-missing-dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog.textContent).toContain("missing-1");
  });

  it("clicking a sound row toggles selection via onSelectionChange", async () => {
    const user = userEvent.setup();
    const kick = createMockSound({ id: "k", name: "Kick" });
    useLibraryStore.setState({
      ...initialLibraryState,
      sounds: [kick],
    });
    const onSelectionChange = vi.fn();

    renderList({ onSelectionChange });

    const row = screen.getByText("Kick");
    await user.click(row);

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    const nextSet = onSelectionChange.mock.calls[0][0] as Set<string>;
    expect(nextSet.has("k")).toBe(true);
  });

  it("handleToggle reads latest selectedSoundIds after rerender (ref-staleness guard)", async () => {
    const kick = createMockSound({ id: "k", name: "Kick" });
    const snare = createMockSound({ id: "s", name: "Snare" });
    useLibraryStore.setState({ ...initialLibraryState, sounds: [kick, snare] });

    const onSelectionChange = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const buildJsx = (selectedSoundIds: Set<string>) => (
      <QueryClientProvider client={qc}>
        <TooltipProvider>
          <SoundList
            selectedId={null}
            searchQuery=""
            selectedSoundIds={selectedSoundIds}
            onSelectionChange={onSelectionChange}
            onOpenAddToSet={vi.fn()}
            onOpenAddTags={vi.fn()}
          />
        </TooltipProvider>
      </QueryClientProvider>
    );

    const user = userEvent.setup();
    const { rerender } = render(buildJsx(new Set(["k"])));
    rerender(buildJsx(new Set(["k", "s"])));

    // Click kick — should deselect kick from {k, s}, leaving {s}
    const kickRow = screen.getByText("Kick");
    await user.click(kickRow);

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    const result = onSelectionChange.mock.calls[0][0] as Set<string>;
    expect(result.has("k")).toBe(false);
    expect(result.has("s")).toBe(true);
  });

  it("analysis store updates do not trigger unexpected selection changes", async () => {
    const kick = createMockSound({ id: "k", name: "Kick" });
    const snare = createMockSound({ id: "s", name: "Snare" });
    useLibraryStore.setState({ ...initialLibraryState, sounds: [kick, snare] });

    const onSelectionChange = vi.fn();
    renderList({ onSelectionChange, selectedSoundIds: new Set(["k"]) });

    act(() => {
      useLibraryStore.getState().updateSoundAnalysis("s", { loudnessLufs: -14 });
    });

    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(screen.getByText("Kick")).toBeInTheDocument();
    expect(screen.getByText("Snare")).toBeInTheDocument();
  });

  it("search by name matches expected sounds", () => {
    const kick = createMockSound({ id: "s1", name: "Kick Drum" });
    const snare = createMockSound({ id: "s2", name: "Snare Hit" });
    useLibraryStore.setState({ ...initialLibraryState, sounds: [kick, snare] });

    renderList({ searchQuery: "kick" });

    expect(screen.getByText("Kick Drum")).toBeInTheDocument();
    expect(screen.queryByText("Snare Hit")).not.toBeInTheDocument();
  });

  it("search does not error on sounds with legacy genre/mood data absent from schema (regression: v1.6.0 removal)", () => {
    // Prior to v1.6.0, sounds could have genre/mood. After schema strip they are absent,
    // but the search filter must still work without throwing.
    const sound = createMockSound({ id: "s1", name: "Rock Loop" });
    useLibraryStore.setState({ ...initialLibraryState, sounds: [sound] });

    expect(() => renderList({ searchQuery: "rock" })).not.toThrow();
    expect(screen.getByText("Rock Loop")).toBeInTheDocument();
  });

  it("Select All calls onSelectionChange with every selectable sound id", async () => {
    const user = userEvent.setup();
    const a = createMockSound({ id: "a", name: "A" });
    const b = createMockSound({ id: "b", name: "B" });
    useLibraryStore.setState({
      ...initialLibraryState,
      sounds: [a, b],
    });
    const onSelectionChange = vi.fn();

    renderList({ onSelectionChange });

    const selectAllBtn = screen.getByRole("button", { name: /select all/i });
    await user.click(selectAllBtn);

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    const nextSet = onSelectionChange.mock.calls[0][0] as Set<string>;
    expect(nextSet.has("a")).toBe(true);
    expect(nextSet.has("b")).toBe(true);
    expect(nextSet.size).toBe(2);
  });

  describe("PreviewProgressBar", () => {
    it("does not render the progress bar when no sound is being previewed", () => {
      const kick = createMockSound({
        id: "k",
        name: "Kick",
        filePath: "/sounds/kick.wav",
      });
      useLibraryStore.setState({
        ...initialLibraryState,
        sounds: [kick],
      });
      mockUseSoundPreview.mockReturnValue({
        previewingId: null,
        togglePreview: vi.fn(),
        stopPreview: vi.fn(),
      });

      renderList();
      expect(
        screen.queryByTestId("preview-progress-bar"),
      ).not.toBeInTheDocument();
    });

    it("renders the progress bar when a sound is being previewed", () => {
      const kick = createMockSound({
        id: "k",
        name: "Kick",
        filePath: "/sounds/kick.wav",
      });
      useLibraryStore.setState({
        ...initialLibraryState,
        sounds: [kick],
      });
      mockUseSoundPreview.mockReturnValue({
        previewingId: "k",
        togglePreview: vi.fn(),
        stopPreview: vi.fn(),
      });

      renderList();
      expect(screen.getByTestId("preview-progress-bar")).toBeInTheDocument();
    });

    it("only renders the progress bar for the previewing sound, not others", () => {
      const kick = createMockSound({
        id: "k",
        name: "Kick",
        filePath: "/sounds/kick.wav",
      });
      const snare = createMockSound({
        id: "s",
        name: "Snare",
        filePath: "/sounds/snare.wav",
      });
      useLibraryStore.setState({
        ...initialLibraryState,
        sounds: [kick, snare],
      });
      mockUseSoundPreview.mockReturnValue({
        previewingId: "k",
        togglePreview: vi.fn(),
        stopPreview: vi.fn(),
      });

      renderList();
      // Only one progress bar is rendered (for "k"), not two.
      expect(
        screen.getAllByTestId("preview-progress-bar"),
      ).toHaveLength(1);
    });

    it("sets fill bar width proportional to previewProgress (0.5 -> 50%)", () => {
      const kick = createMockSound({
        id: "k",
        name: "Kick",
        filePath: "/sounds/kick.wav",
      });
      useLibraryStore.setState({
        ...initialLibraryState,
        sounds: [kick],
      });
      mockUseSoundPreview.mockReturnValue({
        previewingId: "k",
        togglePreview: vi.fn(),
        stopPreview: vi.fn(),
      });
      usePlaybackStore.setState({
        ...initialPlaybackState,
        previewProgress: 0.5,
      });

      renderList();
      const fill = screen.getByTestId("preview-progress-fill");
      expect(fill.style.width).toBe("50%");
    });

    it("renders 0% width when previewProgress is null", () => {
      const kick = createMockSound({
        id: "k",
        name: "Kick",
        filePath: "/sounds/kick.wav",
      });
      useLibraryStore.setState({
        ...initialLibraryState,
        sounds: [kick],
      });
      mockUseSoundPreview.mockReturnValue({
        previewingId: "k",
        togglePreview: vi.fn(),
        stopPreview: vi.fn(),
      });
      // previewProgress defaults to null in initialPlaybackState
      usePlaybackStore.setState({
        ...initialPlaybackState,
        previewProgress: null,
      });

      renderList();
      const fill = screen.getByTestId("preview-progress-fill");
      expect(fill.style.width).toBe("0%");
    });
  });

  describe("cover art thumbnail", () => {
    it("shows cover art thumbnail and blurred background when sound has coverArtDataUrl", () => {
      const sound = createMockSound({
        id: "s1",
        name: "Kick",
        filePath: "/music/kick.wav",
        folderId: "f1",
        coverArtDataUrl: "data:image/jpeg;base64,abc123",
      });
      useLibraryStore.setState({ ...initialLibraryState, sounds: [sound] });

      renderList();

      const img = screen.getByTestId("sound-cover-art");
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute("src", "data:image/jpeg;base64,abc123");
    });

    it("shows music icon fallback when sound has no coverArtDataUrl", () => {
      const sound = createMockSound({ id: "s1", name: "Kick", filePath: "/music/kick.wav", folderId: "f1" });
      useLibraryStore.setState({ ...initialLibraryState, sounds: [sound] });

      renderList();

      expect(screen.queryByTestId("sound-cover-art")).not.toBeInTheDocument();
    });

    it("shows music icon for missing sounds even if they have coverArtDataUrl", () => {
      const sound = createMockSound({
        id: "s1",
        name: "Ghost",
        filePath: "/music/ghost.wav",
        folderId: "f1",
        coverArtDataUrl: "data:image/jpeg;base64,abc123",
      });
      useLibraryStore.setState({
        ...initialLibraryState,
        sounds: [sound],
        missingSoundIds: new Set(["s1"]),
      });

      renderList();

      // Missing sounds should not show cover art
      expect(screen.queryByTestId("sound-cover-art")).not.toBeInTheDocument();
    });
  });
});
