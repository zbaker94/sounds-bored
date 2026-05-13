import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadDownloadHistory, saveDownloadHistory } from "@/lib/downloads";
import { mockFs, mockPath, resetTauriMocks } from "@/test/tauri-mocks";
import { createMockDownloadJob } from "@/test/factories";
import { DOWNLOADS_FILE_NAME } from "@/lib/constants";

describe("loadDownloadHistory", () => {
  beforeEach(() => {
    resetTauriMocks();
    mockPath.appDataDir.mockResolvedValue("/app-data");
    mockPath.join.mockImplementation((...parts: string[]) => parts.join("/"));
  });

  it("returns [] when file does not exist", async () => {
    mockFs.exists.mockResolvedValue(false);

    const result = await loadDownloadHistory();

    expect(result).toEqual([]);
  });

  it("sweeps orphaned .tmp files even when the downloads file does not exist", async () => {
    const uuid = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    mockFs.exists.mockResolvedValue(false);
    mockFs.readDir.mockResolvedValue([
      { name: `${DOWNLOADS_FILE_NAME}.${uuid}.tmp` },
    ]);

    await loadDownloadHistory();

    expect(mockFs.readDir).toHaveBeenCalled();
    expect(mockFs.remove).toHaveBeenCalledWith(
      expect.stringContaining(`${DOWNLOADS_FILE_NAME}.${uuid}.tmp`),
    );
  });

  it("loads valid history and returns jobs", async () => {
    const job = createMockDownloadJob({ status: "completed" });
    mockFs.exists.mockResolvedValue(true);
    mockFs.readTextFile.mockResolvedValue(JSON.stringify([job]));

    const result = await loadDownloadHistory();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(job.id);
  });

  it("marks active jobs as failed on app restart", async () => {
    const queued = createMockDownloadJob({ status: "queued" });
    const downloading = createMockDownloadJob({ status: "downloading" });
    const completed = createMockDownloadJob({ status: "completed" });
    mockFs.exists.mockResolvedValue(true);
    mockFs.readTextFile.mockResolvedValue(
      JSON.stringify([queued, downloading, completed]),
    );

    const result = await loadDownloadHistory();

    expect(result[0]).toMatchObject({ id: queued.id, status: "failed", error: "Interrupted by app restart" });
    expect(result[1]).toMatchObject({ id: downloading.id, status: "failed", error: "Interrupted by app restart" });
    expect(result[2]).toMatchObject({ id: completed.id, status: "completed" });
  });

  it("recovers from invalid JSON — backs up corrupt file, writes fresh default, calls onCorruption", async () => {
    mockFs.exists.mockResolvedValue(true);
    mockFs.readTextFile.mockResolvedValue("not valid json {{{");
    mockFs.rename.mockResolvedValue(undefined);
    mockFs.writeTextFile.mockResolvedValue(undefined);
    const onCorruption = vi.fn();

    const result = await loadDownloadHistory({ onCorruption });

    expect(result).toEqual([]);
    expect(mockFs.rename).toHaveBeenCalledWith(
      `/app-data/SoundsBored/${DOWNLOADS_FILE_NAME}`,
      `/app-data/SoundsBored/${DOWNLOADS_FILE_NAME.replace(".json", ".corrupt.json")}`,
    );
    expect(mockFs.writeTextFile).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`/app-data/SoundsBored/${DOWNLOADS_FILE_NAME}\\.[0-9a-f-]{36}\\.tmp$`)),
      "[]",
    );
    expect(onCorruption).toHaveBeenCalledTimes(1);
    expect(onCorruption.mock.calls[0][0]).toContain("corrupt");
  });

  it("recovers from ZodError — backs up corrupt file, writes fresh default, calls onCorruption", async () => {
    mockFs.exists.mockResolvedValue(true);
    mockFs.readTextFile.mockResolvedValue(JSON.stringify([{ not: "a download job" }]));
    mockFs.rename.mockResolvedValue(undefined);
    mockFs.writeTextFile.mockResolvedValue(undefined);
    const onCorruption = vi.fn();

    const result = await loadDownloadHistory({ onCorruption });

    expect(result).toEqual([]);
    expect(mockFs.rename).toHaveBeenCalledWith(
      `/app-data/SoundsBored/${DOWNLOADS_FILE_NAME}`,
      `/app-data/SoundsBored/${DOWNLOADS_FILE_NAME.replace(".json", ".corrupt.json")}`,
    );
    expect(onCorruption).toHaveBeenCalledTimes(1);
    expect(onCorruption.mock.calls[0][0]).toContain("corrupt");
  });

  it("works without onCorruption callback — no crash when callback omitted", async () => {
    mockFs.exists.mockResolvedValue(true);
    mockFs.readTextFile.mockResolvedValue("not valid json {{{");
    mockFs.rename.mockResolvedValue(undefined);
    mockFs.writeTextFile.mockResolvedValue(undefined);

    const result = await loadDownloadHistory();

    expect(result).toEqual([]);
  });

  it("rethrows non-corruption I/O errors", async () => {
    mockFs.exists.mockResolvedValue(true);
    mockFs.readTextFile.mockRejectedValue(new Error("EPERM: permission denied"));

    await expect(loadDownloadHistory()).rejects.toThrow("EPERM: permission denied");
  });
});

describe("saveDownloadHistory", () => {
  beforeEach(() => {
    resetTauriMocks();
    mockPath.appDataDir.mockResolvedValue("/app-data");
    mockPath.join.mockImplementation((...parts: string[]) => parts.join("/"));
    mockFs.exists.mockResolvedValue(true);
  });

  it("writes jobs to downloads file atomically", async () => {
    const job = createMockDownloadJob({ status: "completed" });

    await saveDownloadHistory([job]);

    expect(mockFs.writeTextFile).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`/app-data/SoundsBored/${DOWNLOADS_FILE_NAME}\\.[0-9a-f-]{36}\\.tmp$`)),
      expect.stringContaining(job.id),
    );
    expect(mockFs.rename).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`/app-data/SoundsBored/${DOWNLOADS_FILE_NAME}\\.[0-9a-f-]{36}\\.tmp$`)),
      `/app-data/SoundsBored/${DOWNLOADS_FILE_NAME}`,
    );
  });

  it("writes an empty array when given no jobs", async () => {
    await saveDownloadHistory([]);

    const written = mockFs.writeTextFile.mock.calls[0][1] as string;
    expect(JSON.parse(written)).toEqual([]);
  });
});
