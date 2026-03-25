import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { createMockSound, createMockGlobalFolder, createMockAppSettings } from "@/test/factories";
import { SoundFolderTree } from "./SoundFolderTree";

function setFolders(folders: ReturnType<typeof createMockGlobalFolder>[]) {
  useAppSettingsStore.setState({
    settings: createMockAppSettings({ globalFolders: folders }),
  });
}

describe("SoundFolderTree", () => {
  beforeEach(() => {
    useAppSettingsStore.setState({ settings: null });
  });

  it("renders sounds with no folderId at root level", () => {
    const sound = createMockSound({ name: "Kick Drum" });
    render(
      <SoundFolderTree
        sounds={[sound]}
        selectedIds={new Set()}
        onToggleSound={vi.fn()}
        onToggleFolder={vi.fn()}
      />
    );
    expect(screen.getByText("Kick Drum")).toBeInTheDocument();
  });

  it("renders a folder node when a folder exists", () => {
    const folder = createMockGlobalFolder({ id: "f1", path: "/sounds", name: "Drums" });
    setFolders([folder]);
    render(
      <SoundFolderTree
        sounds={[]}
        selectedIds={new Set()}
        onToggleSound={vi.fn()}
        onToggleFolder={vi.fn()}
      />
    );
    expect(screen.getByText("Drums")).toBeInTheDocument();
  });

  it("calls onToggleSound with the sound id when a sound checkbox is clicked", async () => {
    const onToggleSound = vi.fn();
    const sound = createMockSound({ id: "s1", name: "Kick" });
    render(
      <SoundFolderTree
        sounds={[sound]}
        selectedIds={new Set()}
        onToggleSound={onToggleSound}
        onToggleFolder={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole("checkbox"));
    expect(onToggleSound).toHaveBeenCalledWith("s1");
  });

  it("calls onToggleFolder with the folder id when a folder checkbox is clicked", async () => {
    const onToggleFolder = vi.fn();
    const folder = createMockGlobalFolder({ id: "f1", path: "/sounds", name: "Drums" });
    const sound = createMockSound({ id: "s1", name: "Kick", folderId: "f1" });
    setFolders([folder]);
    render(
      <SoundFolderTree
        sounds={[sound]}
        selectedIds={new Set()}
        onToggleSound={vi.fn()}
        onToggleFolder={onToggleFolder}
      />
    );
    // First checkbox belongs to the folder row
    const checkboxes = screen.getAllByRole("checkbox");
    await userEvent.click(checkboxes[0]);
    expect(onToggleFolder).toHaveBeenCalledWith("f1");
  });

  it("shows folder checkbox as checked when all subtree sounds are selected", () => {
    const folder = createMockGlobalFolder({ id: "f1", path: "/sounds", name: "Drums" });
    const sound = createMockSound({ id: "s1", name: "Kick", folderId: "f1" });
    setFolders([folder]);
    render(
      <SoundFolderTree
        sounds={[sound]}
        selectedIds={new Set(["s1"])}
        onToggleSound={vi.fn()}
        onToggleFolder={vi.fn()}
      />
    );
    const checkboxes = screen.getAllByRole("checkbox");
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(true);
  });

  it("shows folder checkbox as indeterminate when some (not all) subtree sounds are selected", () => {
    const folder = createMockGlobalFolder({ id: "f1", path: "/sounds", name: "Drums" });
    const s1 = createMockSound({ id: "s1", name: "Kick", folderId: "f1" });
    const s2 = createMockSound({ id: "s2", name: "Snare", folderId: "f1" });
    setFolders([folder]);
    render(
      <SoundFolderTree
        sounds={[s1, s2]}
        selectedIds={new Set(["s1"])}
        onToggleSound={vi.fn()}
        onToggleFolder={vi.fn()}
      />
    );
    const checkboxes = screen.getAllByRole("checkbox");
    expect((checkboxes[0] as HTMLInputElement).indeterminate).toBe(true);
  });

  it("renders nothing when sounds and folders are both empty", () => {
    const { container } = render(
      <SoundFolderTree
        sounds={[]}
        selectedIds={new Set()}
        onToggleSound={vi.fn()}
        onToggleFolder={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});
