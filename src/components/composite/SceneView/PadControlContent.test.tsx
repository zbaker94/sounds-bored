import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { PadControlContent, getSoundsForLayer } from "./PadControlContent";
import { createMockPad, createMockLayer, createMockHistoryEntry, createMockProject, createMockScene, createMockSound, createMockSoundInstance } from "@/test/factories";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { usePlaybackStore, initialPlaybackState } from "@/state/playbackStore";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  PopoverAnchor: () => null,
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="popover-content">{children}</div>
  ),
}));

vi.mock("@/lib/audio/padPlayer", () => ({
  triggerPad: vi.fn().mockResolvedValue(undefined),
  stopPad: vi.fn(),
  fadePadWithLevels: vi.fn().mockResolvedValue(undefined),
  triggerLayer: vi.fn().mockResolvedValue(undefined),
  stopLayerWithRamp: vi.fn(),
  setLayerVolume: vi.fn(),
  commitLayerVolume: vi.fn(),
  skipLayerForward: vi.fn(),
  skipLayerBack: vi.fn(),
  setPadVolume: vi.fn(),
}));

vi.mock("@/lib/audio/audioState", () => ({
  isPadActive: vi.fn().mockReturnValue(false),
  getLayerChain: vi.fn().mockReturnValue(undefined),
  getLayerPlayOrder: vi.fn().mockReturnValue(undefined),
}));

// Import after mocks are set up
import { stopPad } from "@/lib/audio/padPlayer";

function loadPadInStore(padOverrides = {}) {
  const layer = createMockLayer({ id: "layer-1" });
  const pad = createMockPad({ id: "pad-1", name: "Kick", layers: [layer], ...padOverrides });
  const scene = createMockScene({ id: "scene-1", pads: [pad] });
  const entry = createMockHistoryEntry();
  useProjectStore.getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);
  return pad;
}

function renderContent(
  padOverrides = {},
  onEditClick = vi.fn(),
  onClose = vi.fn(),
  context: "popover" | "backface" = "popover"
) {
  const pad = loadPadInStore(padOverrides);
  render(
    <TooltipProvider>
      <PadControlContent
        pad={pad}
        sceneId="scene-1"
        onClose={onClose}
        onEditClick={onEditClick}
        context={context}
      />
    </TooltipProvider>
  );
  return { pad, onEditClick, onClose };
}

