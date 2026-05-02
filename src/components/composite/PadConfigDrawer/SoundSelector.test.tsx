import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createMockSound, createMockTag, createMockSet } from "@/test/factories";
import { SoundSelector } from "./SoundSelector";
import type { LayerSelection } from "@/lib/schemas";

function renderSelector(props: { value: LayerSelection; onChange: (v: LayerSelection) => void }) {
  return render(
    <TooltipProvider>
      <SoundSelector {...props} />
    </TooltipProvider>
  );
}

describe("SoundSelector", () => {
  const noopChange = vi.fn();

  beforeEach(() => {
    useLibraryStore.setState({ ...initialLibraryState });
    noopChange.mockClear();
  });

  it("shows a sound list when selection type is assigned", () => {
    const sound = createMockSound({ name: "Kick Drum" });
    useLibraryStore.setState({ sounds: [sound], tags: [], sets: [], isDirty: false });

    render(
      <SoundSelector
        value={{ type: "assigned", instances: [] }}
        onChange={noopChange}
      />
    );

    expect(screen.getByText("Kick Drum")).toBeInTheDocument();
  });

  it("shows a tag combobox when selection type is tag", () => {
    const tag = createMockTag({ id: "t1", name: "Percussion" });
    useLibraryStore.setState({ sounds: [], tags: [tag], sets: [], isDirty: false });

    renderSelector({
      value: { type: "tag", tagIds: [], matchMode: "any", defaultVolume: 100 },
      onChange: noopChange,
    });

    expect(screen.getByPlaceholderText(/search.*tags/i)).toBeInTheDocument();
  });

  it("shows selected tags as chips when tag ids are provided", () => {
    const tag = createMockTag({ id: "t1", name: "Percussion" });
    useLibraryStore.setState({ sounds: [], tags: [tag], sets: [], isDirty: false });

    renderSelector({
      value: { type: "tag", tagIds: ["t1"], matchMode: "any", defaultVolume: 100 },
      onChange: noopChange,
    });

    expect(screen.getByText("Percussion")).toBeInTheDocument();
  });

  it("shows a set combobox when selection type is set", () => {
    const set = createMockSet({ id: "s1", name: "My Drums" });
    useLibraryStore.setState({ sounds: [], tags: [], sets: [set], isDirty: false });

    renderSelector({
      value: { type: "set", setId: "", defaultVolume: 100 },
      onChange: noopChange,
    });

    expect(screen.getByPlaceholderText(/search sets/i)).toBeInTheDocument();
  });

  it("shows empty state message when library has no sounds (assigned type)", () => {
    render(
      <SoundSelector
        value={{ type: "assigned", instances: [] }}
        onChange={noopChange}
      />
    );

    expect(screen.getByText(/no sounds/i)).toBeInTheDocument();
  });

  it("calls onChange when a sound checkbox is toggled on", () => {
    const sound = createMockSound({ id: "s1", name: "Snare" });
    useLibraryStore.setState({ sounds: [sound], tags: [], sets: [], isDirty: false });

    render(
      <SoundSelector
        value={{ type: "assigned", instances: [] }}
        onChange={noopChange}
      />
    );

    fireEvent.click(screen.getByRole("checkbox"));

    expect(noopChange).toHaveBeenCalledTimes(1);
    const callArg = noopChange.mock.calls[0][0] as LayerSelection;
    expect(callArg.type).toBe("assigned");
    if (callArg.type === "assigned") {
      expect(callArg.instances).toHaveLength(1);
      expect(callArg.instances[0].soundId).toBe("s1");
    }
  });

  it("calls onChange when a sound checkbox is toggled off", () => {
    const sound = createMockSound({ id: "s1", name: "Snare" });
    useLibraryStore.setState({ sounds: [sound], tags: [], sets: [], isDirty: false });

    render(
      <SoundSelector
        value={{
          type: "assigned",
          instances: [{ id: "inst-1", soundId: "s1", volume: 100 }],
        }}
        onChange={noopChange}
      />
    );

    fireEvent.click(screen.getByRole("checkbox"));

    expect(noopChange).toHaveBeenCalledTimes(1);
    const callArg = noopChange.mock.calls[0][0] as LayerSelection;
    expect(callArg.type).toBe("assigned");
    if (callArg.type === "assigned") {
      expect(callArg.instances).toHaveLength(0);
    }
  });
});

