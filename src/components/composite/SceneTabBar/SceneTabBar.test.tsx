import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SceneTabBar } from "./SceneTabBar";
import { createMockScene } from "@/test/factories";

describe("SceneTabBar", () => {
  const defaultProps = {
    scenes: [],
    activeSceneId: null,
    onSceneChange: vi.fn(),
    onAddScene: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render an add scene button", () => {
    render(<SceneTabBar {...defaultProps} />);

    expect(screen.getByRole("button", { name: /add scene/i })).toBeInTheDocument();
  });

  it("should render no tabs when scenes list is empty", () => {
    render(<SceneTabBar {...defaultProps} />);

    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("should render a tab for each scene", () => {
    const scenes = [
      createMockScene({ id: "s1", name: "Scene 1" }),
      createMockScene({ id: "s2", name: "Scene 2" }),
    ];

    render(<SceneTabBar {...defaultProps} scenes={scenes} activeSceneId="s1" />);

    expect(screen.getByRole("tab", { name: "Scene 1" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Scene 2" })).toBeInTheDocument();
  });

  it("should render data-state=active on the tab whose id matches activeSceneId", () => {
    const scenes = [
      createMockScene({ id: "s1", name: "Scene 1" }),
      createMockScene({ id: "s2", name: "Scene 2" }),
    ];

    render(<SceneTabBar {...defaultProps} scenes={scenes} activeSceneId="s2" />);

    expect(screen.getByRole("tab", { name: "Scene 2" })).toHaveAttribute(
      "data-state",
      "active"
    );
    expect(screen.getByRole("tab", { name: "Scene 1" })).toHaveAttribute(
      "data-state",
      "inactive"
    );
  });

  it("should call onAddScene when the add button is clicked", () => {
    const onAddScene = vi.fn();

    render(<SceneTabBar {...defaultProps} onAddScene={onAddScene} />);
    fireEvent.click(screen.getByRole("button", { name: /add scene/i }));

    expect(onAddScene).toHaveBeenCalledOnce();
  });

  it("should call onSceneChange with the scene id when a tab is clicked", () => {
    const onSceneChange = vi.fn();
    const scenes = [
      createMockScene({ id: "s1", name: "Scene 1" }),
      createMockScene({ id: "s2", name: "Scene 2" }),
    ];

    render(
      <SceneTabBar
        {...defaultProps}
        scenes={scenes}
        activeSceneId="s1"
        onSceneChange={onSceneChange}
      />
    );
    fireEvent.click(screen.getByRole("tab", { name: "Scene 2" }));

    expect(onSceneChange).toHaveBeenCalledWith("s2");
  });
});
