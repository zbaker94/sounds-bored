import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MultiFadePill } from "./MultiFadePill";

// Mock useMultiFadeMode since it reads from store + creates callbacks
vi.mock("@/hooks/useMultiFadeMode", () => ({
  useMultiFadeMode: vi.fn(),
}));
import { useMultiFadeMode } from "@/hooks/useMultiFadeMode";

const mockExecute = vi.fn();
const mockCancel = vi.fn();

import type { SelectedPadFade } from "@/state/multiFadeStore";

function setupMockHook({ canExecute = false, selectedCount = 0 } = {}) {
  const selectedPads = new Map<string, SelectedPadFade>();
  for (let i = 0; i < selectedCount; i++) {
    selectedPads.set(`pad-${i}`, { padId: `pad-${i}`, levels: [0, 100] });
  }
  vi.mocked(useMultiFadeMode).mockReturnValue({
    active: true,
    canExecute,
    selectedPads,
    execute: mockExecute,
    cancel: mockCancel,
    originPadId: null,
    reopenPadId: null,
    enter: vi.fn(),
    togglePad: vi.fn(),
    setFadeLevels: vi.fn(),
    clearReopenPadId: vi.fn(),
  });
}

describe("MultiFadePill", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockCancel.mockReset();
  });

  it("shows '0 pads selected' when no pads are selected", () => {
    setupMockHook({ selectedCount: 0 });
    render(<MultiFadePill />);
    expect(screen.getByText("0 pads selected")).toBeInTheDocument();
  });

  it("shows '1 pad selected' (singular) when one pad is selected", () => {
    setupMockHook({ selectedCount: 1 });
    render(<MultiFadePill />);
    expect(screen.getByText("1 pad selected")).toBeInTheDocument();
  });

  it("shows correct count when multiple pads are selected", () => {
    setupMockHook({ selectedCount: 3 });
    render(<MultiFadePill />);
    expect(screen.getByText("3 pads selected")).toBeInTheDocument();
  });

  it("calls execute when Execute Fade button is clicked", async () => {
    const user = userEvent.setup();
    setupMockHook({ canExecute: true, selectedCount: 1 });
    render(<MultiFadePill />);
    await user.click(screen.getByRole("button", { name: /execute fade/i }));
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("Execute Fade button is disabled when canExecute is false", () => {
    setupMockHook({ canExecute: false, selectedCount: 0 });
    render(<MultiFadePill />);
    const executeButton = screen.getByRole("button", { name: /execute fade/i });
    expect(executeButton).toBeDisabled();
  });

  it("Execute Fade button is enabled when canExecute is true", () => {
    setupMockHook({ canExecute: true, selectedCount: 1 });
    render(<MultiFadePill />);
    const executeButton = screen.getByRole("button", { name: /execute fade/i });
    expect(executeButton).toBeEnabled();
  });

  it("calls cancel when cancel button is clicked", async () => {
    const user = userEvent.setup();
    setupMockHook({ canExecute: false, selectedCount: 0 });
    render(<MultiFadePill />);
    await user.click(screen.getByRole("button", { name: /cancel multi-fade/i }));
    expect(mockCancel).toHaveBeenCalledTimes(1);
  });
});