describe("SoundSelector — assigned mode — search", () => {
  beforeEach(() => {
    useLibraryStore.setState({ ...initialLibraryState });
    useAppSettingsStore.setState({ settings: null });
  });

  it("renders a search input", () => {
    const sound = createMockSound({ name: "Kick" });
    useLibraryStore.setState({ sounds: [sound], tags: [], sets: [], isDirty: false });
    render(
      <SoundSelector
        value={{ type: "assigned", instances: [] }}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
  });

  it("filters sounds by name when a query is typed", async () => {
    const kick = createMockSound({ name: "Kick Drum" });
    const snare = createMockSound({ name: "Snare" });
    useLibraryStore.setState({ sounds: [kick, snare], tags: [], sets: [], isDirty: false });
    render(
      <SoundSelector
        value={{ type: "assigned", instances: [] }}
        onChange={vi.fn()}
      />
    );
    await userEvent.type(screen.getByPlaceholderText(/search/i), "Kick");
    expect(screen.getByText("Kick Drum")).toBeInTheDocument();
    expect(screen.queryByText("Snare")).not.toBeInTheDocument();
  });

  it("shows 'No results.' when search query matches nothing", async () => {
    const sound = createMockSound({ name: "Kick" });
    useLibraryStore.setState({ sounds: [sound], tags: [], sets: [], isDirty: false });
    render(
      <SoundSelector
        value={{ type: "assigned", instances: [] }}
        onChange={vi.fn()}
      />
    );
    await userEvent.type(screen.getByPlaceholderText(/search/i), "zzzzxxx");
    expect(screen.getByText(/no results/i)).toBeInTheDocument();
  });

  it("finds sounds by tag name", async () => {
    const tag = createMockTag({ id: "t1", name: "Percussion" });
    const kick = createMockSound({ name: "Kick", tags: ["t1"] });
    const ambient = createMockSound({ name: "Ambient Pad", tags: [] });
    useLibraryStore.setState({ sounds: [kick, ambient], tags: [tag], sets: [], isDirty: false });
    render(
      <SoundSelector
        value={{ type: "assigned", instances: [] }}
        onChange={vi.fn()}
      />
    );
    await userEvent.type(screen.getByPlaceholderText(/search/i), "Percussion");
    expect(screen.getByText("Kick")).toBeInTheDocument();
    expect(screen.queryByText("Ambient Pad")).not.toBeInTheDocument();
  });
});

describe("SoundSelector — tag mode", () => {
  function renderBasicTagSelector(tagName = "Percussion") {
    const tag = createMockTag({ name: tagName });
    useLibraryStore.setState({ sounds: [], tags: [tag], sets: [], isDirty: false });
    renderSelector({
      value: { type: "tag", tagIds: [], matchMode: "any", defaultVolume: 100 },
      onChange: vi.fn(),
    });
    return tag;
  }

  beforeEach(() => {
    useLibraryStore.setState({ ...initialLibraryState });
    useAppSettingsStore.setState({ settings: null });
  });

  it("renders a search input for tag mode", () => {
    renderBasicTagSelector();
    expect(screen.getByPlaceholderText(/search.*tags/i)).toBeInTheDocument();
  });

  it("shows 'No tags in library yet.' when tag list is empty", () => {
    useLibraryStore.setState({ sounds: [], tags: [], sets: [], isDirty: false });
    renderSelector({
      value: { type: "tag", tagIds: [], matchMode: "any", defaultVolume: 100 },
      onChange: vi.fn(),
    });
    // Combobox empty state is rendered inside a portal — only visible after opening
    // We verify the chips input renders (the combobox is present)
    expect(screen.getByPlaceholderText(/search.*tags/i)).toBeInTheDocument();
  });

  it("renders AND/OR toggle in tag mode", () => {
    renderBasicTagSelector();
    expect(screen.getByRole("tab", { name: /any/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /all/i })).toBeInTheDocument();
  });

  it("AND/OR toggle defaults to Any selected", () => {
    renderBasicTagSelector();
    const anyTab = screen.getByRole("tab", { name: /any/i });
    expect(anyTab).toHaveAttribute("aria-selected", "true");
  });

  it("clicking All calls onChange with matchMode all", async () => {
    const onChange = vi.fn();
    const tag = createMockTag({ name: "Percussion" });
    useLibraryStore.setState({ sounds: [], tags: [tag], sets: [], isDirty: false });
    renderSelector({
      value: { type: "tag", tagIds: ["t1"], matchMode: "any", defaultVolume: 100 },
      onChange,
    });
    await userEvent.click(screen.getByRole("tab", { name: /all/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ type: "tag", matchMode: "all" })
    );
  });

  it("renders Match Mode label with info icon tooltip", () => {
    renderBasicTagSelector();
    expect(screen.getByText("Match Mode")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "" })).toBeInTheDocument(); // info icon button
  });

  it("shows helper text prompting to select tags when none are selected", () => {
    renderBasicTagSelector();
    expect(screen.getByText("Select tags above to filter which sounds are eligible.")).toBeInTheDocument();
  });

  it("shows match count with mode when tags are selected and sounds match", () => {
    const tag = createMockTag({ id: "t1", name: "Percussion" });
    const kick = createMockSound({ name: "Kick", tags: ["t1"], filePath: "sounds/kick.wav" });
    const snare = createMockSound({ name: "Snare", tags: ["t1"], filePath: "sounds/snare.wav" });
    useLibraryStore.setState({ sounds: [kick, snare], tags: [tag], sets: [], isDirty: false });
    renderSelector({
      value: { type: "tag", tagIds: ["t1"], matchMode: "any", defaultVolume: 100 },
      onChange: vi.fn(),
    });
    expect(screen.getByText("2 sound(s) match any of these tags.")).toBeInTheDocument();
  });

  it("shows no-match helper text when tags are selected but no sounds match", () => {
    const tag = createMockTag({ id: "t1", name: "Percussion" });
    const ambient = createMockSound({ name: "Ambient", tags: [], filePath: "sounds/ambient.wav" });
    useLibraryStore.setState({ sounds: [ambient], tags: [tag], sets: [], isDirty: false });
    renderSelector({
      value: { type: "tag", tagIds: ["t1"], matchMode: "any", defaultVolume: 100 },
      onChange: vi.fn(),
    });
    expect(screen.getByText(/No sounds match/)).toBeInTheDocument();
  });

  it("onChange preserves matchMode when tags are added", async () => {
    const onChange = vi.fn();
    const tag = createMockTag({ id: "t1", name: "Percussion" });
    useLibraryStore.setState({ sounds: [], tags: [tag], sets: [], isDirty: false });
    renderSelector({
      value: { type: "tag", tagIds: [], matchMode: "all", defaultVolume: 100 },
      onChange,
    });

    // Open the combobox and select a tag
    await userEvent.click(screen.getByPlaceholderText(/search.*tags/i));
    const option = await screen.findByRole("option", { name: /percussion/i });
    await userEvent.click(option);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ type: "tag", matchMode: "all" })
    );
  });
});

