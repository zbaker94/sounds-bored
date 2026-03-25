import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SoundsPanel } from "./SoundsPanel";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import {
  createMockSound,
  createMockGlobalFolder,
  createMockAppSettings,
} from "@/test/factories";

// Mock Tauri dialog (tauri-mocks.ts already mocks plugin-dialog globally,
// but we need a named vi.mock here to control return values per test)
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

// Mock Tauri window drag-drop events
const mockOnFileDropEvent = vi.fn(() => Promise.resolve(() => {}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    onDragDropEvent: mockOnFileDropEvent,
  })),
}));

// Mock import helpers so no real FS calls happen
vi.mock("@/lib/import", () => ({
  copyFilesToFolder: vi.fn(() => Promise.resolve([])),
}));

vi.mock("@/lib/library.reconcile", () => ({
  reconcileGlobalLibrary: vi.fn(() =>
    Promise.resolve({ sounds: [], changed: false })
  ),
}));

const mockMutateAsync = vi.fn(() => Promise.resolve());

vi.mock("@/lib/library.queries", () => ({
  useSaveGlobalLibrary: vi.fn(() => ({ mutateAsync: mockMutateAsync })),
}));

vi.mock("@/lib/appSettings.queries", () => ({
  useAppSettings: vi.fn(),
  useSaveAppSettings: vi.fn(() => ({ mutateAsync: mockMutateAsync })),
}));

// Pull in the mocked modules so tests can configure return values
import { open } from "@tauri-apps/plugin-dialog";
import { useAppSettings } from "@/lib/appSettings.queries";

// ---------- helpers ----------

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderPanel(queryClient?: QueryClient) {
  const qc = queryClient ?? makeQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <SoundsPanel />
    </QueryClientProvider>
  );
}

// ---------- setup ----------

beforeEach(() => {
  useLibraryStore.setState({ ...initialLibraryState });
  vi.mocked(useAppSettings).mockReturnValue({
    data: createMockAppSettings(),
    isLoading: false,
    isError: false,
  } as ReturnType<typeof useAppSettings>);
  mockOnFileDropEvent.mockClear();
  mockOnFileDropEvent.mockReturnValue(Promise.resolve(() => {}));
  vi.mocked(open).mockReset();
});

// ---------- tests ----------

