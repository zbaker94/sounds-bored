import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SoundList } from "./SoundList";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import {
  useAppSettingsStore,
  initialAppSettingsState,
} from "@/state/appSettingsStore";
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
      missingSoundIds: new globalThis.Set<string>(),
      missingFolderIds: new globalThis.Set<string>(),
    }),
  ),
  refreshMissingState: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/audio/bufferCache", () => ({
  evictBuffer: vi.fn(),
}));

vi.mock("@/lib/audio/streamingCache", () => ({
  evictStreamingElement: vi.fn(),
}));

vi.mock("@/lib/audio/preview", () => ({
  playPreview: vi.fn(() => Promise.resolve()),
  stopPreview: vi.fn(),
}));

const mockMutateAsync = vi.fn(() => Promise.resolve());

vi.mock("@/lib/library.queries", () => ({
  useSaveCurrentLibrary: vi.fn(() => ({ saveCurrentLibrary: mockMutateAsync })),
}));

vi.mock("@/lib/appSettings.queries", () => ({
  useSaveAppSettings: vi.fn(() => ({ mutateAsync: mockMutateAsync })),
}));

vi.mock("@/lib/ytdlp.queries", () => ({
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
  selectedSoundIds: globalThis.Set<string>;
  onSelectionChange: (ids: globalThis.Set<string>) => void;
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
            props?.selectedSoundIds ?? new globalThis.Set<string>()
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
    const missing = createMockSound({ id: "missing-1", name: "Ghost" });
    useLibraryStore.setState({
      ...initialLibraryState,
      sounds: [missing],
      missingSoundIds: new globalThis.Set<string>(["missing-1"]),
    });

    renderList();

    // Banner visible
    expect(screen.getByText(/sound missing/i)).toBeInTheDocument();

    expect(selectIsOverlayOpen(OVERLAY_ID.CONFIRM_REMOVE_MISSING_SOUNDS)(useUiStore.getState())).toBe(false);

    const removeAllBtn = screen.getByRole("button", { name: /remove all/i });
    await act(async () => {
      fireEvent.click(removeAllBtn);
    });

    expect(selectIsOverlayOpen(OVERLAY_ID.CONFIRM_REMOVE_MISSING_SOUNDS)(useUiStore.getState())).toBe(true);
  });

  it("clicking a missing sound opens the resolve dialog for that sound", async () => {
    const missing = createMockSound({ id: "missing-1", name: "Ghost" });
    useLibraryStore.setState({
      ...initialLibraryState,
      sounds: [missing],
      missingSoundIds: new globalThis.Set<string>(["missing-1"]),
    });

    renderList();

    expect(
      screen.queryByTestId("resolve-missing-dialog"),
    ).not.toBeInTheDocument();

    const row = screen.getByText("Ghost");
    await act(async () => {
      fireEvent.click(row);
    });

    const dialog = screen.getByTestId("resolve-missing-dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog.textContent).toContain("missing-1");
  });

  it("clicking a sound row toggles selection via onSelectionChange", async () => {
    const kick = createMockSound({ id: "k", name: "Kick" });
    useLibraryStore.setState({
      ...initialLibraryState,
      sounds: [kick],
    });
    const onSelectionChange = vi.fn();

    renderList({ onSelectionChange });

    const row = screen.getByText("Kick");
    await act(async () => {
      fireEvent.click(row);
    });

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    const nextSet = onSelectionChange.mock.calls[0][0] as globalThis.Set<string>;
    expect(nextSet.has("k")).toBe(true);
  });

  it("Select All calls onSelectionChange with every selectable sound id", async () => {
    const a = createMockSound({ id: "a", name: "A" });
    const b = createMockSound({ id: "b", name: "B" });
    useLibraryStore.setState({
      ...initialLibraryState,
      sounds: [a, b],
    });
    const onSelectionChange = vi.fn();

    renderList({ onSelectionChange });

    const selectAllBtn = screen.getByRole("button", { name: /select all/i });
    await act(async () => {
      fireEvent.click(selectAllBtn);
    });

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    const nextSet = onSelectionChange.mock.calls[0][0] as globalThis.Set<string>;
    expect(nextSet.has("a")).toBe(true);
    expect(nextSet.has("b")).toBe(true);
    expect(nextSet.size).toBe(2);
  });
});
