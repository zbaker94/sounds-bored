import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SceneTabBar } from "./SceneTabBar";
import { createMockScene } from "@/test/factories";

describe("SceneTabBar", () => {
  function makeProps() {
    return {
      scenes: [],
      activeSceneId: null as string | null,
      onSceneChange: vi.fn(),
      onAddScene: vi.fn(),
    };
  }

  it("should render an add scene button", () => {
    render(<SceneTabBar {...makeProps()} />);

    expect(screen.getByRole("button", { name: /add scene/i })).toBeInTheDocument();
  });

  it("should render no tabs when scenes list is empty", () => {
    render(<SceneTabBar {...makeProps()} />);

    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("should render a tab for each scene", () => {
    const props = makeProps();
    const scenes = [
      createMockScene({ id: "s1", name: "Scene 1" }),
      createMockScene({ id: "s2", name: "Scene 2" }),
    ];

    render(<SceneTabBar {...props} scenes={scenes} activeSceneId="s1" />);

    expect(screen.getByRole("tab", { name: "Scene 1" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Scene 2" })).toBeInTheDocument();
  });

  it("should render data-state=active on the tab whose id matches activeSceneId", () => {
    const props = makeProps();
    const scenes = [
      createMockScene({ id: "s1", name: "Scene 1" }),
      createMockScene({ id: "s2", name: "Scene 2" }),
    ];

    render(<SceneTabBar {...props} scenes={scenes} activeSceneId="s2" />);

    expect(screen.getByRole("tab", { name: "Scene 2" })).toHaveAttribute(
      "data-state",
      "active"
    );
    expect(screen.getByRole("tab", { name: "Scene 1" })).toHaveAttribute(
      "data-state",
      "inactive"
    );
  });

  it("should render no tab as active when activeSceneId is null", () => {
    const props = makeProps();
    const scenes = [createMockScene({ id: "s1", name: "Scene 1" })];

    render(<SceneTabBar {...props} scenes={scenes} activeSceneId={null} />);

    expect(screen.getByRole("tab", { name: "Scene 1" })).toHaveAttribute(
      "data-state",
      "inactive"
    );
  });

  it("should call onAddScene when the add button is clicked", () => {
    const props = makeProps();
    render(<SceneTabBar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /add scene/i }));

    expect(props.onAddScene).toHaveBeenCalledOnce();
  });

  it("should call onSceneChange with the scene id when a tab is clicked", () => {
    const props = makeProps();
    const scenes = [
      createMockScene({ id: "s1", name: "Scene 1" }),
      createMockScene({ id: "s2", name: "Scene 2" }),
    ];

    render(
      <SceneTabBar
        {...props}
        scenes={scenes}
        activeSceneId="s1"
      />
    );
    // Radix Tabs does not respond to `click` in happy-dom — it fires onValueChange
    // via the `mousedown` handler internally. Using fireEvent.mouseDown is the
    // correct way to test this in a jsdom/happy-dom environment.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Scene 2" }));

    expect(props.onSceneChange).toHaveBeenCalledWith("s2");
  });
});
