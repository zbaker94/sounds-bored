import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { PadLiveControlPopover } from "./PadLiveControlPopover";
import { createMockPad, createMockLayer } from "@/test/factories";
import { usePlaybackStore, initialPlaybackState } from "@/state/playbackStore";
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { useIsMd } from "@/hooks/useBreakpoint";

// Mock popover and drawer UI wrappers to avoid Radix portal issues
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  PopoverAnchor: () => null,
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="popover-content">{children}</div>
  ),
}));

vi.mock("@/components/ui/drawer", () => ({
  Drawer: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  DrawerContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DrawerHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DrawerTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/hooks/useBreakpoint", () => ({
  useIsMd: vi.fn().mockReturnValue(true), // desktop by default
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) =>
    asChild ? <>{children}</> : <span>{children}</span>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <span data-testid="tooltip-content">{children}</span>
  ),
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/audio/padPlayer", () => ({
  triggerPad: vi.fn().mockResolvedValue(undefined),
  stopPad: vi.fn(),
  fadePadWithLevels: vi.fn().mockResolvedValue(undefined),
  resolveFadeDuration: vi.fn().mockReturnValue(2000),
  triggerLayer: vi.fn().mockResolvedValue(undefined),
  stopLayerWithRamp: vi.fn(),
  setLayerVolume: vi.fn(),
  skipLayerForward: vi.fn(),
  skipLayerBack: vi.fn(),
}));

vi.mock("@/lib/audio/audioState", () => ({
  isPadActive: vi.fn().mockReturnValue(false),
  isLayerActive: vi.fn().mockReturnValue(false),
}));

// Import after mocks are set up
import { triggerPad, stopPad } from "@/lib/audio/padPlayer";

function renderPopover(padOverrides: Partial<Parameters<typeof createMockPad>[0]> = {}) {
  const layer = createMockLayer({ id: "layer-1" });
  const pad = createMockPad({ id: "pad-1", name: "Test Pad", layers: [layer], ...padOverrides });
  const anchorRef = { current: null };
  const onOpenChange = vi.fn();

  render(
    <PadLiveControlPopover
      pad={pad}
      open={true}
      onOpenChange={onOpenChange}
      anchorRef={anchorRef as React.RefObject<HTMLButtonElement | null>}
    />
  );
  return { pad, onOpenChange };
}

describe("PadLiveControlPopover", () => {
  beforeEach(() => {
    usePlaybackStore.setState({ ...initialPlaybackState });
    useMultiFadeStore.setState({
      active: false,
      originPadId: null,
      selectedPads: new Map(),
      reopenPadId: null,
    });
    vi.clearAllMocks();
    // Restore default mock implementations after clearAllMocks
    vi.mocked(triggerPad).mockResolvedValue(undefined);
    vi.mocked(stopPad).mockReturnValue(undefined);
  });

  it("renders pad name", () => {
    renderPopover({ name: "My Test Pad" });
    expect(screen.getByText("My Test Pad")).toBeInTheDocument();
  });

  it("shows Start button when pad is not playing", () => {
    renderPopover();
    expect(screen.getByRole("button", { name: /start/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^stop$/i })).not.toBeInTheDocument();
  });

  it("shows Stop button when pad is playing", () => {
    usePlaybackStore.setState({
      ...initialPlaybackState,
      playingPadIds: new Set(["pad-1"]),
    });
    renderPopover();
    expect(screen.getByRole("button", { name: /^stop$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start/i })).not.toBeInTheDocument();
  });

  it("clicking Start button calls triggerPad", async () => {
    renderPopover();
    const startButton = screen.getByRole("button", { name: /start/i });
    await userEvent.click(startButton);
    expect(triggerPad).toHaveBeenCalledTimes(1);
    expect(triggerPad).toHaveBeenCalledWith(expect.objectContaining({ id: "pad-1" }));
  });

  it("clicking Stop button calls stopPad", async () => {
    usePlaybackStore.setState({
      ...initialPlaybackState,
      playingPadIds: new Set(["pad-1"]),
    });
    renderPopover();
    const stopButton = screen.getByRole("button", { name: /^stop$/i });
    await userEvent.click(stopButton);
    expect(stopPad).toHaveBeenCalledTimes(1);
    expect(stopPad).toHaveBeenCalledWith(expect.objectContaining({ id: "pad-1" }));
  });

  it("Fade button is rendered", () => {
    renderPopover();
    // When not playing, shows "Fade In"; when playing shows "Fade Out"
    const fadeButton = screen.getByRole("button", { name: /fade (in|out)/i });
    expect(fadeButton).toBeInTheDocument();
  });

  it("shows Fade In button when pad is not playing", () => {
    renderPopover();
    expect(screen.getByRole("button", { name: /fade in/i })).toBeInTheDocument();
  });

  it("shows Fade Out button when pad is playing", () => {
    usePlaybackStore.setState({
      ...initialPlaybackState,
      playingPadIds: new Set(["pad-1"]),
    });
    renderPopover();
    expect(screen.getByRole("button", { name: /fade out/i })).toBeInTheDocument();
  });

  it("fadeLevels sync: right thumb updates to current pad volume when pad starts playing", () => {
    // Initially not playing, render with default fadeLevels [0, 100]
    renderPopover();

    // Transition to playing state with a specific padVolume
    act(() => {
      usePlaybackStore.setState({
        ...initialPlaybackState,
        playingPadIds: new Set(["pad-1"]),
        padVolumes: { "pad-1": 0.75 },
      });
    });

    // The "start (current)" label should appear when playing
    expect(screen.getByText("start (current)")).toBeInTheDocument();

    // The fade slider has 2 thumbs; the layer slider has 1 — 3 total.
    // The fade slider thumbs are the first two (rendered before the layer rows).
    const sliderThumbs = document.querySelectorAll('[role="slider"]');
    expect(sliderThumbs.length).toBeGreaterThanOrEqual(2);
    // The second fade-slider thumb (index 1 = "start current") should reflect padVolume 0.75 → 75%
    expect(sliderThumbs[1]).toHaveAttribute("aria-valuenow", "75");
  });

  it("clicking 'Multi-fade with others...' calls enterMultiFade and closes popover", async () => {
    const mockEnterMultiFade = vi.fn();
    useMultiFadeStore.setState({
      active: false,
      originPadId: null,
      selectedPads: new Map(),
      reopenPadId: null,
      enterMultiFade: mockEnterMultiFade,
    } as any);

    const { onOpenChange } = renderPopover();
    const multiFadeBtn = screen.getByRole("button", { name: /multi-fade with others/i });
    await userEvent.click(multiFadeBtn);

    expect(mockEnterMultiFade).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  describe("mobile (drawer) path", () => {
    it("renders a Drawer instead of Popover on mobile", () => {
      vi.mocked(useIsMd).mockReturnValue(false);
      renderPopover({ name: "Mobile Test Pad" });

      // Verify pad name is visible in drawer (at least one instance)
      expect(screen.getAllByText("Mobile Test Pad").length).toBeGreaterThan(0);

      // Verify Start/Stop button is visible (pad controls should render)
      expect(screen.getByRole("button", { name: /start/i })).toBeInTheDocument();

      // Verify popover-content testid is NOT present (drawer should render instead)
      expect(screen.queryByTestId("popover-content")).not.toBeInTheDocument();
    });
  });
});
