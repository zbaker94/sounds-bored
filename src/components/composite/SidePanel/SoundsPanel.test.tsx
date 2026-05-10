import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SoundsPanel } from "./SoundsPanel";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { useAppSettingsStore, initialAppSettingsState } from "@/state/appSettingsStore";
import { useAnalysisStore, initialAnalysisState } from "@/state/analysisStore";
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

// Mock scope to intercept picker calls without going through invoke
const mockPickFiles = vi.fn();
const mockPickFolder = vi.fn();
const mockGrantDroppedPaths = vi.fn();
vi.mock("@/lib/scope", () => ({
  pickFiles: (...args: unknown[]) => mockPickFiles(...args),
  pickFolder: (...args: unknown[]) => mockPickFolder(...args),
  grantDroppedPaths: (...args: unknown[]) => mockGrantDroppedPaths(...args),
  restorePathScope: vi.fn().mockResolvedValue(undefined),
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
  tagImportedSounds: vi.fn(),
}));

import { copyFilesToFolder } from "@/lib/import";
const mockCopyFilesToFolder = copyFilesToFolder as ReturnType<typeof vi.fn>;

const mockScheduleAnalysisForSounds = vi.fn(() => Promise.resolve());

vi.mock("@/lib/library.reconcile", () => ({
  reconcileGlobalLibrary: vi.fn(() =>
    Promise.resolve({ sounds: [], changed: false, inaccessibleFolderIds: [] })
  ),
  checkMissingStatus: vi.fn(() =>
    Promise.resolve({
      missingSoundIds: new Set<string>(),
      missingFolderIds: new Set<string>(),
    })
  ),
  refreshMissingState: vi.fn(() => Promise.resolve()),
  scheduleAnalysisForSounds: vi.fn((...args: unknown[]) => mockScheduleAnalysisForSounds(...(args as []))),
}));

vi.mock("@/lib/audio/cacheUtils", () => ({
  evictSoundCaches: vi.fn(),
  evictSoundCachesMany: vi.fn(),
}));

const mockMutateAsync = vi.fn(() => Promise.resolve());

vi.mock("@/lib/library.queries", () => ({
  useSaveCurrentLibrary: vi.fn(() => ({ saveCurrentLibrary: mockMutateAsync })),
}));

