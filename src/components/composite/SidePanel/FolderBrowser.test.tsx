import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FolderBrowser } from "./FolderBrowser";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import {
  useAppSettingsStore,
  initialAppSettingsState,
} from "@/state/appSettingsStore";
import { useUiStore, initialUiState, OVERLAY_ID, selectIsOverlayOpen } from "@/state/uiStore";
import {
  createMockAppSettings,
  createMockGlobalFolder,
  createMockSet,
} from "@/test/factories";

// Tauri-dialog mock (per-test control — tauri-mocks.ts also mocks it globally)
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

// Window drag-drop API mock (FolderBrowser doesn't use it, but useReconcileLibrary / useAddFolder pull from Tauri APIs)
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    onDragDropEvent: vi.fn(() => Promise.resolve(() => {})),
  })),
}));

// opener + fs plugins used by handleOpenFolderInExplorer + delete flow
vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(() => Promise.resolve(true)),
  remove: vi.fn(() => Promise.resolve()),
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

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const mockMutateAsync = vi.fn(() => Promise.resolve());

vi.mock("@/lib/library.queries", () => ({
  useSaveCurrentLibrary: vi.fn(() => ({ saveCurrentLibrary: mockMutateAsync })),
}));

vi.mock("@/lib/appSettings.queries", () => ({
  useSaveAppSettings: vi.fn(() => ({ mutateAsync: mockMutateAsync })),
}));

// Mock the folder dialog so we can assert it received the correct folder
vi.mock("@/components/modals/ResolveMissingFolderDialog", () => ({
  ResolveMissingFolderDialog: ({
    folder,
  }: {
    folder: { id: string; name: string } | null;
    onResolved?: () => void;
    onClose: () => void;
  }) =>
    folder ? (
      <div data-testid="resolve-missing-folder-dialog">
        ResolveMissingFolderDialog open ({folder.id})
      </div>
    ) : null,
}));

import { openPath } from "@tauri-apps/plugin-opener";
const mockOpenPath = openPath as ReturnType<typeof vi.fn>;

import { toast } from "sonner";
const mockToastError = toast.error as ReturnType<typeof vi.fn>;

// ---------- helpers ----------

function renderBrowser(props?: {
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  searchQuery?: string;
}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <FolderBrowser
          selectedId={props?.selectedId ?? null}
          onSelect={props?.onSelect ?? vi.fn()}
          searchQuery={props?.searchQuery ?? ""}
          onOpenAddSet={vi.fn()}
          onImportSounds={vi.fn()}
          isImporting={false}
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
  mockMutateAsync.mockResolvedValue(undefined);
  mockOpenPath.mockReset();
  mockOpenPath.mockResolvedValue(undefined);
  mockToastError.mockClear();
});

// ---------- tests ----------

