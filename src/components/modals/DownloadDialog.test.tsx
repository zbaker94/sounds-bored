import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DownloadDialog } from "./DownloadDialog";
import { useDownloadStore, initialDownloadState } from "@/state/downloadStore";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { useAppSettingsStore, initialAppSettingsState } from "@/state/appSettingsStore";
import {
  createMockAppSettings,
  createMockDownloadJob,
  createMockSet,
  createMockSound,
  createMockTag,
} from "@/test/factories";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockStartDownload = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/ytdlp.queries", () => ({
  useStartDownload: vi.fn(() => ({
    mutateAsync: mockStartDownload,
    isPending: false,
  })),
}));

// Created at module scope so tests in nested describe blocks can reference
// mockSettings.downloadFolderId. The factory returns a fresh object each call
// so state cannot leak; beforeEach resets the store with a fresh instance.
const mockSettings = createMockAppSettings();

function renderDialog(open = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DownloadDialog open={open} onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStartDownload.mockResolvedValue(undefined);
  useLibraryStore.setState({ ...initialLibraryState });
  useDownloadStore.setState({ ...initialDownloadState });
  useAppSettingsStore.setState({ ...initialAppSettingsState, settings: mockSettings });
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

describe("DownloadDialog — tags and sets pre-selection", () => {
  async function fillRequiredFields() {
    await userEvent.type(
      screen.getByPlaceholderText("https://..."),
      "https://example.com/audio",
    );
    await userEvent.type(screen.getByPlaceholderText("my-sound"), "my-sound");
  }

  it("renders the Tags label and combobox when tags exist in the library", () => {
    const tagA = createMockTag({ name: "drums" });
    const tagB = createMockTag({ name: "synth" });
    useLibraryStore.setState({ ...initialLibraryState, tags: [tagA, tagB] });

    renderDialog();

    expect(screen.getByText("Tags")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Search or create tags..."),
    ).toBeInTheDocument();
  });

  it("renders the Sets label and combobox when sets exist in the library", () => {
    const setA = createMockSet({ name: "Intro" });
    const setB = createMockSet({ name: "Outro" });
    useLibraryStore.setState({ ...initialLibraryState, sets: [setA, setB] });

    renderDialog();

    expect(screen.getByText("Sets")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Search or create sets..."),
    ).toBeInTheDocument();
  });

  it("passes selected tag IDs to startDownload when submitted", async () => {
    const tagA = createMockTag({ name: "drums" });
    useLibraryStore.setState({ ...initialLibraryState, tags: [tagA] });

    renderDialog();
    await fillRequiredFields();

    // Open the tag combobox via its input (Base UI opens on focus/click).
    const tagInput = screen.getByPlaceholderText("Search or create tags...");
    await userEvent.click(tagInput);

    // Base UI renders options in a portal once the popup is open.
    // Use findBy to wait for the portal to mount.
    const tagItem = await screen.findByRole("option", { name: /drums/i });
    await act(async () => {
      fireEvent.click(tagItem);
    });

    // Close the combobox popup so it doesn't mark the dialog's form as inert.
    await userEvent.keyboard("{Escape}");

    await userEvent.click(
      screen.getByRole("button", { name: /^download$/i }),
    );

    expect(mockStartDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: [tagA.id],
      }),
    );
  });

  it("passes selected set IDs to startDownload when submitted", async () => {
    const setA = createMockSet({ name: "Intro" });
    useLibraryStore.setState({ ...initialLibraryState, sets: [setA] });

    renderDialog();
    await fillRequiredFields();

    const setInput = screen.getByPlaceholderText("Search or create sets...");
    await userEvent.click(setInput);

    const setItem = await screen.findByRole("option", { name: /intro/i });
    await act(async () => {
      fireEvent.click(setItem);
    });

    await userEvent.keyboard("{Escape}");

    await userEvent.click(
      screen.getByRole("button", { name: /^download$/i }),
    );

    expect(mockStartDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        sets: [setA.id],
      }),
    );
  });

  it("passes empty tags and sets arrays when none are selected", async () => {
    renderDialog();
    await fillRequiredFields();

    await userEvent.click(screen.getByRole("button", { name: /download/i }));

    expect(mockStartDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: [],
        sets: [],
      }),
    );
  });

  it("shows empty state in combobox when library has no tags", async () => {
    renderDialog();

    const tagInput = screen.getByPlaceholderText("Search or create tags...");
    await userEvent.click(tagInput);

    expect(await screen.findByText("No tags found.")).toBeInTheDocument();
  });

  it("shows empty state in combobox when library has no sets", async () => {
    renderDialog();

    const setInput = screen.getByPlaceholderText("Search or create sets...");
    await userEvent.click(setInput);

    expect(await screen.findByText("No sets found.")).toBeInTheDocument();
  });

  it("shows Create option when typing a novel tag name and creates the tag on click", async () => {
    renderDialog();

    const tagInput = screen.getByPlaceholderText("Search or create tags...");
    await userEvent.click(tagInput);
    await userEvent.type(tagInput, "brand-new-tag");

    const createItem = await screen.findByRole("option", { name: /create "brand-new-tag"/i });
    await act(async () => { fireEvent.click(createItem); });

    expect(useLibraryStore.getState().tags.some((t) => t.name === "brand-new-tag")).toBe(true);
  });

  it("shows Create option when typing a novel set name and creates the set on click", async () => {
    renderDialog();

    const setInput = screen.getByPlaceholderText("Search or create sets...");
    await userEvent.click(setInput);
    await userEvent.type(setInput, "brand-new-set");

    const createItem = await screen.findByRole("option", { name: /create "brand-new-set"/i });
    await act(async () => { fireEvent.click(createItem); });

    expect(useLibraryStore.getState().sets.some((s) => s.name === "brand-new-set")).toBe(true);
  });

  it("does not show Create option when input matches an existing tag (case-insensitive)", async () => {
    const tag = createMockTag({ name: "Drums" });
    useLibraryStore.setState({ ...initialLibraryState, tags: [tag] });
    renderDialog();

    const tagInput = screen.getByPlaceholderText("Search or create tags...");
    await userEvent.click(tagInput);
    await userEvent.type(tagInput, "drums");

    expect(screen.queryByRole("option", { name: /create "drums"/i })).not.toBeInTheDocument();
  });

  it("clears selected tags and sets when dialog is cancelled", async () => {
    const tag = createMockTag({ name: "drums" });
    const set = createMockSet({ name: "intro" });
    useLibraryStore.setState({ ...initialLibraryState, tags: [tag], sets: [set] });
    renderDialog();

    const tagInput = screen.getByPlaceholderText("Search or create tags...");
    await userEvent.click(tagInput);
    const tagItem = await screen.findByRole("option", { name: /drums/i });
    await act(async () => { fireEvent.click(tagItem); });
    await userEvent.keyboard("{Escape}");

    expect(screen.getByText("drums")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.queryByText("drums")).not.toBeInTheDocument();
  });

  it("keeps the dialog open and fields populated when startDownload rejects", async () => {
    mockStartDownload.mockRejectedValue(new Error("sidecar failed"));
    const onOpenChange = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <DownloadDialog open onOpenChange={onOpenChange} />
      </QueryClientProvider>,
    );

    await userEvent.type(screen.getByPlaceholderText("https://..."), "https://example.com/audio");
    await userEvent.type(screen.getByPlaceholderText("my-sound"), "my-sound");
    await userEvent.click(screen.getByRole("button", { name: /download/i }));

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText("https://...")).toHaveValue("https://example.com/audio");
    expect(screen.getByPlaceholderText("my-sound")).toHaveValue("my-sound");
  });

  it("clears selected tags and sets after successful submit", async () => {
    const tag = createMockTag({ name: "drums" });
    const set = createMockSet({ name: "intro" });
    useLibraryStore.setState({ ...initialLibraryState, tags: [tag], sets: [set] });
    renderDialog();
    await fillRequiredFields();

    const tagInput = screen.getByPlaceholderText("Search or create tags...");
    await userEvent.click(tagInput);
    const tagItem = await screen.findByRole("option", { name: /drums/i });
    await act(async () => { fireEvent.click(tagItem); });
    await userEvent.keyboard("{Escape}");

    const setInput = screen.getByPlaceholderText("Search or create sets...");
    await userEvent.click(setInput);
    const setItem = await screen.findByRole("option", { name: /intro/i });
    await act(async () => { fireEvent.click(setItem); });
    await userEvent.keyboard("{Escape}");

    expect(screen.getByText("drums")).toBeInTheDocument();
    expect(screen.getByText("intro")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^download$/i }));

    expect(screen.queryByText("drums")).not.toBeInTheDocument();
    expect(screen.queryByText("intro")).not.toBeInTheDocument();
  });
});
