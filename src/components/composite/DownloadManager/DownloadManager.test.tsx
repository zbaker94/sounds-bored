import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DownloadManager } from "./DownloadManager";
import { useDownloadStore, initialDownloadState } from "@/state/downloadStore";
import type { DownloadJob } from "@/lib/schemas";

vi.mock("@/lib/ytdlp.queries", () => ({
  useCancelDownload: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

function makeJob(id: string, overrides: Partial<DownloadJob> = {}): DownloadJob {
  return { id, url: "https://example.com", outputName: id, status: "queued", percent: 0, tags: [], sets: [], ...overrides };
}

function renderManager() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <DownloadManager />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("DownloadManager", () => {
  beforeEach(() => {
    useDownloadStore.setState({ ...initialDownloadState });
  });

  afterEach(() => {
    useDownloadStore.setState({ ...initialDownloadState });
  });

  it("renders active jobs before terminal jobs regardless of insertion order", () => {
    useDownloadStore.getState().addJob(makeJob("done", { status: "cancelled", outputName: "Done Item" }));
    useDownloadStore.getState().addJob(makeJob("live", { status: "downloading", percent: 10, outputName: "Live Item" }));
    renderManager();
    const items = screen.getAllByText(/Item/);
    expect(items[0]).toHaveTextContent("Live Item");
    expect(items[1]).toHaveTextContent("Done Item");
  });

  it("renders the Downloads section header", () => {
    useDownloadStore.getState().addJob(makeJob("j1", { status: "queued" }));
    renderManager();
    expect(screen.getByText("Downloads")).toBeInTheDocument();
  });

  it("renders all jobs", () => {
    useDownloadStore.getState().addJob(makeJob("j1", { outputName: "Alpha", status: "queued" }));
    useDownloadStore.getState().addJob(makeJob("j2", { outputName: "Beta", status: "cancelled" }));
    renderManager();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });
});
