import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { ProjectActionsProvider, useProjectActions } from "./ProjectActionsContext";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { createMockProject } from "@/test/factories";

vi.mock("@/lib/scope", () => ({
  pickFolder: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/project", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/project")>()),
  saveProject: vi.fn().mockResolvedValue(undefined),
  discardTemporaryProject: vi.fn(),
  buildExportZipName: vi.fn().mockReturnValue("project-export.zip"),
}));

vi.mock("@/lib/export", () => ({
  resolveReferencedSounds: vi.fn().mockReturnValue([]),
  countMissingReferencedSounds: vi.fn().mockReturnValue(0),
  buildSoundMapJson: vi.fn().mockReturnValue({ json: "{}", collisions: [] }),
}));

// useSaveProject/useSaveProjectAs are used by saveDialog/saveAs flows — not the export path,
// but the provider renders them unconditionally so they must be stubbed.
vi.mock("@/lib/project.queries", () => ({
  useSaveProject: vi.fn(() => ({ mutate: vi.fn() })),
  useSaveProjectAs: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() },
}));

import { pickFolder } from "@/lib/scope";
import { saveProject } from "@/lib/project";
const mockPickFolder = pickFolder as ReturnType<typeof vi.fn>;
const mockSaveProject = saveProject as ReturnType<typeof vi.fn>;

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter>
      <ProjectActionsProvider>{children}</ProjectActionsProvider>
    </MemoryRouter>
  );
}

describe("ProjectActionsProvider - handleExportClick", () => {
  beforeEach(() => {
    useProjectStore.setState({ ...initialProjectState });
    useLibraryStore.setState({ ...initialLibraryState });
    mockPickFolder.mockReset();
    mockPickFolder.mockResolvedValue(null);
    mockSaveProject.mockReset();
    mockSaveProject.mockResolvedValue(undefined);
  });

  it("calls pickFolder with canCreateDirectories: true after auto-saving", async () => {
    const project = createMockProject({ name: "Test" });
    useProjectStore.setState({ project, folderPath: "/projects/Test", isTemporary: false, isDirty: false });

    let exportClick!: () => void;
    function Consumer() {
      const ctx = useProjectActions();
      exportClick = ctx.handleExportClick;
      return null;
    }

    render(<Consumer />, { wrapper: Wrapper });

    await act(async () => { await exportClick(); });

    expect(mockSaveProject).toHaveBeenCalledWith("/projects/Test", project);
    expect(mockPickFolder).toHaveBeenCalledTimes(1);
    expect(mockPickFolder).toHaveBeenCalledWith({
      title: "Select Export Destination",
      canCreateDirectories: true,
    });
  });

  it("does not call pickFolder when auto-save fails", async () => {
    const project = createMockProject({ name: "Test" });
    useProjectStore.setState({ project, folderPath: "/projects/Test", isTemporary: false, isDirty: false });
    mockSaveProject.mockRejectedValue(new Error("disk full"));

    let exportClick!: () => void;
    function Consumer() {
      const ctx = useProjectActions();
      exportClick = ctx.handleExportClick;
      return null;
    }

    render(<Consumer />, { wrapper: Wrapper });

    await act(async () => { await exportClick(); });

    expect(mockPickFolder).not.toHaveBeenCalled();
  });
});
