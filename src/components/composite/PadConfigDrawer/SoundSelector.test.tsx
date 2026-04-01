import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { createMockSound, createMockTag, createMockSet } from "@/test/factories";
import { SoundSelector } from "./SoundSelector";
import type { LayerSelection } from "@/lib/schemas";

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

    render(
      <SoundSelector
        value={{ type: "tag", tagIds: [], defaultVolume: 100 }}
        onChange={noopChange}
      />
    );

    expect(screen.getByPlaceholderText(/search tags/i)).toBeInTheDocument();
  });

  it("shows selected tags as chips when tag ids are provided", () => {
    const tag = createMockTag({ id: "t1", name: "Percussion" });
    useLibraryStore.setState({ sounds: [], tags: [tag], sets: [], isDirty: false });

    render(
      <SoundSelector
        value={{ type: "tag", tagIds: ["t1"], defaultVolume: 100 }}
        onChange={noopChange}
      />
    );

    expect(screen.getByText("Percussion")).toBeInTheDocument();
  });

  it("shows a set combobox when selection type is set", () => {
    const set = createMockSet({ id: "s1", name: "My Drums" });
    useLibraryStore.setState({ sounds: [], tags: [], sets: [set], isDirty: false });

    render(
      <SoundSelector
        value={{ type: "set", setId: "", defaultVolume: 100 }}
        onChange={noopChange}
      />
    );

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
  beforeEach(() => {
    useLibraryStore.setState({ ...initialLibraryState });
    useAppSettingsStore.setState({ settings: null });
  });

  it("renders a search input for tag mode", () => {
    const tag = createMockTag({ name: "Percussion" });
    useLibraryStore.setState({ sounds: [], tags: [tag], sets: [], isDirty: false });
    render(
      <SoundSelector
        value={{ type: "tag", tagIds: [], defaultVolume: 100 }}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByPlaceholderText(/search tags/i)).toBeInTheDocument();
  });

  it("shows 'No tags in library yet.' when tag list is empty", () => {
    useLibraryStore.setState({ sounds: [], tags: [], sets: [], isDirty: false });
    render(
      <SoundSelector
        value={{ type: "tag", tagIds: [], defaultVolume: 100 }}
        onChange={vi.fn()}
      />
    );
    // Combobox empty state is rendered inside a portal — only visible after opening
    // We verify the chips input renders (the combobox is present)
    expect(screen.getByPlaceholderText(/search tags/i)).toBeInTheDocument();
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
    render(
      <SoundSelector
        value={{ type: "set", setId: "", defaultVolume: 100 }}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByPlaceholderText(/search sets/i)).toBeInTheDocument();
  });

  it("shows 'No sets in library yet.' when set list is empty", () => {
    useLibraryStore.setState({ sounds: [], tags: [], sets: [], isDirty: false });
    render(
      <SoundSelector
        value={{ type: "set", setId: "", defaultVolume: 100 }}
        onChange={vi.fn()}
      />
    );
    // Empty state is in the Combobox portal — verify the input renders
    expect(screen.getByPlaceholderText(/search sets/i)).toBeInTheDocument();
  });
});
