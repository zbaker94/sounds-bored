import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { PadLiveControlPopover } from "./PadLiveControlPopover";
import { createMockPad, createMockLayer } from "@/test/factories";
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
  DrawerTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/hooks/useBreakpoint", () => ({
  useIsMd: vi.fn().mockReturnValue(true), // desktop by default
}));

vi.mock("./PadControlContent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./PadControlContent")>();
  return {
    ...actual,
    PadControlContent: ({ pad, onClose, onEditClick }: { pad: { name: string }; onClose: () => void; onEditClick?: (pad: { name: string }) => void }) => (
      <div data-testid="pad-control-content">
        <span>{pad.name}</span>
        <button type="button" onClick={onClose}>Close</button>
        <button type="button" onClick={() => onEditClick?.(pad)}>Edit</button>
      </div>
    ),
  };
});

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
    useMultiFadeStore.setState({
      active: false,
      originPadId: null,
      selectedPads: new Map(),
      reopenPadId: null,
    });
    vi.clearAllMocks();
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

  it("passes onEditClick to PadControlContent", async () => {
    const onEditClick = vi.fn();
    const layer = createMockLayer({ id: "layer-1" });
    const pad = createMockPad({ id: "pad-1", name: "Edit Test Pad", layers: [layer] });
    const anchorRef = { current: null };
    const onOpenChange = vi.fn();
    render(
      <PadLiveControlPopover
        pad={pad}
        sceneId="scene-1"
        open={true}
        onOpenChange={onOpenChange}
        anchorRef={anchorRef as React.RefObject<HTMLButtonElement | null>}
        onEditClick={onEditClick}
      />
    );
    const editBtn = screen.getByRole("button", { name: /edit/i });
    await userEvent.click(editBtn);
    expect(onEditClick).toHaveBeenCalledWith(pad);
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

    it("passes onClose to PadControlContent in drawer that calls onOpenChange(false)", async () => {
      vi.mocked(useIsMd).mockReturnValue(false);
      const { onOpenChange } = renderPopover({ name: "Mobile Pad" });
      const closeBtn = screen.getByRole("button", { name: /close/i });
      await userEvent.click(closeBtn);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
