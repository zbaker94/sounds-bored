import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MultiFadePill } from "./MultiFadePill";
import { useMultiFadeStore } from "@/state/multiFadeStore";
import type { SelectedPadFade } from "@/state/multiFadeStore";
import { useProjectStore } from "@/state/projectStore";
import { createMockProject, createMockScene, createMockPad } from "@/test/factories";

// Mock audio module so executeFadeTap doesn't run real Web Audio
vi.mock("@/lib/audio/padPlayer", () => ({
  executeFadeTap: vi.fn(),
}));

import { executeFadeTap } from "@/lib/audio/padPlayer";

function setupStore({ active = true, selectedCount = 0, padIds }: { active?: boolean; selectedCount?: number; padIds?: string[] } = {}) {
  const selectedPads = new Map<string, SelectedPadFade>();
  const ids = padIds ?? Array.from({ length: selectedCount }, (_, i) => `pad-${i}`);
  for (const id of ids) {
    selectedPads.set(id, { padId: id, levels: [0, 100] });
  }
  useMultiFadeStore.setState({ active, selectedPads });
}

describe("MultiFadePill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store to default inactive state
    useMultiFadeStore.setState({
      active: false,
      selectedPads: new Map(),
      originPadId: null,
      reopenPadId: null,
    });
    useProjectStore.setState({ project: null });
  });

  it("shows '0 pads selected' when no pads are selected", () => {
    setupStore({ selectedCount: 0 });
    render(<MultiFadePill />);
    expect(screen.getByText("0 pads selected")).toBeInTheDocument();
  });

  it("shows '1 pad selected' (singular) when one pad is selected", () => {
    setupStore({ selectedCount: 1 });
    render(<MultiFadePill />);
    expect(screen.getByText("1 pad selected")).toBeInTheDocument();
  });

  it("shows correct count when multiple pads are selected", () => {
    setupStore({ selectedCount: 3 });
    render(<MultiFadePill />);
    expect(screen.getByText("3 pads selected")).toBeInTheDocument();
  });

  it("calls execute when Execute Fade button is clicked", async () => {
    const user = userEvent.setup();
    const pad = createMockPad({ id: "pad-0" });
    const scene = createMockScene({ pads: [pad] });
    useProjectStore.setState({ project: createMockProject({ scenes: [scene] }) });
    setupStore({ active: true, padIds: ["pad-0"] });
    render(<MultiFadePill />);
    await user.click(screen.getByRole("button", { name: /execute fade/i }));
    expect(executeFadeTap).toHaveBeenCalledTimes(1);
  });

  it("Execute Fade button is disabled when canExecute is false", () => {
    setupStore({ active: true, selectedCount: 0 });
    render(<MultiFadePill />);
    const executeButton = screen.getByRole("button", { name: /execute fade/i });
    expect(executeButton).toBeDisabled();
  });

  it("Execute Fade button is enabled when canExecute is true", () => {
    setupStore({ active: true, selectedCount: 1 });
    render(<MultiFadePill />);
    const executeButton = screen.getByRole("button", { name: /execute fade/i });
    expect(executeButton).toBeEnabled();
  });

  it("calls cancelMultiFade when cancel button is clicked", async () => {
    const user = userEvent.setup();
    setupStore({ active: true, selectedCount: 0 });
    const cancelSpy = vi.spyOn(useMultiFadeStore.getState(), "cancelMultiFade");
    render(<MultiFadePill />);
    await user.click(screen.getByRole("button", { name: /cancel multi-fade/i }));
    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });
});
