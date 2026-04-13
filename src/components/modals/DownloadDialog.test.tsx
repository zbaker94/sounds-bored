import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DownloadDialog } from "./DownloadDialog";
import { useDownloadStore } from "@/state/downloadStore";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { createMockAppSettings } from "@/test/factories";
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
  useDownloadStore.setState({ jobs: {} });
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
