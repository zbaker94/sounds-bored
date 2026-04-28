import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useUiStore, initialUiState, OVERLAY_ID } from "@/state/uiStore";
import { useAppSettingsStore, initialAppSettingsState } from "@/state/appSettingsStore";
import { createMockAppSettings, createMockGlobalFolder } from "@/test/factories";
import { SettingsDialog } from "./SettingsDialog";
import { StartScreen } from "@/components/screens/start/StartScreen";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/lib/scope", () => ({
  pickFolder: vi.fn(),
  pickFile: vi.fn(),
  pickFiles: vi.fn(),
  restorePathScope: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/contexts/ProjectActionsContext", () => ({
  useProjectActions: vi.fn(() => ({
    canSave: false,
    handleSaveClick: vi.fn(),
    requestNavigateAway: vi.fn(),
  })),
}));

vi.mock("@/lib/history.queries", () => ({
  useProjectHistory: vi.fn(() => ({ data: [], isLoading: false, error: null })),
  useSaveProjectHistory: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));
vi.mock("@/lib/project.queries", () => ({
  useLoadProject: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useLoadProjectFromPath: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useCreateProject: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: vi.fn(() => vi.fn()) };
});
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn(() => Promise.resolve()) }));
vi.mock("@tauri-apps/plugin-fs", () => ({ exists: vi.fn(() => Promise.resolve(true)) }));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const mockSaveSettings = vi.fn();
vi.mock("@/lib/appSettings.queries", () => ({
  useSaveAppSettings: vi.fn(() => ({ mutate: mockSaveSettings })),
}));

import { pickFolder } from "@/lib/scope";
const mockPickFolder = pickFolder as unknown as ReturnType<typeof vi.fn>;

import { openPath } from "@tauri-apps/plugin-opener";
const mockOpenPath = openPath as ReturnType<typeof vi.fn>;

import { toast } from "sonner";
const mockToastError = toast.error as ReturnType<typeof vi.fn>;

function renderDialog() {
  return render(
    <TooltipProvider>
      <SettingsDialog />
    </TooltipProvider>
  );
}

function openDialog() {
  act(() => {
    useUiStore.getState().openOverlay(OVERLAY_ID.SETTINGS_DIALOG, "dialog");
  });
}

beforeEach(() => {
  useUiStore.setState({ ...initialUiState });
  useAppSettingsStore.setState({ ...initialAppSettingsState });
  mockSaveSettings.mockClear();
  mockPickFolder.mockReset();
  mockOpenPath.mockReset();
  mockOpenPath.mockResolvedValue(undefined);
  mockToastError.mockClear();
});

