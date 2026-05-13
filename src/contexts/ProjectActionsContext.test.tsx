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
const mockPickFolder = pickFolder as ReturnType<typeof vi.fn>;

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter>
      <ProjectActionsProvider>{children}</ProjectActionsProvider>
    </MemoryRouter>
  );
}

describe("ProjectActionsProvider — handleExportClick", () => {
  beforeEach(() => {
    useProjectStore.setState({ ...initialProjectState });
    useLibraryStore.setState({ ...initialLibraryState });
    mockPickFolder.mockReset();
    mockPickFolder.mockResolvedValue(null);
  });

  it("calls pickFolder with canCreateDirectories: true", async () => {
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

    expect(mockPickFolder).toHaveBeenCalledWith({
      title: "Select Export Destination",
      canCreateDirectories: true,
    });
  });
});
