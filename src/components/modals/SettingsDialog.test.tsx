import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useUiStore, initialUiState, OVERLAY_ID } from "@/state/uiStore";
import { useAppSettingsStore, initialAppSettingsState } from "@/state/appSettingsStore";
import { createMockAppSettings } from "@/test/factories";
import { SettingsDialog } from "./SettingsDialog";
import { open } from "@tauri-apps/plugin-dialog";
import { StartScreen } from "@/components/screens/start/StartScreen";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

vi.mock("@/contexts/ProjectActionsContext", () => ({
  useProjectActions: vi.fn(() => ({
    canSave: false,
    handleSaveClick: vi.fn(),
    requestNavigateAway: vi.fn(),
  })),
}));

vi.mock("@/lib/history.queries", () => ({
  useProjectHistory: vi.fn(() => ({ data: [], isLoading: false, error: null })),
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
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn() }));

const mockSaveSettings = vi.fn();
vi.mock("@/lib/appSettings.queries", () => ({
  useSaveAppSettings: vi.fn(() => ({ mutate: mockSaveSettings })),
}));

function renderDialog() {
  return render(<SettingsDialog />);
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
  vi.mocked(open).mockReset();
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