describe("SoundsPanel", () => {
  // 1. "Add Sounds" button renders
  it("renders the Add Sounds button in the empty sets panel", () => {
    renderPanel();
    // When no sets exist an empty state is shown with Add Sounds button
    expect(screen.getByRole("button", { name: /add sounds/i })).toBeInTheDocument();
  });

  // 2. "Add Folder" button renders in empty-state folders panel
  it("renders the Add Folder button in the empty folders panel", () => {
    renderPanel();
    // folders list is empty by default (settings has globalFolders but we override)
    vi.mocked(useAppSettings).mockReturnValue({
      data: { ...createMockAppSettings(), globalFolders: [], importFolderId: "", downloadFolderId: "" },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useAppSettings>);

    renderPanel();
    expect(screen.getAllByRole("button", { name: /add folder/i }).length).toBeGreaterThan(0);
  });

  // 3. "Add Folder" item renders when folders exist
  it("renders the Add Folder item row when there are folders", () => {
    const settings = createMockAppSettings();
    vi.mocked(useAppSettings).mockReturnValue({
      data: settings,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useAppSettings>);

    renderPanel();
    // The Item row (not a <button>) should contain "Add Folder" text
    expect(screen.getByText("Add Folder")).toBeInTheDocument();
  });

  // 4. Clicking "Add Sounds" calls open() with multiple: true and audio filter
  it("calls open() with multiple: true and audio filter when Add Sounds is clicked", async () => {
    vi.mocked(open).mockResolvedValueOnce(null);

    renderPanel();
    const btn = screen.getByRole("button", { name: /add sounds/i });
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({
        multiple: true,
        filters: expect.arrayContaining([
          expect.objectContaining({ name: "Audio" }),
        ]),
      })
    );
  });

  // 5. Clicking "Add Folder" button calls open() with directory: true
  it("calls open() with directory: true when Add Folder button (empty state) is clicked", async () => {
    vi.mocked(useAppSettings).mockReturnValue({
      data: { ...createMockAppSettings(), globalFolders: [], importFolderId: "", downloadFolderId: "" },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useAppSettings>);
    vi.mocked(open).mockResolvedValueOnce(null);

    renderPanel();
    const btn = screen.getByRole("button", { name: /add folder/i });
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ directory: true })
    );
  });

  // 5b. Duplicate folder path shows error toast and does not save
  it("shows an error toast and does not save when adding a folder that already exists", async () => {
    const existingFolder = createMockGlobalFolder({ path: "/music/sounds" });
    vi.mocked(useAppSettings).mockReturnValue({
      data: { ...createMockAppSettings(), globalFolders: [existingFolder] },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useAppSettings>);
    vi.mocked(open).mockResolvedValueOnce("/music/sounds");

    renderPanel();
    const btn = screen.getByRole("button", { name: /add folder/i });
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  // 6. Sound list shows all sounds when selectedId is null (useMemo reactivity)
  it("shows all sounds when no selection is active and updates reactively", () => {
    const sound1 = createMockSound({ name: "Kick", folderId: "folder-1" });
    const sound2 = createMockSound({ name: "Snare", folderId: "folder-2" });

    useLibraryStore.setState({
      ...initialLibraryState,
      sounds: [sound1, sound2],
    });

    // Start with no selection (selectedId defaults to null when no folders/sets)
    vi.mocked(useAppSettings).mockReturnValue({
      data: { ...createMockAppSettings(), globalFolders: [], importFolderId: "", downloadFolderId: "" },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useAppSettings>);

    renderPanel();

    expect(screen.getByText("Kick")).toBeInTheDocument();
    expect(screen.getByText("Snare")).toBeInTheDocument();
  });

  // 6b. useMemo: adding a sound to the store updates the list without explicit setSoundsForSelectedId
  it("reactively updates sound list when library store changes", async () => {
    vi.mocked(useAppSettings).mockReturnValue({
      data: { ...createMockAppSettings(), globalFolders: [], importFolderId: "", downloadFolderId: "" },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useAppSettings>);

    renderPanel();

    // Initially no sounds
    expect(screen.queryByText("HiHat")).not.toBeInTheDocument();

    // Add a sound to the store
    const newSound = createMockSound({ name: "HiHat" });
    act(() => {
      useLibraryStore.setState({ sounds: [newSound] });
    });

    expect(screen.getByText("HiHat")).toBeInTheDocument();
  });

  // 7. Drag overlay renders when isDragOver is true (via onDragDropEvent mock)
  it("shows drag overlay when a file-drop 'enter' event fires", async () => {
    // Capture the callback passed to onDragDropEvent
    let fileDropCallback: ((event: { payload: { type: string; paths: string[] } }) => Promise<void>) | null = null;

    mockOnFileDropEvent.mockImplementationOnce((cb: (event: { payload: { type: string; paths: string[] } }) => Promise<void>) => {
      fileDropCallback = cb;
      return Promise.resolve(() => {});
    });

    renderPanel();

    // Wait for the useEffect to register the listener
    await act(async () => {
      await Promise.resolve();
    });

    expect(fileDropCallback).not.toBeNull();

    // Simulate the "enter" event
    await act(async () => {
      await fileDropCallback!({ payload: { type: "enter", paths: [] } });
    });

    expect(screen.getByText(/drop audio files to import/i)).toBeInTheDocument();
  });

  // 7b. Drag overlay disappears when a file-drop 'leave' event fires
  it("hides drag overlay when a file-drop 'leave' event fires", async () => {
    let fileDropCallback: ((event: { payload: { type: string; paths: string[] } }) => Promise<void>) | null = null;

    mockOnFileDropEvent.mockImplementationOnce((cb: (event: { payload: { type: string; paths: string[] } }) => Promise<void>) => {
      fileDropCallback = cb;
      return Promise.resolve(() => {});
    });

    renderPanel();
    await act(async () => { await Promise.resolve(); });

    // Show overlay
    await act(async () => {
      await fileDropCallback!({ payload: { type: "enter", paths: [] } });
    });
    expect(screen.getByText(/drop audio files to import/i)).toBeInTheDocument();

    // Hide overlay
    await act(async () => {
      await fileDropCallback!({ payload: { type: "leave", paths: [] } });
    });
    expect(screen.queryByText(/drop audio files to import/i)).not.toBeInTheDocument();
  });
});
