import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StartScreen } from "./StartScreen";
import { createMockHistoryEntry } from "@/test/factories";

vi.mock("@/lib/scope", () => ({
  restorePathScope: vi.fn(() => Promise.resolve()),
  openPathInExplorer: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(() => Promise.resolve(true)),
  remove: vi.fn(() => Promise.resolve()),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: vi.fn(() => vi.fn()) };
});

vi.mock("@/lib/history.queries", () => ({
  useProjectHistory: vi.fn(() => ({ data: [], isLoading: false, error: null })),
  useSaveProjectHistory: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock("@/lib/project.queries", () => ({
  useLoadProject: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useLoadProjectFromPath: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useCreateProject: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock("@/contexts/ProjectActionsContext", () => ({
  useProjectActions: vi.fn(() => ({
    canSave: false,
    handleSaveClick: vi.fn(),
    requestNavigateAway: vi.fn(),
  })),
}));

import { restorePathScope, openPathInExplorer } from "@/lib/scope";
const mockRestorePathScope = restorePathScope as unknown as ReturnType<typeof vi.fn>;
const mockOpenPathInExplorer = openPathInExplorer as unknown as ReturnType<typeof vi.fn>;

import { exists } from "@tauri-apps/plugin-fs";
const mockExists = exists as ReturnType<typeof vi.fn>;

import { toast } from "sonner";
const mockToastError = toast.error as ReturnType<typeof vi.fn>;

import { useProjectHistory } from "@/lib/history.queries";
const mockUseProjectHistory = useProjectHistory as ReturnType<typeof vi.fn>;

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <StartScreen />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockRestorePathScope.mockReset();
  mockRestorePathScope.mockResolvedValue(undefined);
  mockOpenPathInExplorer.mockReset();
  mockOpenPathInExplorer.mockResolvedValue(undefined);
  mockExists.mockReset();
  mockExists.mockResolvedValue(true);
  mockToastError.mockClear();
  mockUseProjectHistory.mockReturnValue({
    data: [],
    isLoading: false,
    error: null,
  });
});

describe("StartScreen — handleOpenProjectInExplorer", () => {
  it("calls restorePathScope then openPathInExplorer for an existing project path", async () => {
    const user = userEvent.setup();
    const entry = createMockHistoryEntry({ name: "My Project", path: "C:/Projects/MyProject" });
    mockUseProjectHistory.mockReturnValue({ data: [entry], isLoading: false, error: null });

    renderScreen();

    const openBtn = screen.getByRole("button", { name: `Open folder for ${entry.name}` });
    await user.click(openBtn);

    expect(mockRestorePathScope).toHaveBeenCalledWith(entry.path);
    expect(mockOpenPathInExplorer).toHaveBeenCalledWith(entry.path);
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("shows error toast and skips openPathInExplorer when path does not exist", async () => {
    const user = userEvent.setup();
    const entry = createMockHistoryEntry({ name: "Gone Project", path: "C:/Projects/Gone" });
    mockUseProjectHistory.mockReturnValue({ data: [entry], isLoading: false, error: null });
    mockExists.mockResolvedValueOnce(false);

    renderScreen();

    const openBtn = screen.getByRole("button", { name: `Open folder for ${entry.name}` });
    await user.click(openBtn);

    expect(mockToastError).toHaveBeenCalledWith("Project folder no longer exists at this location.");
    expect(mockOpenPathInExplorer).not.toHaveBeenCalled();
  });

  it("shows error toast when openPathInExplorer rejects", async () => {
    const user = userEvent.setup();
    const entry = createMockHistoryEntry({ name: "My Project", path: "C:/Users/user/Music/MyProject" });
    mockUseProjectHistory.mockReturnValue({ data: [entry], isLoading: false, error: null });
    mockOpenPathInExplorer.mockRejectedValueOnce(new Error("access denied"));

    renderScreen();

    const openBtn = screen.getByRole("button", { name: `Open folder for ${entry.name}` });
    await user.click(openBtn);

    expect(mockToastError).toHaveBeenCalledWith("Could not open project folder.");
  });

  it("shows error toast when restorePathScope rejects", async () => {
    const user = userEvent.setup();
    const entry = createMockHistoryEntry({ name: "My Project", path: "C:/Users/user/Music/MyProject" });
    mockUseProjectHistory.mockReturnValue({ data: [entry], isLoading: false, error: null });
    mockRestorePathScope.mockRejectedValueOnce(new Error("scope denied"));

    renderScreen();

    const openBtn = screen.getByRole("button", { name: `Open folder for ${entry.name}` });
    await user.click(openBtn);

    expect(mockToastError).toHaveBeenCalledWith("Could not open project folder.");
    expect(mockOpenPathInExplorer).not.toHaveBeenCalled();
  });

  it("shows error toast when exists throws", async () => {
    const user = userEvent.setup();
    const entry = createMockHistoryEntry({ name: "My Project", path: "C:/Users/user/Music/MyProject" });
    mockUseProjectHistory.mockReturnValue({ data: [entry], isLoading: false, error: null });
    mockExists.mockRejectedValueOnce(new Error("io error"));

    renderScreen();

    const openBtn = screen.getByRole("button", { name: `Open folder for ${entry.name}` });
    await user.click(openBtn);

    expect(mockToastError).toHaveBeenCalledWith("Could not open project folder.");
    expect(mockOpenPathInExplorer).not.toHaveBeenCalled();
  });
});
