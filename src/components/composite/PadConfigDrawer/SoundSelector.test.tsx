import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
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

  it("shows a tag dropdown when selection type is tag", () => {
    const tag = createMockTag({ id: "t1", name: "Percussion" });
    useLibraryStore.setState({ sounds: [], tags: [tag], sets: [], isDirty: false });

    render(
      <SoundSelector
        value={{ type: "tag", tagId: "", defaultVolume: 100 }}
        onChange={noopChange}
      />
    );

    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByText("Select tag")).toBeInTheDocument();
  });

  it("shows a set dropdown when selection type is set", () => {
    const set = createMockSet({ id: "s1", name: "My Drums" });
    useLibraryStore.setState({ sounds: [], tags: [], sets: [set], isDirty: false });

    render(
      <SoundSelector
        value={{ type: "set", setId: "", defaultVolume: 100 }}
        onChange={noopChange}
      />
    );

    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByText("Select set")).toBeInTheDocument();
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
