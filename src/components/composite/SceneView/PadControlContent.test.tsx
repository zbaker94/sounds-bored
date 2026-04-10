import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { PadControlContent } from "./PadControlContent";
import { createMockPad, createMockLayer, createMockHistoryEntry, createMockProject, createMockScene } from "@/test/factories";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { usePlaybackStore, initialPlaybackState } from "@/state/playbackStore";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { useMultiFadeStore } from "@/state/multiFadeStore";

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
  isLayerActive: vi.fn().mockReturnValue(false),
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

function renderContent(padOverrides = {}, onEditClick = vi.fn(), onClose = vi.fn()) {
  const pad = loadPadInStore(padOverrides);
  render(
    <PadControlContent
      pad={pad}
      sceneId="scene-1"
      onClose={onClose}
      onEditClick={onEditClick}
    />
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
});