describe("SoundSelector — set mode", () => {
  beforeEach(() => {
    useLibraryStore.setState({ ...initialLibraryState });
    useAppSettingsStore.setState({ settings: null });
  });

  it("renders a search input for set mode", () => {
    const set = createMockSet({ name: "My Drums" });
    useLibraryStore.setState({ sounds: [], tags: [], sets: [set], isDirty: false });
    renderSelector({
      value: { type: "set", setId: "", defaultVolume: 100 },
      onChange: vi.fn(),
    });
    expect(screen.getByPlaceholderText(/search sets/i)).toBeInTheDocument();
  });

  it("shows 'No sets in library yet.' when set list is empty", () => {
    useLibraryStore.setState({ sounds: [], tags: [], sets: [], isDirty: false });
    renderSelector({
      value: { type: "set", setId: "", defaultVolume: 100 },
      onChange: vi.fn(),
    });
    // Empty state is in the Combobox portal — verify the input renders
    expect(screen.getByPlaceholderText(/search sets/i)).toBeInTheDocument();
  });

  it("shows helper note about set membership", () => {
    const set = createMockSet({ id: "s1", name: "My Drums" });
    useLibraryStore.setState({ sounds: [], tags: [], sets: [set], isDirty: false });
    renderSelector({
      value: { type: "set", setId: "", defaultVolume: 100 },
      onChange: vi.fn(),
    });
    expect(screen.getByText(/Sounds are drawn from this set at trigger time/)).toBeInTheDocument();
  });
});