describe("SettingsDialog — shell", () => {
  it("is not visible when overlay is closed", () => {
    renderDialog();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("is visible when overlay is open", () => {
    renderDialog();
    openDialog();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("shows a Folders tab", () => {
    renderDialog();
    openDialog();
    expect(screen.getByRole("tab", { name: /folders/i })).toBeInTheDocument();
  });

  it("closes overlay when dialog close button is clicked", async () => {
    const user = userEvent.setup();
    renderDialog();
    openDialog();
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(useUiStore.getState().isOverlayOpen(OVERLAY_ID.SETTINGS_DIALOG)).toBe(false);
  });
});

function renderStartScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <StartScreen />
    </QueryClientProvider>
  );
}

describe("SettingsDialog — StartScreen trigger", () => {
  it("renders a Settings button on StartScreen", () => {
    renderStartScreen();
    expect(screen.getByRole("button", { name: /settings/i })).toBeInTheDocument();
  });

  it("opens settings dialog when Settings button is clicked", async () => {
    const user = userEvent.setup();
    renderStartScreen();
    await user.click(screen.getByRole("button", { name: /settings/i }));
    expect(useUiStore.getState().isOverlayOpen(OVERLAY_ID.SETTINGS_DIALOG)).toBe(true);
  });
});

import { MenuDrawer } from "@/components/composite/SceneTabBar/MenuDrawer";

function renderMenuDrawer() {
  return render(<MenuDrawer />);
}

function openMenuDrawer() {
  act(() => {
    useUiStore.getState().openOverlay(OVERLAY_ID.MENU_DRAWER, "drawer");
  });
}

describe("SettingsDialog — MenuDrawer trigger", () => {
  it("renders a Settings button in the menu drawer", () => {
    renderMenuDrawer();
    openMenuDrawer();
    expect(screen.getByRole("button", { name: /settings/i })).toBeInTheDocument();
  });

  it("opens settings dialog when Settings is clicked in drawer", async () => {
    const user = userEvent.setup();
    renderMenuDrawer();
    openMenuDrawer();
    await user.click(screen.getByRole("button", { name: /settings/i }));
    expect(useUiStore.getState().isOverlayOpen(OVERLAY_ID.SETTINGS_DIALOG)).toBe(true);
  });
});

function setupFolderState() {
  const downloadFolder = createMockGlobalFolder({ id: "dl-id", name: "Downloads", path: "/music/downloads" });
  const importFolder = createMockGlobalFolder({ id: "imp-id", name: "Imported", path: "/music/imported" });
  const otherFolder = createMockGlobalFolder({ id: "other-id", name: "Other", path: "/music/other" });
  const settings = createMockAppSettings({
    globalFolders: [downloadFolder, importFolder, otherFolder],
    downloadFolderId: downloadFolder.id,
    importFolderId: importFolder.id,
  });
  useAppSettingsStore.setState({ settings });
  return { downloadFolder, importFolder, otherFolder };
}

describe("SettingsDialog — Folders tab display", () => {
  it("renders folder names when dialog is open", () => {
    setupFolderState();
    renderDialog();
    openDialog();
    expect(screen.getAllByText("Downloads").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Imported").length).toBeGreaterThan(0);
    expect(screen.getByText("Other")).toBeInTheDocument();
  });

  it("shows the Add Folder button", () => {
    setupFolderState();
    renderDialog();
    openDialog();
    expect(screen.getByRole("button", { name: /add folder/i })).toBeInTheDocument();
  });

  it("remove button is disabled for the download folder", () => {
    setupFolderState();
    renderDialog();
    openDialog();
    expect(screen.getByRole("button", { name: /remove downloads/i })).toBeDisabled();
  });

  it("remove button is disabled for the import folder", () => {
    setupFolderState();
    renderDialog();
    openDialog();
    expect(screen.getByRole("button", { name: /remove imported/i })).toBeDisabled();
  });

  it("remove button is enabled for an unassigned folder", () => {
    setupFolderState();
    renderDialog();
    openDialog();
    expect(screen.getByRole("button", { name: /remove other/i })).not.toBeDisabled();
  });
});

describe("SettingsDialog — Add Folder", () => {
  it("calls pickFolder when Add Folder is clicked", async () => {
    const user = userEvent.setup();
    mockPickFolder.mockResolvedValue(null);
    setupFolderState();
    renderDialog();
    openDialog();
    await user.click(screen.getByRole("button", { name: /add folder/i }));
    expect(mockPickFolder).toHaveBeenCalledTimes(1);
  });

  it("adds a new folder to the store when a path is returned", async () => {
    const user = userEvent.setup();
    mockPickFolder.mockResolvedValue("/new/folder/path");
    setupFolderState();
    renderDialog();
    openDialog();
    await user.click(screen.getByRole("button", { name: /add folder/i }));
    const folders = useAppSettingsStore.getState().settings?.globalFolders ?? [];
    expect(folders.some((f) => f.path === "/new/folder/path")).toBe(true);
  });

  it("uses the last path segment as the default folder name", async () => {
    const user = userEvent.setup();
    mockPickFolder.mockResolvedValue("/some/path/mysounds");
    setupFolderState();
    renderDialog();
    openDialog();
    await user.click(screen.getByRole("button", { name: /add folder/i }));
    const folders = useAppSettingsStore.getState().settings?.globalFolders ?? [];
    expect(folders.some((f) => f.name === "mysounds")).toBe(true);
  });

  it("calls saveSettings after adding a folder", async () => {
    const user = userEvent.setup();
    mockPickFolder.mockResolvedValue("/new/folder");
    setupFolderState();
    renderDialog();
    openDialog();
    await user.click(screen.getByRole("button", { name: /add folder/i }));
    expect(mockSaveSettings).toHaveBeenCalledOnce();
  });

  it("does not modify the store if the picker is cancelled (null)", async () => {
    const user = userEvent.setup();
    mockPickFolder.mockResolvedValue(null);
    setupFolderState();
    renderDialog();
    openDialog();
    const countBefore = useAppSettingsStore.getState().settings!.globalFolders.length;
    await user.click(screen.getByRole("button", { name: /add folder/i }));
    const countAfter = useAppSettingsStore.getState().settings!.globalFolders.length;
    expect(countAfter).toBe(countBefore);
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });
});

describe("SettingsDialog — Remove Folder", () => {
  it("removes a folder from the store when the remove button is clicked", async () => {
    const user = userEvent.setup();
    const { otherFolder } = setupFolderState();
    renderDialog();
    openDialog();
    await user.click(screen.getByRole("button", { name: /remove other/i }));
    const folders = useAppSettingsStore.getState().settings?.globalFolders ?? [];
    expect(folders.some((f) => f.id === otherFolder.id)).toBe(false);
  });

  it("calls saveSettings after removing a folder", async () => {
    const user = userEvent.setup();
    setupFolderState();
    renderDialog();
    openDialog();
    await user.click(screen.getByRole("button", { name: /remove other/i }));
    expect(mockSaveSettings).toHaveBeenCalledOnce();
  });
});

describe("SettingsDialog — Playback tab", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function openPlaybackTab(user = userEvent.setup()) {
    renderDialog();
    openDialog();
    await user.click(screen.getByRole("tab", { name: /playback/i }));
  }

  it("renders the fade duration slider", async () => {
    useAppSettingsStore.setState({ settings: createMockAppSettings({ globalFadeDurationMs: 2000 }) });
    await openPlaybackTab();
    expect(screen.getByRole("slider")).toBeInTheDocument();
  });

  it("displays the current fade duration in seconds", async () => {
    useAppSettingsStore.setState({ settings: createMockAppSettings({ globalFadeDurationMs: 3000 }) });
    await openPlaybackTab();
    expect(screen.getByText("3.0s")).toBeInTheDocument();
  });

  it("updates the store immediately when the slider value changes", async () => {
    useAppSettingsStore.setState({ settings: createMockAppSettings({ globalFadeDurationMs: 2000 }) });
    await openPlaybackTab();
    const slider = screen.getByRole("slider");
    act(() => { fireEvent.keyDown(slider, { key: "ArrowRight" }); });
    expect(useAppSettingsStore.getState().settings?.globalFadeDurationMs).toBe(2100);
  });

  it("does not call saveSettings synchronously when the slider changes", async () => {
    useAppSettingsStore.setState({ settings: createMockAppSettings({ globalFadeDurationMs: 2000 }) });
    await openPlaybackTab();
    // Fake timers installed after userEvent interactions to avoid breaking userEvent's internal delays
    vi.useFakeTimers();
    const slider = screen.getByRole("slider");
    act(() => { fireEvent.keyDown(slider, { key: "ArrowRight" }); });
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it("calls saveSettings once after the debounce delay when slider stops", async () => {
    useAppSettingsStore.setState({ settings: createMockAppSettings({ globalFadeDurationMs: 2000 }) });
    await openPlaybackTab();
    // Fake timers installed after userEvent interactions to avoid breaking userEvent's internal delays
    vi.useFakeTimers();
    const slider = screen.getByRole("slider");
    act(() => { fireEvent.keyDown(slider, { key: "ArrowRight" }); });
    act(() => { fireEvent.keyDown(slider, { key: "ArrowRight" }); });
    act(() => { fireEvent.keyDown(slider, { key: "ArrowRight" }); });
    expect(mockSaveSettings).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(350); });
    expect(mockSaveSettings).toHaveBeenCalledOnce();
  });

  it("flushes the pending save when PlaybackTab unmounts before the debounce fires", async () => {
    useAppSettingsStore.setState({ settings: createMockAppSettings({ globalFadeDurationMs: 2000 }) });
    const { unmount } = renderDialog();
    openDialog();
    await userEvent.setup().click(screen.getByRole("tab", { name: /playback/i }));
    // Fake timers installed after userEvent interactions to avoid breaking userEvent's internal delays
    vi.useFakeTimers();
    const slider = screen.getByRole("slider");
    act(() => { fireEvent.keyDown(slider, { key: "ArrowRight" }); });
    expect(mockSaveSettings).not.toHaveBeenCalled();
    // Unmount before debounce fires — flush should persist the pending value
    act(() => { unmount(); });
    expect(mockSaveSettings).toHaveBeenCalledOnce();
  });
});

describe("SettingsDialog — Rename Folder", () => {
  it("clicking a folder name shows an input field", async () => {
    const user = userEvent.setup();
    setupFolderState();
    renderDialog();
    openDialog();
    await user.click(screen.getByRole("button", { name: "Other" }));
    expect(screen.getByRole("textbox", { name: /folder name/i })).toBeInTheDocument();
  });

  it("blurring with a changed name updates the store and saves", async () => {
    const user = userEvent.setup();
    setupFolderState();
    renderDialog();
    openDialog();
    await user.click(screen.getByRole("button", { name: "Other" }));
    const input = screen.getByRole("textbox", { name: /folder name/i });
    await user.clear(input);
    await user.type(input, "Renamed");
    await user.tab(); // trigger blur
    const folders = useAppSettingsStore.getState().settings?.globalFolders ?? [];
    expect(folders.some((f) => f.name === "Renamed")).toBe(true);
    expect(mockSaveSettings).toHaveBeenCalledOnce();
  });

  it("pressing Enter with a changed name updates the store and saves", async () => {
    const user = userEvent.setup();
    setupFolderState();
    renderDialog();
    openDialog();
    await user.click(screen.getByRole("button", { name: "Other" }));
    const input = screen.getByRole("textbox", { name: /folder name/i });
    await user.clear(input);
    await user.type(input, "EnteredName");
    await user.keyboard("{Enter}");
    const folders = useAppSettingsStore.getState().settings?.globalFolders ?? [];
    expect(folders.some((f) => f.name === "EnteredName")).toBe(true);
    expect(mockSaveSettings).toHaveBeenCalledOnce();
  });

  it("pressing Escape reverts the name without saving", async () => {
    const user = userEvent.setup();
    setupFolderState();
    renderDialog();
    openDialog();
    await user.click(screen.getByRole("button", { name: "Other" }));
    const input = screen.getByRole("textbox", { name: /folder name/i });
    await user.clear(input);
    await user.type(input, "Abandoned");
    await user.keyboard("{Escape}");
    const folders = useAppSettingsStore.getState().settings?.globalFolders ?? [];
    expect(folders.some((f) => f.name === "Other")).toBe(true);
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it("does not save if the name is unchanged on blur", async () => {
    const user = userEvent.setup();
    setupFolderState();
    renderDialog();
    openDialog();
    await user.click(screen.getByRole("button", { name: "Other" }));
    await user.tab(); // blur without changing
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });
});

describe("SettingsDialog — Open In Explorer error path", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows toast with error description when openPath throws", async () => {
    const user = userEvent.setup();
    setupFolderState();
    mockOpenPath.mockRejectedValueOnce(new Error("permission denied"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderDialog();
    openDialog();
    await user.click(screen.getByRole("button", { name: /open other in file explorer/i }));
    expect(mockToastError).toHaveBeenCalledWith("Could not open folder in file explorer.", {
      description: "permission denied",
    });
  });
});