describe("FolderBrowser", () => {
  it("renders sets list from the library store", () => {
    const set = createMockSet({ name: "My Kicks" });
    useLibraryStore.setState({
      ...initialLibraryState,
      sets: [set],
    });
    renderBrowser();
    expect(screen.getByText("My Kicks")).toBeInTheDocument();
  });

  it("renders the folders list from app settings", () => {
    const folder = createMockGlobalFolder({ name: "Custom Folder" });
    useAppSettingsStore.setState({ ...initialAppSettingsState, settings: { ...createMockAppSettings(), globalFolders: [folder] } });
    renderBrowser();
    expect(screen.getByText("Custom Folder")).toBeInTheDocument();
  });

  it("'Remove All' banner button opens the confirm-remove-missing-folders overlay", async () => {
    const folder = createMockGlobalFolder({ id: "missing-f", name: "Missing Folder" });
    useAppSettingsStore.setState({ ...initialAppSettingsState, settings: { ...createMockAppSettings(), globalFolders: [folder] } });
    useLibraryStore.setState({
      ...initialLibraryState,
      missingFolderIds: new Set<string>(["missing-f"]),
    });

    renderBrowser();

    // Banner should be visible
    expect(screen.getByText(/folder missing/i)).toBeInTheDocument();

    // Initial flag is false
    expect(selectIsOverlayOpen(OVERLAY_ID.CONFIRM_REMOVE_MISSING_FOLDERS)(useUiStore.getState())).toBe(false);

    const removeAllBtn = screen.getByRole("button", { name: /remove all/i });
    await act(async () => {
      fireEvent.click(removeAllBtn);
    });

    expect(selectIsOverlayOpen(OVERLAY_ID.CONFIRM_REMOVE_MISSING_FOLDERS)(useUiStore.getState())).toBe(true);
  });

  it("'Review →' button opens the folder dialog queue", async () => {
    const folder = createMockGlobalFolder({
      id: "missing-f",
      name: "Missing Folder",
    });
    useAppSettingsStore.setState({ ...initialAppSettingsState, settings: { ...createMockAppSettings(), globalFolders: [folder] } });
    useLibraryStore.setState({
      ...initialLibraryState,
      missingFolderIds: new Set<string>(["missing-f"]),
    });

    renderBrowser();

    expect(
      screen.queryByTestId("resolve-missing-folder-dialog"),
    ).not.toBeInTheDocument();

    const reviewBtn = screen.getByRole("button", { name: /review/i });
    await act(async () => {
      fireEvent.click(reviewBtn);
    });

    const dialog = screen.getByTestId("resolve-missing-folder-dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog.textContent).toContain("missing-f");
  });

  it("clicking a missing folder in the list opens the resolve dialog for that folder", async () => {
    const folder = createMockGlobalFolder({
      id: "missing-f",
      name: "Missing Folder",
    });
    useAppSettingsStore.setState({ ...initialAppSettingsState, settings: { ...createMockAppSettings(), globalFolders: [folder] } });
    useLibraryStore.setState({
      ...initialLibraryState,
      missingFolderIds: new Set<string>(["missing-f"]),
    });

    renderBrowser();

    const row = screen.getByText("Missing Folder");
    await act(async () => {
      fireEvent.click(row);
    });

    const dialog = screen.getByTestId("resolve-missing-folder-dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog.textContent).toContain("missing-f");
  });

  it("Add Folder button renders and is not disabled when settings are loaded", () => {
    renderBrowser();

    const addFolderBtn = screen.getByRole("button", { name: /add folder/i });
    expect(addFolderBtn).toBeInTheDocument();
    expect(addFolderBtn).not.toBeDisabled();
  });
});

describe("FoldersPanel — error paths", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows toast with error description when openPath throws in handleOpenFolderInExplorer", async () => {
    const folder = createMockGlobalFolder({ id: "f1", name: "Sounds", path: "/music/sounds" });
    useAppSettingsStore.setState({
      ...initialAppSettingsState,
      settings: createMockAppSettings({ globalFolders: [folder] }),
    });
    mockOpenPath.mockRejectedValueOnce(new Error("permission denied"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    renderBrowser({ selectedId: "f1" });

    const openBtn = screen.getByRole("button", { name: /^open$/i });
    await act(async () => {
      fireEvent.click(openBtn);
    });

    expect(mockToastError).toHaveBeenCalledWith("Failed to open folder", {
      description: "permission denied",
    });
  });

  it("shows toast with error description when saveSettings throws in handleDeleteFolderFromDisk", async () => {
    const folder = createMockGlobalFolder({ id: "f1", name: "Sounds", path: "/music/sounds" });
    const settings = createMockAppSettings({
      globalFolders: [folder],
      downloadFolderId: undefined,
      importFolderId: undefined,
    });
    useAppSettingsStore.setState({ ...initialAppSettingsState, settings });
    mockMutateAsync.mockRejectedValueOnce(new Error("disk full"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    renderBrowser({ selectedId: "f1" });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /delete from disk/i }));
    });

    expect(mockToastError).toHaveBeenCalledWith("Failed to delete folder from disk", {
      description: "disk full",
    });
  });
});