describe("PadControlContent", () => {
  beforeEach(() => {
    useProjectStore.setState({ ...initialProjectState });
    usePlaybackStore.setState({ ...initialPlaybackState });
    useLibraryStore.setState({ ...initialLibraryState });
    useMultiFadeStore.setState({
      active: false, originPadId: null, selectedPads: new Map(), reopenPadId: null,
    });
    vi.clearAllMocks();
    vi.mocked(stopPad).mockReturnValue(undefined as unknown as ReturnType<typeof stopPad>);
  });

  describe("header", () => {
    it("renders pad name in header", () => {
      renderContent();
      expect(screen.getByText("Kick")).toBeInTheDocument();
    });

    it("renders Edit, Duplicate, and Delete buttons", () => {
      renderContent();
      expect(screen.getByRole("button", { name: /edit pad/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /duplicate pad/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /delete pad/i })).toBeInTheDocument();
    });

    it("clicking Edit calls onEditClick with the pad and onClose", async () => {
      const { pad, onEditClick, onClose } = renderContent();
      await userEvent.click(screen.getByRole("button", { name: /edit pad/i }));
      expect(onEditClick).toHaveBeenCalledWith(pad);
      expect(onClose).toHaveBeenCalled();
    });

    it("clicking Duplicate calls duplicatePad and onClose", async () => {
      const { onClose } = renderContent();
      await userEvent.click(screen.getByRole("button", { name: /duplicate pad/i }));
      const pads = useProjectStore.getState().project!.scenes[0].pads;
      expect(pads).toHaveLength(2);
      expect(onClose).toHaveBeenCalled();
    });

    it("clicking Delete opens ConfirmDeletePadDialog", async () => {
      renderContent();
      await userEvent.click(screen.getByRole("button", { name: /delete pad/i }));
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
    });

    it("confirming delete calls stopPad and deletePad", async () => {
      const { onClose } = renderContent();
      await userEvent.click(screen.getByRole("button", { name: /delete pad/i }));
      const confirmBtn = await screen.findByRole("button", { name: /^delete$/i });
      await userEvent.click(confirmBtn);
      expect(stopPad).toHaveBeenCalled();
      expect(useProjectStore.getState().project!.scenes[0].pads).toHaveLength(0);
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe("full mode content", () => {
    beforeEach(() => {
      // happy-dom returns 0 for getBoundingClientRect — override to force full mode (≥280px)
      vi.spyOn(HTMLDivElement.prototype, "getBoundingClientRect").mockReturnValue({
        height: 350,
        width: 300,
        top: 0, left: 0, bottom: 350, right: 300,
        x: 0, y: 0,
        toJSON: () => ({}),
      } as DOMRect);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("renders Start button when pad is not playing", () => {
      renderContent();
      expect(screen.getByRole("button", { name: /start/i })).toBeInTheDocument();
    });

    it("renders Fade In button when pad is not playing", () => {
      renderContent();
      expect(screen.getByRole("button", { name: /fade in/i })).toBeInTheDocument();
    });

    it("renders Synchronized Fades button", () => {
      renderContent();
      expect(screen.getByRole("button", { name: /synchronized fades/i })).toBeInTheDocument();
    });

    it("renders Layers section heading", () => {
      renderContent();
      expect(screen.getByText(/^layers$/i)).toBeInTheDocument();
    });
  });

  describe("responsive display modes", () => {
    function mockResizeObserverWithHeight(height: number) {
      vi.stubGlobal(
        "ResizeObserver",
        vi.fn().mockImplementation(function (this: unknown, cb: ResizeObserverCallback) {
          return {
            observe: vi.fn().mockImplementation(() => {
              cb(
                [{ contentRect: { height } } as ResizeObserverEntry],
                {} as ResizeObserver
              );
            }),
            unobserve: vi.fn(),
            disconnect: vi.fn(),
          };
        })
      );
    }

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("full mode (>=280px): renders fade section and layers section heading", () => {
      mockResizeObserverWithHeight(300);
      renderContent();
      expect(screen.getByRole("button", { name: /fade in/i })).toBeInTheDocument();
      expect(screen.getByText(/^layers$/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /synchronized fades/i })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /fade options/i })).not.toBeInTheDocument();
    });

    it("condensed mode (>=120px, <280px): renders compact action row with sub-popover buttons", () => {
      mockResizeObserverWithHeight(150);
      renderContent();
      expect(screen.getByRole("button", { name: /fade (in|out)/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /fade options/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^layers$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /synchronized fades/i })).toBeInTheDocument();
      expect(screen.queryByText(/^layers$/i)).not.toBeInTheDocument();
    });

    it("scroll mode (<120px): renders condensed layout", () => {
      mockResizeObserverWithHeight(80);
      renderContent();
      expect(screen.getByRole("button", { name: /fade options/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^layers$/i })).toBeInTheDocument();
    });

    it("condensed mode: clicking Fade Options button opens fade sub-popover", async () => {
      mockResizeObserverWithHeight(150);
      renderContent();
      const fadeOptionsBtn = screen.getByRole("button", { name: /fade options/i });
      await userEvent.click(fadeOptionsBtn);
      const popoverContents = screen.getAllByTestId("popover-content");
      expect(popoverContents.length).toBeGreaterThan(0);
    });

    it("condensed mode: clicking Layers button opens layers sub-popover", async () => {
      mockResizeObserverWithHeight(150);
      renderContent();
      const layersBtn = screen.getByRole("button", { name: /^layers$/i });
      await userEvent.click(layersBtn);
      const popoverContents = screen.getAllByTestId("popover-content");
      expect(popoverContents.length).toBeGreaterThan(0);
    });
  });
});

describe("PadControlContent — hotkeys", () => {
  beforeEach(() => {
    useProjectStore.setState({ ...initialProjectState });
    usePlaybackStore.setState({ ...initialPlaybackState });
    useLibraryStore.setState({ ...initialLibraryState });
    useMultiFadeStore.setState({
      active: false, originPadId: null, selectedPads: new Map(), reopenPadId: null,
    });
    vi.clearAllMocks();
    vi.mocked(stopPad).mockReturnValue(undefined as unknown as ReturnType<typeof stopPad>);
  });

  it("pressing f in popover context triggers fade", async () => {
    renderContent({}, vi.fn(), vi.fn(), "popover");
    await userEvent.keyboard("f");
    const { fadePadWithLevels } = await import("@/lib/audio/padPlayer");
    expect(fadePadWithLevels).toHaveBeenCalled();
  });

  it("pressing x in popover context enters multi-fade mode", async () => {
    renderContent({}, vi.fn(), vi.fn(), "popover");
    await userEvent.keyboard("x");
    expect(useMultiFadeStore.getState().active).toBe(true);
  });

  it("pressing f in backface context does NOT trigger fade", async () => {
    renderContent({}, vi.fn(), vi.fn(), "backface");
    await userEvent.keyboard("f");
    const { fadePadWithLevels } = await import("@/lib/audio/padPlayer");
    expect(fadePadWithLevels).not.toHaveBeenCalled();
  });

  it("pressing x in backface context does NOT enter multi-fade mode", async () => {
    renderContent({}, vi.fn(), vi.fn(), "backface");
    await userEvent.keyboard("x");
    expect(useMultiFadeStore.getState().active).toBe(false);
  });
});

describe("PadControlContent — tooltips", () => {
  function mockResizeObserverWithHeight(height: number) {
    // Mock getBoundingClientRect so the initial height read in the effect also matches,
    // preventing a scroll→full mode transition that can leave stale tooltip portals.
    vi.spyOn(HTMLDivElement.prototype, "getBoundingClientRect").mockReturnValue({
      height,
      width: 300,
      top: 0, left: 0, bottom: height, right: 300,
      x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    vi.stubGlobal(
      "ResizeObserver",
      vi.fn().mockImplementation(function (this: unknown, cb: ResizeObserverCallback) {
        return {
          observe: vi.fn().mockImplementation(() => {
            cb([{ contentRect: { height } } as ResizeObserverEntry], {} as ResizeObserver);
          }),
          unobserve: vi.fn(),
          disconnect: vi.fn(),
        };
      })
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("Fade In button shows [F] tooltip in popover context (full mode)", async () => {
    mockResizeObserverWithHeight(300);
    renderContent({}, vi.fn(), vi.fn(), "popover");
    await userEvent.hover(screen.getByRole("button", { name: /fade in/i }));
    const fKeys = await screen.findAllByText("F", {}, { timeout: 2000 });
    expect(fKeys.length).toBeGreaterThanOrEqual(1);
  });

  it("Synchronized Fades button shows [X] tooltip in popover context (full mode)", async () => {
    mockResizeObserverWithHeight(300);
    renderContent({}, vi.fn(), vi.fn(), "popover");
    await userEvent.hover(screen.getByRole("button", { name: /synchronized fades/i }));
    const xKeys = await screen.findAllByText("X", {}, { timeout: 2000 });
    expect(xKeys.length).toBeGreaterThanOrEqual(1);
  });

  it("Synchronized Fades button shows [F] / [X] tooltip in backface context (full mode)", async () => {
    mockResizeObserverWithHeight(300);
    renderContent({}, vi.fn(), vi.fn(), "backface");
    await userEvent.hover(screen.getByRole("button", { name: /synchronized fades/i }));
    // Both Kbd elements appear in the tooltip
    const fKeys = await screen.findAllByText("F", {}, { timeout: 2000 });
    expect(fKeys.length).toBeGreaterThanOrEqual(1);
    const xKeys = await screen.findAllByText("X", {}, { timeout: 2000 });
    expect(xKeys.length).toBeGreaterThanOrEqual(1);
  });

  it("Fade In button has no tooltip in backface context (full mode)", async () => {
    mockResizeObserverWithHeight(300);
    renderContent({}, vi.fn(), vi.fn(), "backface");
    await userEvent.hover(screen.getByRole("button", { name: /fade in/i }));
    // Wait a tick to give tooltip time to appear if it were going to
    await new Promise((r) => setTimeout(r, 50));
    // "F" should not appear as a standalone kbd since there's no tooltip on the fade button
    const kbdElements = document.querySelectorAll("[data-slot='kbd']");
    expect(kbdElements.length).toBe(0);
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
