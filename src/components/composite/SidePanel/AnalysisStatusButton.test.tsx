import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnalysisStatusButton } from "./AnalysisStatusButton";
import { useAnalysisStore, initialAnalysisState } from "@/state/analysisStore";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { createMockSound } from "@/test/factories";

beforeEach(() => {
  useAnalysisStore.setState({ ...initialAnalysisState });
  useLibraryStore.setState({ ...initialLibraryState });
});

describe("AnalysisStatusButton", () => {
  it("renders nothing when status is idle", () => {
    const { container } = render(<AnalysisStatusButton />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the button when status is running", () => {
    useAnalysisStore.setState({
      ...initialAnalysisState,
      status: "running",
      queueLength: 3,
      analyzingCount: 3,
      completedCount: 0,
    });
    render(<AnalysisStatusButton />);
    expect(screen.getByRole("button", { name: /analysis status/i })).toBeInTheDocument();
  });

  it("renders the button when status is completed", () => {
    useAnalysisStore.setState({
      ...initialAnalysisState,
      status: "completed",
      queueLength: 2,
      completedCount: 2,
    });
    render(<AnalysisStatusButton />);
    expect(screen.getByRole("button", { name: /analysis status/i })).toBeInTheDocument();
  });

  it("shows 'Analyzing loudness…' label in popover when running", async () => {
    const user = userEvent.setup();
    useAnalysisStore.setState({
      ...initialAnalysisState,
      status: "running",
      queueLength: 5,
      analyzingCount: 4,
      completedCount: 1,
    });
    render(<AnalysisStatusButton />);

    await user.click(screen.getByRole("button", { name: /analysis status/i }));

    expect(screen.getByText("Analyzing loudness…")).toBeInTheDocument();
  });

  it("shows 'Analysis complete' label in popover when completed", async () => {
    const user = userEvent.setup();
    useAnalysisStore.setState({
      ...initialAnalysisState,
      status: "completed",
      queueLength: 3,
      completedCount: 3,
    });
    render(<AnalysisStatusButton />);

    await user.click(screen.getByRole("button", { name: /analysis status/i }));

    expect(screen.getByText("Analysis complete")).toBeInTheDocument();
  });

  it("shows currently-analyzing sound name in popover when running", async () => {
    const user = userEvent.setup();
    const sound = createMockSound({ id: "s1", name: "Kick Drum" });
    useLibraryStore.setState({ ...initialLibraryState, sounds: [sound] });
    useAnalysisStore.setState({
      ...initialAnalysisState,
      status: "running",
      queueLength: 1,
      analyzingCount: 1,
      completedCount: 0,
      currentSoundId: "s1",
    });
    render(<AnalysisStatusButton />);

    await user.click(screen.getByRole("button", { name: /analysis status/i }));

    expect(screen.getByText("Kick Drum")).toBeInTheDocument();
  });

  it("cancel button calls cancelQueue", async () => {
    const user = userEvent.setup();
    const cancelSpy = vi.spyOn(useAnalysisStore.getState(), "cancelQueue");
    useAnalysisStore.setState({
      ...initialAnalysisState,
      status: "running",
      queueLength: 3,
      analyzingCount: 2,
      completedCount: 1,
    });
    render(<AnalysisStatusButton />);

    await user.click(screen.getByRole("button", { name: /analysis status/i }));

    const cancelBtn = screen.getByText(/cancel pending/i);
    await user.click(cancelBtn);

    expect(cancelSpy).toHaveBeenCalled();
  });
});
