import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { SceneTabBar } from "./SceneTabBar";
import { createMockProject, createMockHistoryEntry, createMockScene } from "@/test/factories";

describe("SceneTabBar", () => {
  beforeEach(() => {
    useProjectStore.setState({ ...initialProjectState });
  });

  function loadProject(scenes = [createMockScene({ id: "s1", name: "Scene 1" })]) {
    const entry = createMockHistoryEntry();
    useProjectStore.getState().loadProject(
      entry,
      createMockProject({ scenes }),
      false
    );
  }

  it("should render an add scene button", () => {
    render(<SceneTabBar />);
    expect(screen.getByRole("button", { name: /add scene/i })).toBeInTheDocument();
  });

  it("should render no tabs when no project is loaded", () => {
    render(<SceneTabBar />);
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("should render no tabs when scenes list is empty", () => {
    loadProject([]);
    render(<SceneTabBar />);
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("should render a tab for each scene", () => {
    loadProject([
      createMockScene({ id: "s1", name: "Scene 1" }),
      createMockScene({ id: "s2", name: "Scene 2" }),
    ]);

    render(<SceneTabBar />);

    expect(screen.getByRole("tab", { name: "Scene 1" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Scene 2" })).toBeInTheDocument();
  });

  it("should render data-state=active on the tab matching activeSceneId", () => {
    loadProject([
      createMockScene({ id: "s1", name: "Scene 1" }),
      createMockScene({ id: "s2", name: "Scene 2" }),
    ]);
    useProjectStore.getState().setActiveSceneId("s2");

    render(<SceneTabBar />);

    expect(screen.getByRole("tab", { name: "Scene 2" })).toHaveAttribute("data-state", "active");
    expect(screen.getByRole("tab", { name: "Scene 1" })).toHaveAttribute("data-state", "inactive");
  });

  it("should render no tab as active when activeSceneId is null", () => {
    loadProject([createMockScene({ id: "s1", name: "Scene 1" })]);
    useProjectStore.setState({ activeSceneId: null });

    render(<SceneTabBar />);

    expect(screen.getByRole("tab", { name: "Scene 1" })).toHaveAttribute("data-state", "inactive");
  });

  it("should call addScene when the add button is clicked", () => {
    loadProject([]);
    render(<SceneTabBar />);

    fireEvent.click(screen.getByRole("button", { name: /add scene/i }));

    expect(useProjectStore.getState().project?.scenes).toHaveLength(1);
  });

  it("should update activeSceneId in the store when a tab is clicked", () => {
    loadProject([
      createMockScene({ id: "s1", name: "Scene 1" }),
      createMockScene({ id: "s2", name: "Scene 2" }),
    ]);

    render(<SceneTabBar />);

    // Radix Tabs does not respond to `click` in happy-dom — it fires onValueChange
    // via the `mousedown` handler internally. Using fireEvent.mouseDown is the
    // correct way to test this in a jsdom/happy-dom environment.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Scene 2" }));

    expect(useProjectStore.getState().activeSceneId).toBe("s2");
  });
});
