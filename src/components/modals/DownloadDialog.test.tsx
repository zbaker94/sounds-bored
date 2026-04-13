import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DownloadDialog } from "./DownloadDialog";
import { useDownloadStore, initialDownloadState } from "@/state/downloadStore";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { createMockAppSettings, createMockDownloadJob, createMockSound } from "@/test/factories";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockStartDownload = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/ytdlp.queries", () => ({
  useStartDownload: vi.fn(() => ({
    mutateAsync: mockStartDownload,
    isPending: false,
  })),
}));

const mockSettings = createMockAppSettings();

vi.mock("@/lib/appSettings.queries", () => ({
  useAppSettings: vi.fn(() => ({ data: mockSettings })),
}));

function renderDialog(open = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DownloadDialog open={open} onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockStartDownload.mockClear();
  useLibraryStore.setState({ ...initialLibraryState });
  useDownloadStore.setState({ ...initialDownloadState });
});

describe("DownloadDialog — URL validation", () => {
  it("rejects an empty URL", async () => {
    renderDialog();
    await userEvent.click(screen.getByRole("button", { name: /download/i }));
    expect(screen.getByText("URL is required")).toBeInTheDocument();
    expect(mockStartDownload).not.toHaveBeenCalled();
  });

  it("accepts a valid https URL", async () => {
    renderDialog();
    await userEvent.type(
      screen.getByPlaceholderText("https://..."),
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    await userEvent.type(screen.getByPlaceholderText("my-sound"), "my-sound");
    await userEvent.click(screen.getByRole("button", { name: /download/i }));
    expect(screen.queryByText(/URL must use/i)).not.toBeInTheDocument();
    expect(mockStartDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      }),
    );
  });

  it("accepts a valid http URL", async () => {
    renderDialog();
    await userEvent.type(
      screen.getByPlaceholderText("https://..."),
      "http://example.com/audio",
    );
    await userEvent.type(screen.getByPlaceholderText("my-sound"), "my-sound");
    await userEvent.click(screen.getByRole("button", { name: /download/i }));
    expect(screen.queryByText(/URL must use/i)).not.toBeInTheDocument();
    expect(mockStartDownload).toHaveBeenCalledWith(
      expect.objectContaining({ url: "http://example.com/audio" }),
    );
  });

  it("accepts HTTPS:// with uppercase scheme (URL constructor normalizes)", async () => {
    renderDialog();
    await userEvent.type(
      screen.getByPlaceholderText("https://..."),
      "HTTPS://example.com/audio",
    );
    await userEvent.type(screen.getByPlaceholderText("my-sound"), "my-sound");
    await userEvent.click(screen.getByRole("button", { name: /download/i }));
    expect(screen.queryByText(/URL must use/i)).not.toBeInTheDocument();
    expect(mockStartDownload).toHaveBeenCalledWith(
      expect.objectContaining({ url: "HTTPS://example.com/audio" }),
    );
  });

  it("rejects a file:// URL", async () => {
    renderDialog();
    await userEvent.type(
      screen.getByPlaceholderText("https://..."),
      "file:///etc/passwd",
    );
    await userEvent.type(screen.getByPlaceholderText("my-sound"), "my-sound");
    await userEvent.click(screen.getByRole("button", { name: /download/i }));
    expect(
      screen.getByText("URL must use http:// or https://"),
    ).toBeInTheDocument();
    expect(mockStartDownload).not.toHaveBeenCalled();
  });

  it("rejects an ftp:// URL", async () => {
    renderDialog();
    await userEvent.type(
      screen.getByPlaceholderText("https://..."),
      "ftp://example.com/audio.mp3",
    );
    await userEvent.type(screen.getByPlaceholderText("my-sound"), "my-sound");
    await userEvent.click(screen.getByRole("button", { name: /download/i }));
    expect(
      screen.getByText("URL must use http:// or https://"),
    ).toBeInTheDocument();
    expect(mockStartDownload).not.toHaveBeenCalled();
  });

  it("rejects a URL with a malformed http-prefixed scheme (httpfoo://)", async () => {
    renderDialog();
    await userEvent.type(
      screen.getByPlaceholderText("https://..."),
      "httpfoo://attacker.example",
    );
    await userEvent.type(screen.getByPlaceholderText("my-sound"), "my-sound");
    await userEvent.click(screen.getByRole("button", { name: /download/i }));
    expect(
      screen.getByText("URL must use http:// or https://"),
    ).toBeInTheDocument();
    expect(mockStartDownload).not.toHaveBeenCalled();
  });

  it("rejects a completely invalid string that is not a URL", async () => {
    renderDialog();
    await userEvent.type(
      screen.getByPlaceholderText("https://..."),
      "not-a-url-at-all",
    );
    await userEvent.type(screen.getByPlaceholderText("my-sound"), "my-sound");
    await userEvent.click(screen.getByRole("button", { name: /download/i }));
    expect(
      screen.getByText("URL must use http:// or https://"),
    ).toBeInTheDocument();
    expect(mockStartDownload).not.toHaveBeenCalled();
  });

  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["blob:", "blob:https://example.com/some-uuid"],
  ])("rejects %s URLs", async (_label, badUrl) => {
    renderDialog();
    await userEvent.type(screen.getByPlaceholderText("https://..."), badUrl);
    await userEvent.type(screen.getByPlaceholderText("my-sound"), "my-sound");
    await userEvent.click(screen.getByRole("button", { name: /download/i }));
    expect(
      screen.getByText("URL must use http:// or https://"),
    ).toBeInTheDocument();
    expect(mockStartDownload).not.toHaveBeenCalled();
  });

  it("accepts a URL with leading/trailing whitespace (trims before validation)", async () => {
    renderDialog();
    await userEvent.type(
      screen.getByPlaceholderText("https://..."),
      "  https://example.com/audio  ",
    );
    await userEvent.type(screen.getByPlaceholderText("my-sound"), "my-sound");
    await userEvent.click(screen.getByRole("button", { name: /download/i }));
    expect(screen.queryByText(/URL must use/i)).not.toBeInTheDocument();
    expect(mockStartDownload).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://example.com/audio" }),
    );
  });

  it("treats whitespace-only input as empty (shows URL is required)", async () => {
    renderDialog();
    await userEvent.type(screen.getByPlaceholderText("https://..."), "   ");
    await userEvent.type(screen.getByPlaceholderText("my-sound"), "my-sound");
    await userEvent.click(screen.getByRole("button", { name: /download/i }));
    expect(screen.getByText("URL is required")).toBeInTheDocument();
    expect(mockStartDownload).not.toHaveBeenCalled();
  });

  it("clears the URL error when the user edits the input", async () => {
    renderDialog();
    await userEvent.type(
      screen.getByPlaceholderText("https://..."),
      "ftp://example.com",
    );
    await userEvent.type(screen.getByPlaceholderText("my-sound"), "my-sound");
    await userEvent.click(screen.getByRole("button", { name: /download/i }));
    expect(screen.getByText("URL must use http:// or https://")).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText("https://..."), "x");
    expect(screen.queryByText(/URL must use/i)).not.toBeInTheDocument();
  });
});

