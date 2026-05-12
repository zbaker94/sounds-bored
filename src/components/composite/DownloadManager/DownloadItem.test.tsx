import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DownloadItem } from "./DownloadItem";
import { useCancelDownload } from "@/lib/ytdlp.queries";
import type { DownloadJob } from "@/lib/schemas";

const mockCancelMutate = vi.fn();

vi.mock("@/lib/ytdlp.queries", () => ({
  useCancelDownload: vi.fn(() => ({ mutate: mockCancelMutate, isPending: false })),
}));

function makeJob(overrides: Partial<DownloadJob> = {}): DownloadJob {
  return {
    id: "job-1",
    url: "https://example.com/audio",
    outputName: "My Track",
    status: "queued",
    percent: 0,
    tags: [],
    sets: [],
    ...overrides,
  };
}

function renderItem(job: DownloadJob) {
  return render(
    <TooltipProvider>
      <DownloadItem job={job} />
    </TooltipProvider>,
  );
}

describe("DownloadItem", () => {
  it("is wrapped with React.memo", () => {
    expect((DownloadItem as unknown as { $$typeof: symbol }).$$typeof).toBe(
      Symbol.for("react.memo"),
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCancelDownload).mockReturnValue({ mutate: mockCancelMutate, isPending: false } as never);
  });

  it("shows the output name for a queued job", () => {
    renderItem(makeJob({ status: "queued" }));
    expect(screen.getByText("My Track")).toBeInTheDocument();
    expect(screen.getByText("Queued")).toBeInTheDocument();
  });

  it("shows filename from outputPath when available", () => {
    renderItem(makeJob({ status: "completed", percent: 100, outputPath: "/sounds/kick.mp3" }));
    expect(screen.getByText("kick.mp3")).toBeInTheDocument();
  });

  it("handles Windows backslash paths in outputPath", () => {
    renderItem(makeJob({ status: "completed", percent: 100, outputPath: "C:\\sounds\\kick.mp3" }));
    expect(screen.getByText("kick.mp3")).toBeInTheDocument();
  });

  it("falls back to outputName when outputPath ends with a separator", () => {
    renderItem(makeJob({ outputName: "Fallback", status: "completed", percent: 100, outputPath: "/sounds/" }));
    expect(screen.getByText("Fallback")).toBeInTheDocument();
  });

  it("shows green checkmark icon for completed status", () => {
    const { container } = renderItem(makeJob({ status: "completed", percent: 100, outputPath: "/sounds/kick.mp3" }));
    expect(container.querySelector(".text-green-500")).toBeInTheDocument();
  });

  it("shows progress bar and percent for downloading status", () => {
    renderItem(makeJob({ status: "downloading", percent: 42, speed: "1.2 MB/s" }));
    expect(screen.getByText(/42%/)).toBeInTheDocument();
    expect(screen.getByText(/1\.2 MB\/s/)).toBeInTheDocument();
  });

  it("suppresses ETA when it is '00:00'", () => {
    renderItem(makeJob({ status: "downloading", percent: 10, eta: "00:00" }));
    expect(screen.queryByText(/ETA/)).not.toBeInTheDocument();
  });

  it("shows non-zero ETA in the downloading label", () => {
    renderItem(makeJob({ status: "downloading", percent: 10, eta: "01:23" }));
    expect(screen.getByText(/ETA 01:23/)).toBeInTheDocument();
  });

  it("shows processing state text", () => {
    renderItem(makeJob({ status: "processing", percent: 100 }));
    expect(screen.getByText(/Converting to MP3/)).toBeInTheDocument();
  });

  it("shows elapsed time in seconds while processing", () => {
    vi.useFakeTimers();
    renderItem(makeJob({ status: "processing", percent: 100 }));
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(screen.getByText(/— 5s/)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("shows elapsed time in minutes while processing", () => {
    vi.useFakeTimers();
    renderItem(makeJob({ status: "processing", percent: 100 }));
    act(() => { vi.advanceTimersByTime(65_000); });
    expect(screen.getByText(/— 1m 5s/)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("shows error message for failed job", () => {
    renderItem(makeJob({ status: "failed", error: "Network timeout" }));
    expect(screen.getByText("Network timeout")).toBeInTheDocument();
  });

  it("shows cancelled state", () => {
    renderItem(makeJob({ status: "cancelled" }));
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
  });

  it.each(["queued", "downloading", "processing"] as const)(
    "shows cancel button for %s status",
    (status) => {
      renderItem(makeJob({ status, percent: 10 }));
      expect(screen.getByRole("button")).toBeInTheDocument();
    },
  );

  it("calls cancelDownload with the correct job id when cancel button clicked", async () => {
    const user = userEvent.setup();
    renderItem(makeJob({ id: "job-42", status: "downloading", percent: 50 }));
    await user.click(screen.getByRole("button"));
    expect(mockCancelMutate).toHaveBeenCalledWith("job-42");
  });

  it("disables cancel button while cancellation is pending", () => {
    vi.mocked(useCancelDownload).mockReturnValueOnce({ mutate: mockCancelMutate, isPending: true } as never);
    renderItem(makeJob({ status: "downloading", percent: 50 }));
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it.each([
    { status: "completed" as const, percent: 100, outputPath: "/a.mp3" },
    { status: "failed" as const, error: "err" },
    { status: "cancelled" as const },
  ])("does not show cancel button for $status", (overrides) => {
    renderItem(makeJob(overrides));
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
