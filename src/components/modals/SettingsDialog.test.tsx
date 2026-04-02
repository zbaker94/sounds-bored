import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useUiStore, initialUiState, OVERLAY_ID } from "@/state/uiStore";
import { useAppSettingsStore, initialAppSettingsState } from "@/state/appSettingsStore";
import { createMockAppSettings } from "@/test/factories";
import { SettingsDialog } from "./SettingsDialog";
import { open } from "@tauri-apps/plugin-dialog";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

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
