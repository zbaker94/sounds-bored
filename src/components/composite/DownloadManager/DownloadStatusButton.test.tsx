import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DownloadStatusButton } from "./DownloadStatusButton";
import { useDownloadStore, initialDownloadState } from "@/state/downloadStore";
import type { DownloadJob } from "@/lib/schemas";

function makeJob(id: string, overrides: Partial<DownloadJob> = {}): DownloadJob {
  return {
    id,
    url: "https://example.com/audio",
    outputName: "Track",
    status: "queued",
    percent: 0,
    tags: [],
    sets: [],
    ...overrides,
  };
}

const mockOpenDialog = vi.fn();

function renderButton() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <DownloadStatusButton onOpenDialog={mockOpenDialog} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("DownloadStatusButton", () => {
  beforeEach(() => {
    useDownloadStore.setState({ ...initialDownloadState });
  });

  afterEach(() => {
    useDownloadStore.setState({ ...initialDownloadState });
  });

  it("calls onOpenDialog when Download from URL is clicked", async () => {
    const user = userEvent.setup();
    renderButton();
    await user.click(screen.getByRole("button", { name: /download from url/i }));
    expect(mockOpenDialog).toHaveBeenCalledTimes(1);
  });

  it("always renders the button even with no jobs", () => {
    renderButton();
    expect(screen.getByRole("button", { name: /download status/i })).toBeInTheDocument();
  });

  it("shows empty state text in popover when no jobs", async () => {
    const user = userEvent.setup();
    renderButton();
    await user.click(screen.getByRole("button", { name: /download status/i }));
    expect(await screen.findByText(/no downloads yet/i)).toBeInTheDocument();
  });

  it.each(["queued", "downloading", "processing"] as const)(
    "shows spinning icon for active status %s",
    (status) => {
      useDownloadStore.getState().addJob(makeJob("job-1", { status, percent: 0 }));
      renderButton();
      const btn = screen.getByRole("button", { name: /download status/i });
      expect(btn.querySelector("svg")).toHaveClass("animate-spin");
    },
  );

  it("shows spinning icon when any job is active even if others are completed", () => {
    useDownloadStore.getState().addJob(makeJob("a", { status: "completed", percent: 100, outputPath: "/a.mp3" }));
    useDownloadStore.getState().addJob(makeJob("b", { status: "downloading", percent: 10 }));
    renderButton();
    expect(screen.getByRole("button", { name: /download status/i }).querySelector("svg")).toHaveClass("animate-spin");
  });

  it.each([
    {
      label: "hides badge when no active downloads",
      jobs: [makeJob("done", { status: "completed", percent: 100, outputPath: "/a.mp3" })],
      expectedBadge: null,
    },
    {
      label: "shows count for mixed active statuses",
      jobs: [
        makeJob("a", { status: "downloading", percent: 10 }),
        makeJob("b", { status: "processing", percent: 80 }),
      ],
      expectedBadge: "2",
    },
    {
      label: "caps badge at 9+ when more than 9 active",
      jobs: Array.from({ length: 10 }, (_, i) => makeJob(`j${i}`, { status: "downloading", percent: 0 })),
      expectedBadge: "9+",
    },
  ])(
    "$label",
    ({ jobs, expectedBadge }) => {
      jobs.forEach((job) => useDownloadStore.getState().addJob(job));
      renderButton();
      if (expectedBadge === null) {
        expect(screen.queryByText(/^\d+$/)).not.toBeInTheDocument();
      } else {
        expect(screen.getByText(expectedBadge)).toBeInTheDocument();
      }
    },
  );

  it("does not apply animate-spin when all downloads are completed", () => {
    useDownloadStore.getState().addJob(makeJob("job-1", { status: "completed", percent: 100, outputPath: "/a.mp3" }));
    renderButton();
    const btn = screen.getByRole("button", { name: /download status/i });
    expect(btn.querySelector("svg")).not.toHaveClass("animate-spin");
  });

  it("opens popover with download job name on click", async () => {
    const user = userEvent.setup();
    useDownloadStore.getState().addJob(
      makeJob("job-1", { outputName: "Visible Job", status: "downloading", percent: 25 }),
    );
    renderButton();
    await user.click(screen.getByRole("button", { name: /download status/i }));
    expect(await screen.findByText("Visible Job")).toBeInTheDocument();
  });
});
