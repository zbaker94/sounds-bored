import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { PadLiveControlPopover, getSoundsForLayer } from "./PadLiveControlPopover";
import { createMockPad, createMockLayer, createMockSound, createMockSoundInstance, createMockTag, createMockSet } from "@/test/factories";
import { usePlaybackStore, initialPlaybackState } from "@/state/playbackStore";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { useIsMd } from "@/hooks/useBreakpoint";
import type { Layer } from "@/lib/schemas";

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
  getLayerChain: vi.fn().mockReturnValue(undefined),
  getLayerPlayOrder: vi.fn().mockReturnValue(undefined),
}));

// Import after mocks are set up
import { triggerPad, stopPad } from "@/lib/audio/padPlayer";
import { isLayerActive, getLayerChain, getLayerPlayOrder } from "@/lib/audio/audioState";

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

function renderPopoverWithSounds(
  soundNames: string[],
  arrangementOverride?: Layer["arrangement"]
) {
  const sounds = soundNames.map((name, i) =>
    createMockSound({ id: `sound-${i}`, name })
  );
  useLibraryStore.setState({
    ...initialLibraryState,
    sounds,
  });
  const instances = sounds.map((s) =>
    createMockSoundInstance({ soundId: s.id })
  );
  const layer = createMockLayer({
    id: "layer-1",
    selection: { type: "assigned", instances },
    arrangement: arrangementOverride ?? "simultaneous",
  });
  const pad = createMockPad({ id: "pad-1", layers: [layer] });
  const anchorRef = { current: null };
  render(
    <PadLiveControlPopover
      pad={pad}
      sceneId="scene-1"
      open={true}
      onOpenChange={vi.fn()}
      anchorRef={anchorRef as React.RefObject<HTMLButtonElement | null>}
    />
  );
  return { sounds, layer, pad };
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

  it("clicking 'Synchronized Fades' calls enterMultiFade and closes popover", async () => {
    const mockEnterMultiFade = vi.fn();
    useMultiFadeStore.setState({
      active: false,
      originPadId: null,
      selectedPads: new Map(),
      reopenPadId: null,
      enterMultiFade: mockEnterMultiFade,
    } as any);

    const { onOpenChange } = renderPopover();
    const multiFadeBtn = screen.getByRole("button", { name: /Synchronized Fades/i });
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

describe("LayerRow sound display", () => {
  it("shows all sound names joined by ' · ' when layer has multiple assigned sounds", () => {
    renderPopoverWithSounds(["Kick", "Snare", "Hi-hat"]);
    expect(screen.getByText("Kick · Snare · Hi-hat")).toBeInTheDocument();
  });

  it("shows a single sound name without separator", () => {
    renderPopoverWithSounds(["Kick"]);
    expect(screen.getByText("Kick")).toBeInTheDocument();
  });

  it("does not render the sound display row when layer has no sounds", () => {
    renderPopoverWithSounds([]);
    const displayRows = document.querySelectorAll("[data-testid='layer-sound-display']");
    expect(displayRows).toHaveLength(0);
  });

  describe("currently-playing sound for sequential/shuffled layers", () => {
    it("shows only the current sound name when layer is active and sequential", async () => {
      const sounds = [
        createMockSound({ id: "s1", name: "Kick" }),
        createMockSound({ id: "s2", name: "Snare" }),
        createMockSound({ id: "s3", name: "Hi-hat" }),
      ];
      useLibraryStore.setState({ ...initialLibraryState, sounds });
      const instances = sounds.map((s) => createMockSoundInstance({ soundId: s.id }));
      const layer = createMockLayer({
        id: "layer-1",
        selection: { type: "assigned", instances },
        arrangement: "sequential",
      });
      const pad = createMockPad({ id: "pad-1", layers: [layer] });

      // Layer is active and playing the second sound (chain has 1 remaining)
      vi.mocked(isLayerActive).mockReturnValue(true);
      vi.mocked(getLayerPlayOrder).mockReturnValue(sounds);
      vi.mocked(getLayerChain).mockReturnValue([sounds[2]]); // 1 remaining → current is index 1 = "Snare"
      usePlaybackStore.setState({
        ...initialPlaybackState,
        playingPadIds: new Set(["pad-1"]),
      });

      render(
        <PadLiveControlPopover
          pad={pad}
          sceneId="scene-1"
          open={true}
          onOpenChange={vi.fn()}
          anchorRef={{ current: null } as React.RefObject<HTMLButtonElement | null>}
        />
      );

      // RAF fires asynchronously — wait for the poll to update state
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(screen.getByText("Snare")).toBeInTheDocument();
      // Full list text should not be visible
      expect(screen.queryByText("Kick · Snare · Hi-hat")).not.toBeInTheDocument();
    });

    it("shows all sounds when layer is simultaneous even if active", async () => {
      const sounds = [
        createMockSound({ id: "s1", name: "Kick" }),
        createMockSound({ id: "s2", name: "Snare" }),
      ];
      useLibraryStore.setState({ ...initialLibraryState, sounds });
      const instances = sounds.map((s) => createMockSoundInstance({ soundId: s.id }));
      const layer = createMockLayer({
        id: "layer-1",
        selection: { type: "assigned", instances },
        arrangement: "simultaneous",
      });
      const pad = createMockPad({ id: "pad-1", layers: [layer] });

      vi.mocked(isLayerActive).mockReturnValue(true);
      usePlaybackStore.setState({ ...initialPlaybackState, playingPadIds: new Set(["pad-1"]) });

      render(
        <PadLiveControlPopover
          pad={pad}
          sceneId="scene-1"
          open={true}
          onOpenChange={vi.fn()}
          anchorRef={{ current: null } as React.RefObject<HTMLButtonElement | null>}
        />
      );

      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

      expect(screen.getByText("Kick · Snare")).toBeInTheDocument();
    });
  });

  it("shows sounds from a tag selection", () => {
    const s1 = createMockSound({ id: "s1", name: "Snare", tags: ["tag-drums"] });
    const s2 = createMockSound({ id: "s2", name: "Kick", tags: ["tag-drums"] });
    useLibraryStore.setState({ ...initialLibraryState, sounds: [s1, s2] });
    const layer = createMockLayer({
      id: "layer-1",
      selection: { type: "tag", tagIds: ["tag-drums"], matchMode: "any", defaultVolume: 100 },
    });
    const pad = createMockPad({ id: "pad-1", layers: [layer] });
    render(
      <PadLiveControlPopover
        pad={pad}
        sceneId="scene-1"
        open={true}
        onOpenChange={vi.fn()}
        anchorRef={{ current: null } as React.RefObject<HTMLButtonElement | null>}
      />
    );
    expect(screen.getByText("Snare · Kick")).toBeInTheDocument();
  });

  describe("list icon and popover", () => {
    it("does not show the list icon when layer has only one sound", () => {
      renderPopoverWithSounds(["Kick"]);
      expect(screen.queryByRole("button", { name: /show sound list/i })).not.toBeInTheDocument();
    });

    it("shows the list icon when layer has multiple sounds", () => {
      renderPopoverWithSounds(["Kick", "Snare"]);
      expect(screen.getByRole("button", { name: /show sound list/i })).toBeInTheDocument();
    });

    it("does not show the list icon when layer has no sounds", () => {
      renderPopoverWithSounds([]);
      expect(screen.queryByRole("button", { name: /show sound list/i })).not.toBeInTheDocument();
    });

    it("clicking list icon opens a popover listing all sounds", async () => {
      renderPopoverWithSounds(["Kick", "Snare", "Hi-hat"]);
      const listBtn = screen.getByRole("button", { name: /show sound list/i });
      await userEvent.click(listBtn);

      expect(screen.getByText("1. Kick")).toBeInTheDocument();
      expect(screen.getByText("2. Snare")).toBeInTheDocument();
      expect(screen.getByText("3. Hi-hat")).toBeInTheDocument();
    });

    it("assigned selection shows 'Sounds' as popover title", async () => {
      renderPopoverWithSounds(["Kick", "Snare"]);
      await userEvent.click(screen.getByRole("button", { name: /show sound list/i }));
      expect(screen.getByText("Sounds")).toBeInTheDocument();
    });

    it("tag selection shows 'Tag: <name>' as popover title", async () => {
      const tag = createMockTag({ id: "tag-1", name: "Drums" });
      const s1 = createMockSound({ id: "s1", name: "Kick", tags: ["tag-1"] });
      const s2 = createMockSound({ id: "s2", name: "Snare", tags: ["tag-1"] });
      useLibraryStore.setState({ ...initialLibraryState, sounds: [s1, s2], tags: [tag] });
      const layer = createMockLayer({
        id: "layer-1",
        selection: { type: "tag", tagIds: ["tag-1"], matchMode: "any", defaultVolume: 100 },
      });
      const pad = createMockPad({ id: "pad-1", layers: [layer] });
      render(
        <PadLiveControlPopover
          pad={pad}
          sceneId="scene-1"
          open={true}
          onOpenChange={vi.fn()}
          anchorRef={{ current: null } as React.RefObject<HTMLButtonElement | null>}
        />
      );
      await userEvent.click(screen.getByRole("button", { name: /show sound list/i }));
      expect(screen.getByText("Tag: Drums")).toBeInTheDocument();
    });

    it("set selection shows 'Set: <name>' as popover title", async () => {
      const set = createMockSet({ id: "set-1", name: "My Drums" });
      const s1 = createMockSound({ id: "s1", name: "Kick", sets: ["set-1"] });
      const s2 = createMockSound({ id: "s2", name: "Snare", sets: ["set-1"] });
      useLibraryStore.setState({ ...initialLibraryState, sounds: [s1, s2], sets: [set] });
      const layer = createMockLayer({
        id: "layer-1",
        selection: { type: "set", setId: "set-1", defaultVolume: 100 },
      });
      const pad = createMockPad({ id: "pad-1", layers: [layer] });
      render(
        <PadLiveControlPopover
          pad={pad}
          sceneId="scene-1"
          open={true}
          onOpenChange={vi.fn()}
          anchorRef={{ current: null } as React.RefObject<HTMLButtonElement | null>}
        />
      );
      await userEvent.click(screen.getByRole("button", { name: /show sound list/i }));
      expect(screen.getByText("Set: My Drums")).toBeInTheDocument();
    });

    it("currently-playing sound is bold in the list popover", async () => {
      const sounds = [
        createMockSound({ id: "s1", name: "Kick" }),
        createMockSound({ id: "s2", name: "Snare" }),
        createMockSound({ id: "s3", name: "Hi-hat" }),
      ];
      useLibraryStore.setState({ ...initialLibraryState, sounds });
      const instances = sounds.map((s) => createMockSoundInstance({ soundId: s.id }));
      const layer = createMockLayer({
        id: "layer-1",
        selection: { type: "assigned", instances },
        arrangement: "sequential",
      });
      const pad = createMockPad({ id: "pad-1", layers: [layer] });

      // "Snare" is currently playing (index 1 of 3, chain has 1 remaining)
      vi.mocked(isLayerActive).mockReturnValue(true);
      vi.mocked(getLayerPlayOrder).mockReturnValue(sounds);
      vi.mocked(getLayerChain).mockReturnValue([sounds[2]]);
      usePlaybackStore.setState({ ...initialPlaybackState, playingPadIds: new Set(["pad-1"]) });

      render(
        <PadLiveControlPopover
          pad={pad}
          sceneId="scene-1"
          open={true}
          onOpenChange={vi.fn()}
          anchorRef={{ current: null } as React.RefObject<HTMLButtonElement | null>}
        />
      );

      // Wait for RAF to set currentSoundId
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

      // Open the list popover
      await userEvent.click(screen.getByRole("button", { name: /show sound list/i }));

      // The currently-playing "Snare" item should have the bold class
      const snareItem = screen.getByText("2. Snare").closest("li");
      expect(snareItem).toHaveClass("font-semibold");

      // Other items should not be bold
      const kickItem = screen.getByText("1. Kick").closest("li");
      expect(kickItem).not.toHaveClass("font-semibold");
    });

    it("missing sounds are shown italic in the list popover", async () => {
      const s1 = createMockSound({ id: "s1", name: "Kick" });
      const s2 = createMockSound({ id: "s2", name: "Snare" });
      useLibraryStore.setState({
        ...initialLibraryState,
        sounds: [s1, s2],
        missingSoundIds: new globalThis.Set(["s2"]),
      });
      const instances = [s1, s2].map((s) => createMockSoundInstance({ soundId: s.id }));
      const layer = createMockLayer({
        id: "layer-1",
        selection: { type: "assigned", instances },
      });
      const pad = createMockPad({ id: "pad-1", layers: [layer] });
      render(
        <PadLiveControlPopover
          pad={pad}
          sceneId="scene-1"
          open={true}
          onOpenChange={vi.fn()}
          anchorRef={{ current: null } as React.RefObject<HTMLButtonElement | null>}
        />
      );

      await userEvent.click(screen.getByRole("button", { name: /show sound list/i }));

      const snareItem = screen.getByText("2. Snare").closest("li");
      expect(snareItem).toHaveClass("italic");

      const kickItem = screen.getByText("1. Kick").closest("li");
      expect(kickItem).not.toHaveClass("italic");
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
