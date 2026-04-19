import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { PillRow } from "./PillRow";
import type { PillRowProps } from "./PillRow";

// Track open state and onOpenChange per Popover instance via a context, so PopoverTrigger
// can toggle open state on click and PopoverContent can be hidden when closed — mirroring
// real Radix behavior closely enough for testing.
type PopoverCtx = { open: boolean; onOpenChange: (o: boolean) => void };
const PopoverOpenContext = React.createContext<PopoverCtx>({ open: false, onOpenChange: () => {} });

vi.mock("@/components/ui/popover", () => ({
  Popover: ({
    children,
    open,
    onOpenChange,
  }: {
    children: React.ReactNode;
    open: boolean;
    onOpenChange: (o: boolean) => void;
  }) => (
    <PopoverOpenContext.Provider value={{ open, onOpenChange }}>
      <div data-popover-open={open ? "true" : "false"}>{children}</div>
    </PopoverOpenContext.Provider>
  ),
  PopoverTrigger: ({ children, onClick, ...props }: React.ComponentProps<"button">) => {
    const { open, onOpenChange } = React.useContext(PopoverOpenContext);
    return (
      <button
        type="button"
        onClick={(e) => {
          onClick?.(e);
          onOpenChange(!open);
        }}
        {...props}
      >
        {children}
      </button>
    );
  },
  PopoverContent: ({ children, ...props }: React.ComponentProps<"div">) => {
    const { open } = React.useContext(PopoverOpenContext);
    if (!open) return null;
    return <div {...props}>{children}</div>;
  },
}));

function renderRow(overrides: Partial<PillRowProps> = {}) {
  const onArrangementChange = vi.fn();
  const onPlaybackModeChange = vi.fn();
  const onRetriggerModeChange = vi.fn();
  render(
    <PillRow
      layerId="layer-1"
      arrangement={undefined}
      playbackMode={undefined}
      retriggerMode={undefined}
      onArrangementChange={onArrangementChange}
      onPlaybackModeChange={onPlaybackModeChange}
      onRetriggerModeChange={onRetriggerModeChange}
      {...overrides}
    />,
  );
  return { onArrangementChange, onPlaybackModeChange, onRetriggerModeChange };
}

describe("PillRow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders 3 pill triggers", () => {
    renderRow();
    expect(screen.getByRole("button", { name: "Arrangement" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Playback" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retrigger" })).toBeInTheDocument();
  });

  it("unset pills show the category label", () => {
    renderRow();
    const arrangement = screen.getByRole("button", { name: "Arrangement" });
    expect(arrangement).toHaveAttribute("data-pill-set", "false");
    expect(arrangement).toHaveTextContent("Arrangement");
  });

  it("set pill shows the current value", () => {
    renderRow({ arrangement: "sequential" });
    const arrangement = screen.getByRole("button", { name: "Arrangement" });
    expect(arrangement).toHaveAttribute("data-pill-set", "true");
    expect(arrangement).toHaveTextContent("sequential");
  });

  it("set playback pill shows the current value", () => {
    renderRow({ playbackMode: "loop" });
    const playback = screen.getByRole("button", { name: "Playback" });
    expect(playback).toHaveAttribute("data-pill-set", "true");
    expect(playback).toHaveTextContent("loop");
  });

  it("set retrigger pill shows the current value", () => {
    renderRow({ retriggerMode: "continue" });
    const retrigger = screen.getByRole("button", { name: "Retrigger" });
    expect(retrigger).toHaveAttribute("data-pill-set", "true");
    expect(retrigger).toHaveTextContent("continue");
  });

  it("popover content is NOT visible initially (closed by default)", () => {
    renderRow();
    expect(screen.queryByRole("listbox", { name: /arrangement options/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("listbox", { name: /playback options/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("listbox", { name: /retrigger options/i })).not.toBeInTheDocument();
  });

  it("clicking the Arrangement trigger opens its popover", async () => {
    renderRow();
    expect(screen.queryByRole("listbox", { name: /arrangement options/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Arrangement" }));
    expect(screen.getByRole("listbox", { name: /arrangement options/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /simultaneous/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /sequential/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /shuffled/i })).toBeInTheDocument();
  });

  it("clicking the Playback trigger opens its popover", async () => {
    renderRow();
    expect(screen.queryByRole("listbox", { name: /playback options/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Playback" }));
    expect(screen.getByRole("listbox", { name: /playback options/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /one-shot/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /hold/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /loop/i })).toBeInTheDocument();
  });

  it("clicking the Retrigger trigger opens its popover", async () => {
    renderRow();
    expect(screen.queryByRole("listbox", { name: /retrigger options/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retrigger" }));
    expect(screen.getByRole("listbox", { name: /retrigger options/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /^restart/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /^continue/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /^stop/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /^next/i })).toBeInTheDocument();
  });

  it("shows descriptions for arrangement options when popover is open", async () => {
    renderRow();
    await userEvent.click(screen.getByRole("button", { name: "Arrangement" }));
    expect(screen.getByText("All sounds play at once")).toBeInTheDocument();
    expect(screen.getByText("Sounds play in order, one per trigger")).toBeInTheDocument();
    expect(screen.getByText("Sounds play in random order, one per trigger")).toBeInTheDocument();
  });

  it("marks the currently selected option as aria-selected when popover is open", async () => {
    renderRow({ arrangement: "sequential" });
    await userEvent.click(screen.getByRole("button", { name: "Arrangement" }));
    const selected = screen.getByRole("option", { name: /sequential/i });
    expect(selected).toHaveAttribute("aria-selected", "true");
    const other = screen.getByRole("option", { name: /shuffled/i });
    expect(other).toHaveAttribute("aria-selected", "false");
  });

  it.each([
    ["simultaneous", "Arrangement", "onArrangementChange"],
    ["sequential", "Arrangement", "onArrangementChange"],
    ["shuffled", "Arrangement", "onArrangementChange"],
    ["one-shot", "Playback", "onPlaybackModeChange"],
    ["hold", "Playback", "onPlaybackModeChange"],
    ["loop", "Playback", "onPlaybackModeChange"],
    ["restart", "Retrigger", "onRetriggerModeChange"],
    ["continue", "Retrigger", "onRetriggerModeChange"],
    ["stop", "Retrigger", "onRetriggerModeChange"],
    ["next", "Retrigger", "onRetriggerModeChange"],
  ] as const)(
    "selecting %s in the %s popover invokes %s and closes the popover",
    async (value, category, callbackKey) => {
      const callbacks = renderRow();
      const cb = callbacks[callbackKey] as ReturnType<typeof vi.fn>;
      await userEvent.click(screen.getByRole("button", { name: category }));
      const listboxName = new RegExp(`${category} options`, "i");
      expect(screen.getByRole("listbox", { name: listboxName })).toBeInTheDocument();
      // Match option by its label prefix — accessible name includes label + description text
      const optionMatcher = new RegExp(`^${value}`, "i");
      await userEvent.click(screen.getByRole("option", { name: optionMatcher }));
      expect(cb).toHaveBeenCalledWith(value);
      // After selection, popover should close
      expect(screen.queryByRole("listbox", { name: listboxName })).not.toBeInTheDocument();
    },
  );
});