vi.mock("@/lib/appSettings.queries", () => ({
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

// plugin-fs is globally mocked by src/test/tauri-mocks.ts; pull the
// auto-mocked `remove` so we can assert/clear it per-test.
import { remove as fsRemove, exists as fsExists } from "@tauri-apps/plugin-fs";

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
  useAppSettingsStore.setState({ ...initialAppSettingsState, settings: createMockAppSettings() });
  useAnalysisStore.setState({ ...initialAnalysisState });
  mockScheduleAnalysisForSounds.mockClear();
  mockOnFileDropEvent.mockClear();
  mockOnFileDropEvent.mockReturnValue(Promise.resolve(() => {}));
  mockPickFiles.mockReset();
  mockPickFiles.mockResolvedValue([]);
  mockPickFolder.mockReset();
  mockPickFolder.mockResolvedValue(null);
  mockGrantDroppedPaths.mockReset();
  mockGrantDroppedPaths.mockResolvedValue(undefined);
  mockCopyFilesToFolder.mockReset();
  mockCopyFilesToFolder.mockResolvedValue([]);
  mockMutateAsync.mockClear();
  vi.mocked(fsRemove).mockReset();
  vi.mocked(fsRemove).mockResolvedValue(undefined);
  vi.mocked(fsExists).mockReset();
  vi.mocked(fsExists).mockResolvedValue(true);
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
    useAppSettingsStore.setState({ ...initialAppSettingsState, settings: { ...createMockAppSettings(), globalFolders: [], importFolderId: "", downloadFolderId: "" } });

    renderPanel();
    expect(screen.getAllByRole("button", { name: /add folder/i }).length).toBeGreaterThan(0);
  });

  // 3. "Add Folder" item renders when folders exist
  it("renders the Add Folder item row when there are folders", () => {
    const settings = createMockAppSettings();
    useAppSettingsStore.setState({ ...initialAppSettingsState, settings: settings });

    renderPanel();
    // The Item row (not a <button>) should contain "Add Folder" text
    expect(screen.getByText("Add Folder")).toBeInTheDocument();
  });

  // 4. Clicking "Add Sounds" calls pickFiles with audio filter
  it("calls pickFiles with audio filter when Add Sounds is clicked", async () => {
    renderPanel();
    const btn = screen.getByRole("button", { name: /add sounds/i });
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(mockPickFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.arrayContaining([
          expect.objectContaining({ name: "Audio" }),
        ]),
      })
    );
  });

  // 5. Clicking "Add Folder" button calls pickFolder
  it("calls pickFolder when Add Folder button (empty state) is clicked", async () => {
    useAppSettingsStore.setState({ ...initialAppSettingsState, settings: { ...createMockAppSettings(), globalFolders: [], importFolderId: "", downloadFolderId: "" } });

    renderPanel();
    const btn = screen.getAllByRole("button", { name: /add folder/i })[0];
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(mockPickFolder).toHaveBeenCalled();
  });

  // 5b. Duplicate folder path shows error toast and does not save
  it("shows an error toast and does not save when adding a folder that already exists", async () => {
    const existingFolder = createMockGlobalFolder({ path: "/music/sounds" });
    useAppSettingsStore.setState({ ...initialAppSettingsState, settings: { ...createMockAppSettings(), globalFolders: [existingFolder] } });
    mockPickFolder.mockResolvedValueOnce("/music/sounds");

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
    useAppSettingsStore.setState({ ...initialAppSettingsState, settings: { ...createMockAppSettings(), globalFolders: [], importFolderId: "", downloadFolderId: "" } });

    renderPanel();

    expect(screen.getByText("Kick")).toBeInTheDocument();
    expect(screen.getByText("Snare")).toBeInTheDocument();
  });

  // 6b. useMemo: adding a sound to the store updates the list without explicit setSoundsForSelectedId
  it("reactively updates sound list when library store changes", async () => {
    useAppSettingsStore.setState({ ...initialAppSettingsState, settings: { ...createMockAppSettings(), globalFolders: [], importFolderId: "", downloadFolderId: "" } });

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

  // 7c. Dropping files invokes the import handler with the dropped paths
  it("invokes the import handler with dropped paths when a file-drop 'drop' event fires", async () => {
    let fileDropCallback: ((event: { payload: { type: string; paths: string[] } }) => Promise<void>) | null = null;

    mockOnFileDropEvent.mockImplementationOnce(((cb: (event: { payload: { type: string; paths: string[] } }) => Promise<void>) => {
      fileDropCallback = cb;
      return Promise.resolve(() => {});
    }) as any);

    const droppedPaths = ["/audio/kick.mp3", "/audio/snare.wav"];
    mockCopyFilesToFolder.mockReset();
    mockCopyFilesToFolder.mockResolvedValue([]);

    renderPanel();
    await act(async () => { await Promise.resolve(); });

    expect(fileDropCallback).not.toBeNull();

    await act(async () => {
      await fileDropCallback!({ payload: { type: "drop", paths: droppedPaths } });
    });

    expect(mockGrantDroppedPaths).toHaveBeenCalledWith(droppedPaths);
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
    useAppSettingsStore.setState({ ...initialAppSettingsState, settings: { ...createMockAppSettings(), globalFolders: [folder] } });

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
    useAppSettingsStore.setState({ ...initialAppSettingsState, settings: { ...createMockAppSettings(), globalFolders: [], importFolderId: "", downloadFolderId: "" } });

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
    useAppSettingsStore.setState({ ...initialAppSettingsState, settings: { ...createMockAppSettings(), globalFolders: [], importFolderId: "", downloadFolderId: "" } });

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
    useAppSettingsStore.setState({ ...initialAppSettingsState, settings: { ...createMockAppSettings(), globalFolders: [], importFolderId: "", downloadFolderId: "" } });

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
    useAppSettingsStore.setState({ ...initialAppSettingsState, settings: { ...createMockAppSettings(), globalFolders: [], importFolderId: "", downloadFolderId: "" } });

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
    useAppSettingsStore.setState({ ...initialAppSettingsState, settings: { ...createMockAppSettings(), globalFolders: [], importFolderId: "", downloadFolderId: "" } });

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
    useAppSettingsStore.setState({ ...initialAppSettingsState, settings: { ...createMockAppSettings(), globalFolders: [], importFolderId: "", downloadFolderId: "" } });

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
    useAppSettingsStore.setState({ ...initialAppSettingsState, settings: { ...createMockAppSettings(), globalFolders: [], importFolderId: "", downloadFolderId: "" } });

    renderPanel();

    const checkbox = screen.getByRole("checkbox");
    await act(async () => {
      fireEvent.click(checkbox);
    });

    const addToSetBtn = screen.getByRole("button", { name: /add to set/i });
    expect(addToSetBtn).not.toBeDisabled();
  });

  // 15b. Select None toggle-back: starting with all selectable sounds already selected,
  //      a single click on the toggle button deselects everything (handleSelectAllNone path).
  it("toggles back to deselect all when everything is already selected", async () => {
    const sound1 = createMockSound({ name: "Kick" });
    const sound2 = createMockSound({ name: "Snare" });
    useLibraryStore.setState({
      ...initialLibraryState,
      sounds: [sound1, sound2],
    });
    useAppSettingsStore.setState({ ...initialAppSettingsState, settings: { ...createMockAppSettings(), globalFolders: [], importFolderId: "", downloadFolderId: "" } });

    renderPanel();

    // Pre-select both sounds by clicking their checkboxes
    const checkboxes = screen.getAllByRole("checkbox");
    await act(async () => { fireEvent.click(checkboxes[0]); });
    await act(async () => { fireEvent.click(checkboxes[1]); });

    // Button label should now be "Select None" — clicking it should deselect all
    const selectNoneBtn = screen.getByRole("button", { name: /select none/i });
    await act(async () => { fireEvent.click(selectNoneBtn); });

    const updatedCheckboxes = screen.getAllByRole("checkbox");
    expect(updatedCheckboxes[0]).not.toBeChecked();
    expect(updatedCheckboxes[1]).not.toBeChecked();
    // And the button should flip back to "Select All"
    expect(screen.getByRole("button", { name: /select all/i })).toBeInTheDocument();
  });

  // 15c. If the currently-selected folder disappears from app settings (e.g. it
  //      was removed elsewhere), the panel should not crash and should gracefully
  //      render with no selection.
  it("handles a stale selectedId when the selected folder is removed from settings", async () => {
    const folder = createMockGlobalFolder({ id: "soon-to-be-gone", name: "Gone" });
    useAppSettingsStore.setState({ ...initialAppSettingsState, settings: { ...createMockAppSettings(), globalFolders: [folder], downloadFolderId: "other", importFolderId: "other2" } });

    const { rerender } = renderPanel();

    // Initial render auto-selects the only folder — panel mounts without error
    expect(screen.getByText("Gone")).toBeInTheDocument();

    // Simulate the folder being removed from settings (e.g. deleted from disk,
    // or removed by another flow). The selectedId in local state still points
    // at the now-gone folder — the panel should not crash.
    useAppSettingsStore.setState({ ...initialAppSettingsState, settings: { ...createMockAppSettings(), globalFolders: [], downloadFolderId: "", importFolderId: "" } });

    const qc = makeQueryClient();
    await act(async () => {
      rerender(
        <QueryClientProvider client={qc}>
          <TooltipProvider>
            <SoundsPanel />
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });

    // Folder list is now empty — empty-state buttons should render instead of
    // the previous folder row, and the panel should still be operational.
    expect(screen.queryByText("Gone")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /add folder/i }).length).toBeGreaterThan(0);
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
    useAppSettingsStore.setState({ ...initialAppSettingsState, settings: { ...createMockAppSettings(), globalFolders: [folder], downloadFolderId: "other-id", importFolderId: "other-id2" } });

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
    useAppSettingsStore.setState({ ...initialAppSettingsState, settings: { ...createMockAppSettings(), globalFolders: [], importFolderId: "", downloadFolderId: "" } });

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
    useAppSettingsStore.setState({ ...initialAppSettingsState, settings: { ...createMockAppSettings(), globalFolders: [], importFolderId: "", downloadFolderId: "" } });

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

    it("calls saveLibrary and fs.remove when the Delete from Disk button is confirmed", async () => {
      const folder = createMockGlobalFolder({ id: "folder-1", name: "Drums" });
      const sound = createMockSound({
        id: "kick-id",
        name: "Kick",
        folderId: "folder-1",
        filePath: "/music/SoundsBored/drums/kick.wav",
      });
      useLibraryStore.setState({ ...initialLibraryState, sounds: [sound] });

      // Select the folder so the sound is disk-deletable, but use a distinct
      // downloadFolderId / importFolderId so delete isn't blocked.
    useAppSettingsStore.setState({ ...initialAppSettingsState, settings: { ...createMockAppSettings(), globalFolders: [folder], downloadFolderId: "other", importFolderId: "other2" } });

      renderPanel();

      // Select the sound via its checkbox
      const checkbox = screen.getByRole("checkbox");
      await act(async () => { fireEvent.click(checkbox); });

      // Open the delete dialog
      const deleteFromDiskBtn = screen.getByRole("button", { name: /delete from disk/i });
      await act(async () => { fireEvent.click(deleteFromDiskBtn); });

      // Confirm — the dialog's footer button has the count in its label
      const confirmBtn = screen.getByRole("button", { name: /delete 1 sound from disk/i });
      await act(async () => { fireEvent.click(confirmBtn); });

      // fs.remove should have been called for the sound's filePath
      expect(fsRemove).toHaveBeenCalledWith("/music/SoundsBored/drums/kick.wav");
      // saveLibrary (mockMutateAsync) should have been invoked to persist
      // the library after deletion.
      expect(mockMutateAsync).toHaveBeenCalled();
    });
  });

  describe("Loudness analysis button", () => {
    function setupFolderWithSound(loudnessLufs?: number) {
      const folder = createMockGlobalFolder({ id: "f1", path: "/music" });
      const sound = createMockSound({
        id: "s1",
        name: "Kick",
        filePath: "/music/kick.wav",
        folderId: "f1",
        loudnessLufs,
      });
      useLibraryStore.setState({ ...initialLibraryState, sounds: [sound] });
      useAppSettingsStore.setState({
        ...initialAppSettingsState,
        settings: createMockAppSettings({
          globalFolders: [folder],
          importFolderId: folder.id,
        }),
      });
      return { folder, sound };
    }

    it("Loudness button is hidden when no sounds are selected", () => {
      setupFolderWithSound();
      renderPanel();
      expect(screen.queryByRole("button", { name: /loudness/i })).not.toBeInTheDocument();
    });

    it("Loudness button appears after selecting a sound and schedules analysis without warning when sound is unanalyzed", async () => {
      setupFolderWithSound(); // no loudnessLufs → unanalyzed
      renderPanel();

      const checkbox = screen.getByRole("checkbox");
      await act(async () => { fireEvent.click(checkbox); });

      const btn = screen.getByRole("button", { name: /loudness/i });
      await act(async () => { fireEvent.click(btn); });

      expect(mockScheduleAnalysisForSounds).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ id: "s1" })]),
      );
    });

    it("schedules analysis while another analysis is already running (queueing, issue #418)", async () => {
      setupFolderWithSound();
      // Simulate an already-running analysis (the core fix for #418)
      useAnalysisStore.setState({
        ...initialAnalysisState,
        status: "running",
        queueLength: 5,
        analyzingCount: 4,
        completedCount: 1,
      });

      renderPanel();

      const checkbox = screen.getByRole("checkbox");
      await act(async () => { fireEvent.click(checkbox); });

      const btn = screen.getByRole("button", { name: /loudness/i });
      await act(async () => { fireEvent.click(btn); });

      // scheduleAnalysisForSounds must be called even when analysis is running
      expect(mockScheduleAnalysisForSounds).toHaveBeenCalled();
    });
  });

  describe("Add to Set dialog flow", () => {
    function setupSoundsWithNoFolders(...names: string[]) {
      const sounds = names.map((name) => createMockSound({ name }));
      useLibraryStore.setState({ ...initialLibraryState, sounds });
      useAppSettingsStore.setState({
        ...initialAppSettingsState,
        settings: { ...createMockAppSettings(), globalFolders: [], importFolderId: "", downloadFolderId: "" },
      });
      return sounds;
    }

    it("clicking 'Add to Set' opens AddToSetDialog when one sound is selected", async () => {
      const [sound] = setupSoundsWithNoFolders("Kick");
      renderPanel();

      const checkbox = screen.getByRole("checkbox");
      await act(async () => { fireEvent.click(checkbox); });

      expect(screen.queryByTestId("add-to-set-dialog")).not.toBeInTheDocument();

      const addToSetBtn = screen.getByRole("button", { name: /add to set/i });
      await act(async () => { fireEvent.click(addToSetBtn); });

      expect(screen.getByTestId("add-to-set-dialog")).toBeInTheDocument();
      expect(screen.getByTestId("add-to-set-dialog").textContent).toContain("1 sounds");
      void sound;
    });

    it("AddToSetDialog receives all selected sound IDs when multiple sounds are selected", async () => {
      setupSoundsWithNoFolders("Kick", "Snare", "HiHat");
      renderPanel();

      const checkboxes = screen.getAllByRole("checkbox");
      await act(async () => { fireEvent.click(checkboxes[0]); });
      await act(async () => { fireEvent.click(checkboxes[1]); });

      const addToSetBtn = screen.getByRole("button", { name: /add to set/i });
      await act(async () => { fireEvent.click(addToSetBtn); });

      expect(screen.getByTestId("add-to-set-dialog").textContent).toContain("2 sounds");
    });
  });

  describe("bulk delete selected sounds", () => {
    function setupThreeSounds() {
      const [s1, s2, s3] = [
        createMockSound({ id: "s1", name: "Kick", filePath: "/music/kick.mp3" }),
        createMockSound({ id: "s2", name: "Snare", filePath: "/music/snare.mp3" }),
        createMockSound({ id: "s3", name: "HiHat", filePath: "/music/hihat.mp3" }),
      ];
      useLibraryStore.setState({ ...initialLibraryState, sounds: [s1, s2, s3] });
      useAppSettingsStore.setState({
        ...initialAppSettingsState,
        settings: { ...createMockAppSettings(), globalFolders: [], importFolderId: "", downloadFolderId: "" },
      });
      return [s1, s2, s3] as const;
    }

    it("shows confirmation dialog when Delete from Disk is clicked with 2 sounds selected", async () => {
      setupThreeSounds();
      renderPanel();

      const checkboxes = screen.getAllByRole("checkbox");
      await act(async () => { fireEvent.click(checkboxes[0]); });
      await act(async () => { fireEvent.click(checkboxes[1]); });

      const deleteBtn = screen.getByRole("button", { name: /delete from disk/i });
      await act(async () => { fireEvent.click(deleteBtn); });

      expect(screen.getByRole("button", { name: /delete 2 sounds from disk/i })).toBeInTheDocument();
    });

    it("removes selected sounds from library store after confirming bulk delete", async () => {
      setupThreeSounds();
      renderPanel();

      const checkboxes = screen.getAllByRole("checkbox");
      await act(async () => { fireEvent.click(checkboxes[0]); });
      await act(async () => { fireEvent.click(checkboxes[1]); });

      const deleteBtn = screen.getByRole("button", { name: /delete from disk/i });
      await act(async () => { fireEvent.click(deleteBtn); });

      const confirmBtn = screen.getByRole("button", { name: /delete 2 sounds from disk/i });
      await act(async () => { fireEvent.click(confirmBtn); });

      const remainingSounds = useLibraryStore.getState().sounds;
      expect(remainingSounds).toHaveLength(1);
      expect(remainingSounds[0].name).toBe("HiHat");
    });
  });
});