describe("DownloadDialog — duplicate name validation", () => {
  const downloadFolderId = mockSettings.downloadFolderId!;

  async function fillAndSubmit(name: string) {
    await userEvent.type(
      screen.getByPlaceholderText("https://..."),
      "https://example.com/audio",
    );
    await userEvent.type(screen.getByPlaceholderText("my-sound"), name);
    await userEvent.click(screen.getByRole("button", { name: /download/i }));
  }

  it("rejects a name that matches an active download job in the store", async () => {
    const job = createMockDownloadJob({ outputName: "my-sound", status: "downloading" });
    useDownloadStore.setState({ jobs: { [job.id]: job } });

    renderDialog();
    await fillAndSubmit("my-sound");

    expect(
      screen.getByText("A download with this name is already in progress"),
    ).toBeInTheDocument();
    expect(mockStartDownload).not.toHaveBeenCalled();
  });

  it("allows a name that matches only a failed or cancelled job", async () => {
    const failedJob = createMockDownloadJob({ outputName: "my-sound", status: "failed" });
    const cancelledJob = createMockDownloadJob({ outputName: "my-sound", status: "cancelled" });
    useDownloadStore.setState({ jobs: { [failedJob.id]: failedJob, [cancelledJob.id]: cancelledJob } });

    renderDialog();
    await fillAndSubmit("my-sound");

    expect(screen.queryByText(/already in progress/i)).not.toBeInTheDocument();
    expect(mockStartDownload).toHaveBeenCalled();
  });

  it("rejects a name that matches a sound in the download folder library", async () => {
    const sound = createMockSound({ name: "existing-sound", folderId: downloadFolderId });
    useLibraryStore.setState({ ...initialLibraryState, sounds: [sound] });

    renderDialog();
    await fillAndSubmit("existing-sound");

    expect(
      screen.getByText("A file with this name already exists in your downloads folder"),
    ).toBeInTheDocument();
    expect(mockStartDownload).not.toHaveBeenCalled();
  });

  it("reads live store state — detects a job added after render but before React subscription re-renders", async () => {
    // Fill the form via userEvent (async — React re-renders normally during typing)
    renderDialog();
    await userEvent.type(
      screen.getByPlaceholderText("https://..."),
      "https://example.com/audio",
    );
    await userEvent.type(screen.getByPlaceholderText("my-sound"), "race-name");

    // Seed the store AFTER typing but immediately before submit, without waiting
    // for React's subscription to propagate the update. Then fire the click
    // synchronously (fireEvent, not userEvent) so no microtask yields occur
    // between the mutation and validate() running.
    const job = createMockDownloadJob({ outputName: "race-name", status: "queued" });
    useDownloadStore.setState({ jobs: { [job.id]: job } });
    fireEvent.click(screen.getByRole("button", { name: /download/i }));

    // If validate() read the React render snapshot it would see the pre-mutation
    // state (no jobs) and allow the submit. Reading .getState() catches it.
    expect(
      screen.getByText("A download with this name is already in progress"),
    ).toBeInTheDocument();
    expect(mockStartDownload).not.toHaveBeenCalled();
  });
});
