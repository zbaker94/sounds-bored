import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { PadLiveControlPopover } from "./PadLiveControlPopover";
import { getSoundsForLayer } from "./PadControlContent";
import { createMockPad, createMockLayer, createMockSound, createMockSoundInstance } from "@/test/factories";
import { usePlaybackStore, initialPlaybackState } from "@/state/playbackStore";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
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
  commitLayerVolume: vi.fn(),
  skipLayerForward: vi.fn(),
  skipLayerBack: vi.fn(),
}));

vi.mock("@/lib/audio/audioState", () => ({
  isPadActive: vi.fn().mockReturnValue(false),
  isLayerActive: vi.fn().mockReturnValue(false),
  getLayerChain: vi.fn().mockReturnValue(undefined),
  getLayerPlayOrder: vi.fn().mockReturnValue(undefined),
}));

vi.mock("./PadControlContent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./PadControlContent")>();
  return {
    ...actual,
    PadControlContent: ({ pad, onClose }: { pad: { name: string }; onClose: () => void }) => (
      <div data-testid="pad-control-content">
        <span>{pad.name}</span>
        <button type="button" onClick={onClose}>Close</button>
      </div>
    ),
  };
});

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
      sceneId="scene-1"
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
    useLibraryStore.setState({ ...initialLibraryState });
    useMultiFadeStore.setState({
      active: false,
      originPadId: null,
      selectedPads: new Map(),
      reopenPadId: null,
    });
    vi.clearAllMocks();
    vi.mocked(triggerPad).mockResolvedValue(undefined);
    vi.mocked(stopPad).mockReturnValue(undefined);
  });

  it("renders PadControlContent when open (desktop)", () => {
    renderPopover({ name: "My Test Pad" });
    expect(screen.getByTestId("pad-control-content")).toBeInTheDocument();
    expect(screen.getByText("My Test Pad")).toBeInTheDocument();
  });

  it("passes onClose to PadControlContent that calls onOpenChange(false)", async () => {
    const { onOpenChange } = renderPopover();
    const closeBtn = screen.getByRole("button", { name: /close/i });
    await userEvent.click(closeBtn);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  describe("mobile (drawer) path", () => {
    it("renders a Drawer instead of Popover on mobile", () => {
      vi.mocked(useIsMd).mockReturnValue(false);
      renderPopover({ name: "Mobile Test Pad" });

      // PadControlContent mock renders the name
      expect(screen.getAllByText("Mobile Test Pad").length).toBeGreaterThanOrEqual(1);

      // Verify popover-content is NOT present (drawer renders instead)
      expect(screen.queryByTestId("popover-content")).not.toBeInTheDocument();

      // Verify PadControlContent rendered inside drawer
      expect(screen.getByTestId("pad-control-content")).toBeInTheDocument();
    });
  });
});

describe("getSoundsForLayer", () => {
  describe("assigned selection", () => {
    it("returns sounds matching instance soundIds in instance order", () => {
      const s1 = createMockSound({ id: "s1", name: "Kick" });
      const s2 = createMockSound({ id: "s2", name: "Snare" });
      const s3 = createMockSound({ id: "s3", name: "Hi-hat" });
      const inst1 = createMockSoundInstance({ soundId: "s2" });
      const inst2 = createMockSoundInstance({ soundId: "s1" });
      const layer = createMockLayer({
        selection: { type: "assigned", instances: [inst1, inst2] },
      });
      expect(getSoundsForLayer(layer, [s1, s2, s3])).toEqual([s2, s1]);
    });

    it("excludes instances with no matching library sound", () => {
      const s1 = createMockSound({ id: "s1", name: "Kick" });
      const inst = createMockSoundInstance({ soundId: "missing-id" });
      const layer = createMockLayer({
        selection: { type: "assigned", instances: [inst] },
      });
      expect(getSoundsForLayer(layer, [s1])).toEqual([]);
    });

    it("returns empty array when no instances", () => {
      const layer = createMockLayer({ selection: { type: "assigned", instances: [] } });
      expect(getSoundsForLayer(layer, [])).toEqual([]);
    });
  });

  describe("tag selection", () => {
    it("returns sounds that have any of the specified tag IDs (matchMode: any)", () => {
      const s1 = createMockSound({ id: "s1", name: "Kick", tags: ["tag-a"] });
      const s2 = createMockSound({ id: "s2", name: "Snare", tags: ["tag-b"] });
      const s3 = createMockSound({ id: "s3", name: "Hi-hat", tags: [] });
      const layer = createMockLayer({
        selection: { type: "tag", tagIds: ["tag-a"], matchMode: "any", defaultVolume: 100 },
      });
      expect(getSoundsForLayer(layer, [s1, s2, s3])).toEqual([s1]);
    });

    it("returns only sounds that have ALL tag IDs (matchMode: all)", () => {
      const s1 = createMockSound({ id: "s1", name: "Kick", tags: ["tag-a", "tag-b"] });
      const s2 = createMockSound({ id: "s2", name: "Snare", tags: ["tag-a"] });
      const layer = createMockLayer({
        selection: { type: "tag", tagIds: ["tag-a", "tag-b"], matchMode: "all", defaultVolume: 100 },
      });
      expect(getSoundsForLayer(layer, [s1, s2])).toEqual([s1]);
    });

    it("returns empty array when no sounds match", () => {
      const s1 = createMockSound({ id: "s1", tags: ["tag-z"] });
      const layer = createMockLayer({
        selection: { type: "tag", tagIds: ["tag-a"], matchMode: "any", defaultVolume: 100 },
      });
      expect(getSoundsForLayer(layer, [s1])).toEqual([]);
    });
  });

  describe("set selection", () => {
    it("returns sounds that belong to the specified set", () => {
      const s1 = createMockSound({ id: "s1", name: "Kick", sets: ["set-1"] });
      const s2 = createMockSound({ id: "s2", name: "Snare", sets: ["set-2"] });
      const s3 = createMockSound({ id: "s3", name: "Hi-hat", sets: [] });
      const layer = createMockLayer({
        selection: { type: "set", setId: "set-1", defaultVolume: 100 },
      });
      expect(getSoundsForLayer(layer, [s1, s2, s3])).toEqual([s1]);
    });

    it("returns empty array when no sounds match the set", () => {
      const s1 = createMockSound({ id: "s1", sets: [] });
      const layer = createMockLayer({
        selection: { type: "set", setId: "set-1", defaultVolume: 100 },
      });
      expect(getSoundsForLayer(layer, [s1])).toEqual([]);
    });
  });
});

