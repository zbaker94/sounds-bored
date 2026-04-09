import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FadeToolbar } from "./FadeToolbar";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { UseFadeModeReturn } from "@/hooks/useFadeMode";

function renderWithTooltip(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

function makeFadeMode(overrides: Partial<UseFadeModeReturn> = {}): UseFadeModeReturn {
  return {
    mode: null,
    hasPlayingPads: false,
    canExecute: false,
    statusLabel: null,
    fadeLevels: [0, 100],
    setFadeLevels: vi.fn(),
    getPadFadeVisual: vi.fn().mockReturnValue(null),
    enterFade: vi.fn(),
    enterCrossfade: vi.fn(),
    onPadTap: vi.fn(),
    execute: vi.fn(),
    cancel: vi.fn(),
    ...overrides,
  };
}

describe("FadeToolbar", () => {
  it("renders Fade and Crossfade buttons", () => {
    render(<FadeToolbar fadeMode={makeFadeMode()} />);
    expect(screen.getByRole("button", { name: "Fade pad" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Crossfade pads" })).toBeInTheDocument();
  });

  it("calls enterFade when Fade button is clicked and mode is null", async () => {
    const enterFade = vi.fn();
    render(<FadeToolbar fadeMode={makeFadeMode({ enterFade })} />);
    await userEvent.click(screen.getByRole("button", { name: "Fade pad" }));
    expect(enterFade).toHaveBeenCalledOnce();
  });

  it("calls cancel when Fade button is clicked and mode is 'fade'", async () => {
    const cancel = vi.fn();
    renderWithTooltip(
      <FadeToolbar
        fadeMode={makeFadeMode({ mode: "fade", cancel })}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Fade pad" }));
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("Crossfade button is disabled when mode is null and hasPlayingPads is false", () => {
    render(
      <FadeToolbar
        fadeMode={makeFadeMode({ mode: null, hasPlayingPads: false })}
      />,
    );
    expect(screen.getByRole("button", { name: "Crossfade pads" })).toBeDisabled();
  });

  it("calls enterCrossfade when Crossfade button is clicked and mode is null with playing pads", async () => {
    const enterCrossfade = vi.fn();
    render(
      <FadeToolbar
        fadeMode={makeFadeMode({ mode: null, hasPlayingPads: true, enterCrossfade })}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Crossfade pads" }));
    expect(enterCrossfade).toHaveBeenCalledOnce();
  });

  it("calls execute when Crossfade button is clicked in crossfade mode and canExecute is true", async () => {
    const execute = vi.fn();
    render(
      <FadeToolbar
        fadeMode={makeFadeMode({ mode: "crossfade", canExecute: true, execute })}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Crossfade pads" }));
    expect(execute).toHaveBeenCalledOnce();
  });

  it("calls cancel when Crossfade button is clicked in crossfade mode and canExecute is false", async () => {
    const cancel = vi.fn();
    render(
      <FadeToolbar
        fadeMode={makeFadeMode({ mode: "crossfade", canExecute: false, cancel })}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Crossfade pads" }));
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("renders status label when statusLabel is non-null", () => {
    render(
      <FadeToolbar
        fadeMode={makeFadeMode({ statusLabel: "Select pad to fade out" })}
      />,
    );
    expect(screen.getByText("Select pad to fade out")).toBeInTheDocument();
  });

  it("does not render status label when statusLabel is null", () => {
    render(
      <FadeToolbar fadeMode={makeFadeMode({ statusLabel: null })} />,
    );
    expect(screen.queryByText(/select pad/i)).not.toBeInTheDocument();
  });

  it("Crossfade button is enabled when mode is null and hasPlayingPads is true", () => {
    render(
      <FadeToolbar
        fadeMode={makeFadeMode({ mode: null, hasPlayingPads: true })}
      />,
    );
    expect(screen.getByRole("button", { name: "Crossfade pads" })).toBeEnabled();
  });

  it("Crossfade button is enabled when mode is 'crossfade' regardless of hasPlayingPads", () => {
    render(
      <FadeToolbar
        fadeMode={makeFadeMode({ mode: "crossfade", hasPlayingPads: false })}
      />,
    );
    expect(screen.getByRole("button", { name: "Crossfade pads" })).toBeEnabled();
  });

  it("Fade button uses default variant when mode is 'fade'", () => {
    renderWithTooltip(
      <FadeToolbar fadeMode={makeFadeMode({ mode: "fade" })} />,
    );
    expect(screen.getByRole("button", { name: "Fade pad" })).toHaveAttribute(
      "data-variant",
      "default",
    );
  });

  it("Fade button uses ghost variant when mode is not 'fade'", () => {
    render(
      <FadeToolbar fadeMode={makeFadeMode({ mode: null })} />,
    );
    expect(screen.getByRole("button", { name: "Fade pad" })).toHaveAttribute(
      "data-variant",
      "ghost",
    );
  });
});

describe("FadeToolbar — fade volume slider", () => {
  it("shows two-handle slider instead of Crossfade button when mode is 'fade'", () => {
    renderWithTooltip(
      <FadeToolbar
        fadeMode={{ ...makeFadeMode({ mode: "fade" }), fadeLevels: [0, 100] as [number, number], setFadeLevels: vi.fn() } as any}
      />,
    );
    expect(screen.queryByRole("button", { name: "Crossfade pads" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("slider")).toHaveLength(2);
  });

  it("does not show slider when mode is null", () => {
    render(
      <FadeToolbar
        fadeMode={{ ...makeFadeMode({ mode: null }), fadeLevels: [0, 100] as [number, number], setFadeLevels: vi.fn() } as any}
      />,
    );
    expect(screen.getByRole("button", { name: "Crossfade pads" })).toBeInTheDocument();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });

  it("does not show slider when mode is 'crossfade'", () => {
    render(
      <FadeToolbar
        fadeMode={{ ...makeFadeMode({ mode: "crossfade" }), fadeLevels: [0, 100] as [number, number], setFadeLevels: vi.fn() } as any}
      />,
    );
    expect(screen.getByRole("button", { name: "Crossfade pads" })).toBeInTheDocument();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });
});
