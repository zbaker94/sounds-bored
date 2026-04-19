import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { createMockSound, createMockTag, createMockSet } from "@/test/factories";
import { SoundPickerDialog } from "./SoundPickerDialog";
import type { LayerSelection } from "@/lib/schemas";

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: React.ReactNode;
  }) => (
    <select
      data-testid="set-select"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

function renderDialog(
  options: {
    open?: boolean;
    currentSelection?: LayerSelection;
  } = {},
) {
  const onOpenChange = vi.fn();
  const onSelectionChange = vi.fn();
  const { open = true, currentSelection = { type: "assigned", instances: [] } } = options;
  render(
    <SoundPickerDialog
      open={open}
      onOpenChange={onOpenChange}
      layerId="layer-1"
      currentSelection={currentSelection}
      onSelectionChange={onSelectionChange}
    />,
  );
  return { onOpenChange, onSelectionChange };
}

describe("SoundPickerDialog", () => {
  const kickSound = createMockSound({ id: "sound-kick", name: "Kick" });
  const snareSound = createMockSound({ id: "sound-snare", name: "Snare" });
  const hatSound = createMockSound({ id: "sound-hat", name: "Hat" });
  const drumsTag = createMockTag({ id: "tag-drums", name: "drums" });
  const ambientTag = createMockTag({ id: "tag-ambient", name: "ambient" });
  const introSet = createMockSet({ id: "set-intro", name: "Intro" });
  const outroSet = createMockSet({ id: "set-outro", name: "Outro" });

  beforeEach(() => {
    vi.clearAllMocks();
    useLibraryStore.setState({
      ...initialLibraryState,
      sounds: [kickSound, snareSound, hatSound],
      tags: [drumsTag, ambientTag],
      sets: [introSet, outroSet],
    });
  });

  it("does not render when open=false", () => {
    renderDialog({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders when open=true", () => {
    renderDialog();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Select sounds")).toBeInTheDocument();
  });

  it("renders all sounds in the list", () => {
    renderDialog();
    expect(screen.getByLabelText("Kick")).toBeInTheDocument();
    expect(screen.getByLabelText("Snare")).toBeInTheDocument();
    expect(screen.getByLabelText("Hat")).toBeInTheDocument();
  });

  it("filters the sound list by search input (case-insensitive)", async () => {
    renderDialog();
    await userEvent.type(screen.getByLabelText("Search sounds"), "SN");
    expect(screen.getByLabelText("Snare")).toBeInTheDocument();
    expect(screen.queryByLabelText("Kick")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Hat")).not.toBeInTheDocument();
  });

  it("checking a sound calls onSelectionChange with type=assigned", async () => {
    const { onSelectionChange } = renderDialog();
    await userEvent.click(screen.getByLabelText("Kick"));
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    const arg = onSelectionChange.mock.calls[0][0] as LayerSelection;
    expect(arg.type).toBe("assigned");
    if (arg.type === "assigned") {
      expect(arg.instances).toHaveLength(1);
      expect(arg.instances[0].soundId).toBe("sound-kick");
    }
  });

  it("checking multiple sounds accumulates in the selection", async () => {
    const firstSelection: LayerSelection = {
      type: "assigned",
      instances: [{ id: "inst-1", soundId: "sound-kick", volume: 100 }],
    };
    const { onSelectionChange } = renderDialog({ currentSelection: firstSelection });
    await userEvent.click(screen.getByLabelText("Snare"));
    const arg = onSelectionChange.mock.calls[0][0] as LayerSelection;
    expect(arg.type).toBe("assigned");
    if (arg.type === "assigned") {
      expect(arg.instances.map((i) => i.soundId)).toEqual(["sound-kick", "sound-snare"]);
    }
  });

  it("clicking an already-checked sound unchecks it", async () => {
    const selection: LayerSelection = {
      type: "assigned",
      instances: [{ id: "inst-1", soundId: "sound-kick", volume: 100 }],
    };
    const { onSelectionChange } = renderDialog({ currentSelection: selection });
    await userEvent.click(screen.getByLabelText("Kick"));
    const arg = onSelectionChange.mock.calls[0][0] as LayerSelection;
    expect(arg.type).toBe("assigned");
    if (arg.type === "assigned") {
      expect(arg.instances).toHaveLength(0);
    }
  });

  it("currentSelection type=assigned pre-checks the correct sounds", () => {
    const selection: LayerSelection = {
      type: "assigned",
      instances: [
        { id: "inst-1", soundId: "sound-kick", volume: 100 },
        { id: "inst-2", soundId: "sound-hat", volume: 100 },
      ],
    };
    renderDialog({ currentSelection: selection });
    expect(screen.getByLabelText("Kick")).toBeChecked();
    expect(screen.getByLabelText("Snare")).not.toBeChecked();
    expect(screen.getByLabelText("Hat")).toBeChecked();
  });

  it("clicking a tag calls onSelectionChange with type=tag", async () => {
    const { onSelectionChange } = renderDialog();
    await userEvent.click(screen.getByRole("checkbox", { name: "drums" }));
    const arg = onSelectionChange.mock.calls[0][0] as LayerSelection;
    expect(arg.type).toBe("tag");
    if (arg.type === "tag") {
      expect(arg.tagIds).toEqual(["tag-drums"]);
      expect(arg.matchMode).toBe("any");
    }
  });

  it("currentSelection type=tag highlights the corresponding tags", () => {
    const selection: LayerSelection = {
      type: "tag",
      tagIds: ["tag-drums"],
      matchMode: "any",
      defaultVolume: 100,
    };
    renderDialog({ currentSelection: selection });
    expect(screen.getByRole("checkbox", { name: "drums" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("checkbox", { name: "ambient" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("selecting a set calls onSelectionChange with type=set", async () => {
    const { onSelectionChange } = renderDialog();
    await userEvent.selectOptions(screen.getByTestId("set-select"), "set-intro");
    const arg = onSelectionChange.mock.calls[0][0] as LayerSelection;
    expect(arg.type).toBe("set");
    if (arg.type === "set") {
      expect(arg.setId).toBe("set-intro");
    }
  });

  it("currentSelection type=set shows the set as selected in the dropdown", () => {
    const selection: LayerSelection = {
      type: "set",
      setId: "set-outro",
      defaultVolume: 100,
    };
    renderDialog({ currentSelection: selection });
    expect(screen.getByTestId("set-select")).toHaveValue("set-outro");
  });

  it("does NOT show any/all toggle when zero tags are selected", () => {
    const selection: LayerSelection = {
      type: "tag",
      tagIds: [],
      matchMode: "any",
      defaultVolume: 100,
    };
    renderDialog({ currentSelection: selection });
    expect(screen.queryByRole("button", { name: "any" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "all" })).not.toBeInTheDocument();
  });

  it("does NOT show any/all toggle when only one tag is selected", () => {
    const selection: LayerSelection = {
      type: "tag",
      tagIds: ["tag-drums"],
      matchMode: "any",
      defaultVolume: 100,
    };
    renderDialog({ currentSelection: selection });
    expect(screen.queryByRole("button", { name: "any" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "all" })).not.toBeInTheDocument();
  });

  it("shows any/all toggle when multiple tags are selected", () => {
    const selection: LayerSelection = {
      type: "tag",
      tagIds: ["tag-drums", "tag-ambient"],
      matchMode: "any",
      defaultVolume: 100,
    };
    renderDialog({ currentSelection: selection });
    expect(screen.getByRole("button", { name: "any" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "all" })).toBeInTheDocument();
  });

  it("clicking all toggles matchMode to all", async () => {
    const selection: LayerSelection = {
      type: "tag",
      tagIds: ["tag-drums", "tag-ambient"],
      matchMode: "any",
      defaultVolume: 100,
    };
    const { onSelectionChange } = renderDialog({ currentSelection: selection });
    await userEvent.click(screen.getByRole("button", { name: "all" }));
    const arg = onSelectionChange.mock.calls[0][0] as LayerSelection;
    expect(arg.type).toBe("tag");
    if (arg.type === "tag") {
      expect(arg.matchMode).toBe("all");
    }
  });

  it("clicking any toggles matchMode from all back to any", async () => {
    const selection: LayerSelection = {
      type: "tag",
      tagIds: ["tag-drums", "tag-ambient"],
      matchMode: "all",
      defaultVolume: 100,
    };
    const { onSelectionChange } = renderDialog({ currentSelection: selection });
    await userEvent.click(screen.getByRole("button", { name: "any" }));
    const arg = onSelectionChange.mock.calls[0][0] as LayerSelection;
    expect(arg.type).toBe("tag");
    if (arg.type === "tag") {
      expect(arg.matchMode).toBe("any");
    }
  });

  it("shows empty state when no sounds match the search", async () => {
    renderDialog();
    await userEvent.type(screen.getByLabelText("Search sounds"), "nonexistent");
    expect(screen.getByText("No sounds found.")).toBeInTheDocument();
  });

  it("clicking Done calls onOpenChange(false)", async () => {
    const { onOpenChange } = renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
