import { describe, it, expect, vi, beforeEach } from "vitest";
import { listenToDownloadEvents } from "./ytdlp";
import { mockEvent } from "@/test/tauri-mocks";
import { DOWNLOAD_EVENT } from "@/lib/constants";
import type { DownloadProgressEvent } from "@/lib/schemas";

beforeEach(() => {
  vi.clearAllMocks();
  mockEvent.listen.mockReturnValue(Promise.resolve(vi.fn()));
});

/**
 * Simulate a Rust-emitted event by capturing the listener callback registered
 * via `listen()` and invoking it with the supplied payload.
 */
async function emitPayload(payload: unknown): Promise<void> {
  // listenToDownloadEvents calls listen(); grab the callback it passed
  const calls = mockEvent.listen.mock.calls as unknown as Array<[string, (e: { payload: unknown }) => void]>;
  const callback = calls[0][1];
  callback({ payload });
}

describe("listenToDownloadEvents", () => {
  it("registers a listener for the DOWNLOAD_EVENT channel", async () => {
    const onEvent = vi.fn();
    await listenToDownloadEvents(onEvent);
    expect(mockEvent.listen).toHaveBeenCalledWith(DOWNLOAD_EVENT, expect.any(Function));
  });

  it("calls onEvent with parsed data for a valid payload", async () => {
    const onEvent = vi.fn();
    await listenToDownloadEvents(onEvent);

    const validPayload: DownloadProgressEvent = {
      id: "job-1",
      percent: 42,
      status: "downloading",
    };
    await emitPayload(validPayload);

    expect(onEvent).toHaveBeenCalledWith(validPayload);
  });

  it("does not call onEvent when the payload fails schema validation", async () => {
    const onEvent = vi.fn();
    await listenToDownloadEvents(onEvent);

    await emitPayload({ id: "job-1", percent: 42, status: "unknown-future-status" });

    expect(onEvent).not.toHaveBeenCalled();
  });

  it("logs a console.error when the payload fails schema validation", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onEvent = vi.fn();
    await listenToDownloadEvents(onEvent);

    await emitPayload({ id: "job-1", percent: 42, status: "new-status-from-rust" });

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("DownloadProgressEvent"),
      expect.objectContaining({ issues: expect.any(Array) }),
      "payload:",
      expect.anything(),
    );
    errorSpy.mockRestore();
  });

  it("does not log console.error for a valid payload", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onEvent = vi.fn();
    await listenToDownloadEvents(onEvent);

    await emitPayload({ id: "job-1", percent: 100, status: "completed", outputPath: "/path/to/file.mp3" });

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("validates a representative sample of Rust-emitted status values", async () => {
    const statuses: DownloadProgressEvent["status"][] = [
      "queued", "downloading", "processing", "completed", "failed", "cancelled",
    ];

    for (const status of statuses) {
      const onEvent = vi.fn();
      mockEvent.listen.mockClear();
      mockEvent.listen.mockReturnValue(Promise.resolve(vi.fn()));
      await listenToDownloadEvents(onEvent);

      const payload: DownloadProgressEvent = { id: `job-${status}`, percent: 0, status };
      await emitPayload(payload);

      expect(onEvent).toHaveBeenCalledWith(payload);
    }
  });

  it("does not call onEvent for a null payload", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onEvent = vi.fn();
    await listenToDownloadEvents(onEvent);

    await emitPayload(null);

    expect(onEvent).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
