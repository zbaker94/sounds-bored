import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SoundsPanel } from "./SoundsPanel";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import {
  createMockSound,
  createMockGlobalFolder,
  createMockAppSettings,
  createMockSet,
  createMockProject,
  createMockScene,
  createMockPad,
  createMockLayer,
  createMockSoundInstance,
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

// Mock the dialog components to avoid DrawerDialog/useIsMd dependency
vi.mock("./AddSetDialog", () => ({
  AddSetDialog: ({ open, onOpenChange: _onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) =>
    open ? <div data-testid="add-set-dialog">AddSetDialog open</div> : null,
}));

vi.mock("./AddToSetDialog", () => ({
  AddToSetDialog: ({ open, onOpenChange: _onOpenChange, soundIds }: { open: boolean; onOpenChange: (o: boolean) => void; soundIds: string[] }) =>
    open ? <div data-testid="add-to-set-dialog">AddToSetDialog open ({soundIds.length} sounds)</div> : null,
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
      <TooltipProvider>
        <SoundsPanel />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

// ---------- setup ----------

beforeEach(() => {
  useLibraryStore.setState({ ...initialLibraryState });
  useProjectStore.setState({ ...initialProjectState });
  vi.mocked(useAppSettings).mockReturnValue({
    data: createMockAppSettings(),
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useAppSettings>);
  mockOnFileDropEvent.mockClear();
  mockOnFileDropEvent.mockReturnValue(Promise.resolve(() => {}));
  vi.mocked(open).mockReset();
  mockMutateAsync.mockClear();
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
    } as unknown as ReturnType<typeof useAppSettings>);

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
    } as unknown as ReturnType<typeof useAppSettings>);

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
    } as unknown as ReturnType<typeof useAppSettings>);
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
    } as unknown as ReturnType<typeof useAppSettings>);
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
    } as unknown as ReturnType<typeof useAppSettings>);

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
    } as unknown as ReturnType<typeof useAppSettings>);

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

    mockOnFileDropEvent.mockImplementationOnce(((cb: (event: { payload: { type: string; paths: string[] } }) => Promise<void>) => {
      fileDropCallback = cb;
      return Promise.resolve(() => {});
    }) as any);

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

    mockOnFileDropEvent.mockImplementationOnce(((cb: (event: { payload: { type: string; paths: string[] } }) => Promise<void>) => {
      fileDropCallback = cb;
      return Promise.resolve(() => {});
    }) as any);

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

  // ---------- Sets UI tests ----------

  // 8. "Add Set" button in empty sets panel opens AddSetDialog
  it("opens AddSetDialog when 'Add Set' button is clicked in empty state", async () => {
    renderPanel();

    // Verify dialog is not open initially
    expect(screen.queryByTestId("add-set-dialog")).not.toBeInTheDocument();

    // Click "Add Set" in the empty state
    const addSetBtn = screen.getByRole("button", { name: /add set/i });
    await act(async () => {
      fireEvent.click(addSetBtn);
    });

    expect(screen.getByTestId("add-set-dialog")).toBeInTheDocument();
  });

  // 9. Sets sticky toolbar renders when sets exist
  it("renders sets sticky toolbar with Add Set and Duplicate Set buttons when sets exist", () => {
    const set1 = createMockSet({ name: "Drums" });
    useLibraryStore.setState({
      ...initialLibraryState,
      sets: [set1],
    });

    renderPanel();

    // The sticky toolbar should have "Add Set" and "Duplicate Set" buttons
    const addSetButtons = screen.getAllByRole("button", { name: /add set/i });
    expect(addSetButtons.length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /duplicate set/i })).toBeInTheDocument();
  });

  // 10. "Duplicate Set" button disabled when no set is selected
  it("disables Duplicate Set button when no set is selected in the left panel", () => {
    const set1 = createMockSet({ name: "Drums" });
    useLibraryStore.setState({
      ...initialLibraryState,
      sets: [set1],
    });

    // No folders => selectedId defaults to sets[0].id, so we need to make sure
    // the selectedId doesn't match a set. With a folder present, selectedId will be folder id.
    const folder = createMockGlobalFolder();
    vi.mocked(useAppSettings).mockReturnValue({
      data: { ...createMockAppSettings(), globalFolders: [folder] },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAppSettings>);

    renderPanel();

    // The selectedId defaults to folder[0].id, not a set
    const dupBtn = screen.getByRole("button", { name: /duplicate set/i });
    expect(dupBtn).toBeDisabled();
  });

  // 11. "Duplicate Set" button enabled when a set is selected
  it("enables Duplicate Set button when a set is selected in the left panel", async () => {
    const set1 = createMockSet({ name: "Drums" });
    useLibraryStore.setState({
      ...initialLibraryState,
      sets: [set1],
    });

    // No folders so selectedId defaults to sets[0].id — set is already selected
    vi.mocked(useAppSettings).mockReturnValue({
      data: { ...createMockAppSettings(), globalFolders: [], importFolderId: "", downloadFolderId: "" },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAppSettings>);

    renderPanel();

    // selectedId defaults to the first set, so Duplicate Set should be enabled
    const dupBtn = screen.getByRole("button", { name: /duplicate set/i });
    expect(dupBtn).not.toBeDisabled();
  });

  // 12. Sound checkboxes render (one per sound)
  it("renders a checkbox for each sound in the sounds panel", () => {
    const sound1 = createMockSound({ name: "Kick" });
    const sound2 = createMockSound({ name: "Snare" });
    useLibraryStore.setState({
      ...initialLibraryState,
      sounds: [sound1, sound2],
    });

    vi.mocked(useAppSettings).mockReturnValue({
      data: { ...createMockAppSettings(), globalFolders: [], importFolderId: "", downloadFolderId: "" },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAppSettings>);

    renderPanel();

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBe(2);
  });

  // 13. Checking a sound checkbox selects it
  it("selects a sound when its checkbox is checked", async () => {
    const sound1 = createMockSound({ name: "Kick" });
    useLibraryStore.setState({
      ...initialLibraryState,
      sounds: [sound1],
    });

    vi.mocked(useAppSettings).mockReturnValue({
      data: { ...createMockAppSettings(), globalFolders: [], importFolderId: "", downloadFolderId: "" },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAppSettings>);

    renderPanel();

    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).not.toBeChecked();

    await act(async () => {
      fireEvent.click(checkbox);
    });

    expect(checkbox).toBeChecked();
  });

  // 14. "Select All" selects all visible sounds
  it("selects all sounds when Select All is clicked", async () => {
    const sound1 = createMockSound({ name: "Kick" });
    const sound2 = createMockSound({ name: "Snare" });
    useLibraryStore.setState({
      ...initialLibraryState,
      sounds: [sound1, sound2],
    });

    vi.mocked(useAppSettings).mockReturnValue({
      data: { ...createMockAppSettings(), globalFolders: [], importFolderId: "", downloadFolderId: "" },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAppSettings>);

    renderPanel();

    const selectAllBtn = screen.getByRole("button", { name: /select all/i });
    await act(async () => {
      fireEvent.click(selectAllBtn);
    });

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).toBeChecked();
  });

  // 15. "Select None" deselects all sounds
  it("deselects all sounds when Select None is clicked", async () => {
    const sound1 = createMockSound({ name: "Kick" });
    const sound2 = createMockSound({ name: "Snare" });
    useLibraryStore.setState({
      ...initialLibraryState,
      sounds: [sound1, sound2],
    });

    vi.mocked(useAppSettings).mockReturnValue({
      data: { ...createMockAppSettings(), globalFolders: [], importFolderId: "", downloadFolderId: "" },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAppSettings>);

    renderPanel();

    // First select all
    const selectAllBtn = screen.getByRole("button", { name: /select all/i });
    await act(async () => {
      fireEvent.click(selectAllBtn);
    });

    // Button should now say "Select None"
    const selectNoneBtn = screen.getByRole("button", { name: /select none/i });
    await act(async () => {
      fireEvent.click(selectNoneBtn);
    });

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes[0]).not.toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();
  });

  // 16. "Add to Set" button disabled when no sounds selected
  it("disables Add to Set button when no sounds are selected", () => {
    const sound1 = createMockSound({ name: "Kick" });
    useLibraryStore.setState({
      ...initialLibraryState,
      sounds: [sound1],
    });

    vi.mocked(useAppSettings).mockReturnValue({
      data: { ...createMockAppSettings(), globalFolders: [], importFolderId: "", downloadFolderId: "" },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAppSettings>);

    renderPanel();

    const addToSetBtn = screen.getByRole("button", { name: /add to set/i });
    expect(addToSetBtn).toBeDisabled();
  });

  // 17. "Add to Set" button enabled after selecting a sound
  it("enables Add to Set button after selecting a sound", async () => {
    const sound1 = createMockSound({ name: "Kick" });
    useLibraryStore.setState({
      ...initialLibraryState,
      sounds: [sound1],
    });

    vi.mocked(useAppSettings).mockReturnValue({
      data: { ...createMockAppSettings(), globalFolders: [], importFolderId: "", downloadFolderId: "" },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAppSettings>);

    renderPanel();

    const checkbox = screen.getByRole("checkbox");
    await act(async () => {
      fireEvent.click(checkbox);
    });

    const addToSetBtn = screen.getByRole("button", { name: /add to set/i });
    expect(addToSetBtn).not.toBeDisabled();
  });

  describe("impact preview in delete dialogs", () => {
    it("shows affected pads in folder delete dialog when project references folder sounds", async () => {
      const folder = createMockGlobalFolder({ id: "folder-1", name: "Drums" });
      const sound = createMockSound({ id: "kick-id", name: "Kick", folderId: "folder-1" });
      useLibraryStore.setState({ ...initialLibraryState, sounds: [sound] });

      const inst = createMockSoundInstance({ soundId: "kick-id" });
      const layer = createMockLayer({ selection: { type: "assigned", instances: [inst] } });
      const pad = createMockPad({ name: "Kick Pad", layers: [layer] });
      const scene = createMockScene({ name: "Scene 1", pads: [pad] });
      const project = createMockProject({ scenes: [scene] });
      useProjectStore.setState({
        ...initialProjectState,
        project,
        folderPath: "/some/path",
        historyEntry: { name: "Test", path: "/some/path", date: new Date().toISOString() },
      });

      // Folder is not used as download/import destination
      vi.mocked(useAppSettings).mockReturnValue({
        data: { ...createMockAppSettings(), globalFolders: [folder], downloadFolderId: "other-id", importFolderId: "other-id2" },
        isLoading: false,
        isError: false,
      } as unknown as ReturnType<typeof useAppSettings>);

      renderPanel();

      // folder is auto-selected (first folder) — click the Delete button
      const deleteBtn = screen.getByRole("button", { name: /^delete$/i });
      await act(async () => {
        fireEvent.click(deleteBtn);
      });

      expect(screen.getByText("Affects this project:")).toBeInTheDocument();
      expect(screen.getByText('"Kick Pad"')).toBeInTheDocument();
    });

    it("shows affected pads in sounds delete dialog when project references selected sounds", async () => {
      const sound = createMockSound({ id: "snare-id", name: "Snare" });
      useLibraryStore.setState({ ...initialLibraryState, sounds: [sound] });

      const inst = createMockSoundInstance({ soundId: "snare-id" });
      const layer = createMockLayer({ selection: { type: "assigned", instances: [inst] } });
      const pad = createMockPad({ name: "Snare Pad", layers: [layer] });
      const scene = createMockScene({ name: "Scene 1", pads: [pad] });
      const project = createMockProject({ scenes: [scene] });
      useProjectStore.setState({
        ...initialProjectState,
        project,
        folderPath: "/some/path",
        historyEntry: { name: "Test", path: "/some/path", date: new Date().toISOString() },
      });

      vi.mocked(useAppSettings).mockReturnValue({
        data: { ...createMockAppSettings(), globalFolders: [], importFolderId: "", downloadFolderId: "" },
        isLoading: false,
        isError: false,
      } as unknown as ReturnType<typeof useAppSettings>);

      renderPanel();

      // Select the sound via checkbox
      const checkbox = screen.getByRole("checkbox");
      await act(async () => {
        fireEvent.click(checkbox);
      });

      // Click "Delete from Disk" button
      const deleteFromDiskBtn = screen.getByRole("button", { name: /delete from disk/i });
      await act(async () => {
        fireEvent.click(deleteFromDiskBtn);
      });

      expect(screen.getByText("Affects this project:")).toBeInTheDocument();
      expect(screen.getByText('"Snare Pad"')).toBeInTheDocument();
    });

    it("does not show impact section in sounds delete dialog when no pads reference the sounds", async () => {
      const sound = createMockSound({ id: "unused-id", name: "Unused" });
      useLibraryStore.setState({ ...initialLibraryState, sounds: [sound] });
      // No project pads reference "unused-id"
      const project = createMockProject({ scenes: [] });
      useProjectStore.setState({
        ...initialProjectState,
        project,
        folderPath: "/some/path",
        historyEntry: { name: "Test", path: "/some/path", date: new Date().toISOString() },
      });

      vi.mocked(useAppSettings).mockReturnValue({
        data: { ...createMockAppSettings(), globalFolders: [], importFolderId: "", downloadFolderId: "" },
        isLoading: false,
        isError: false,
      } as unknown as ReturnType<typeof useAppSettings>);

      renderPanel();

      const checkbox = screen.getByRole("checkbox");
      await act(async () => {
        fireEvent.click(checkbox);
      });

      const deleteFromDiskBtn = screen.getByRole("button", { name: /delete from disk/i });
      await act(async () => {
        fireEvent.click(deleteFromDiskBtn);
      });

      expect(screen.queryByText("Affects this project:")).not.toBeInTheDocument();
    });
  });
});
