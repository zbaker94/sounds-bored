import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockFs } from "@/test/tauri-mocks";

const mockAppDataDir = vi.fn();
const mockJoin = vi.fn((...paths: string[]) => paths.join("/"));

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: mockAppDataDir,
  join: mockJoin,
}));

vi.mock("@/lib/constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/constants")>()),
  APP_FOLDER: "SoundsBored",
}));

describe("logger", () => {
  beforeEach(async () => {
    vi.resetModules();
    mockAppDataDir.mockResolvedValue("/mock/appdata");
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeTextFile.mockResolvedValue(undefined);
  });

  it("creates the logs directory under the app data folder on init", async () => {
    const { initLogger } = await import("./logger");
    await initLogger();

    expect(mockFs.mkdir).toHaveBeenCalledWith("/mock/appdata/SoundsBored/logs", { recursive: true });
  });

  it("writes a line containing [INFO] and the message", async () => {
    const { initLogger, logInfo } = await import("./logger");
    await initLogger();

    logInfo("hello");
    await Promise.resolve();

    expect(mockFs.writeTextFile).toHaveBeenCalledTimes(1);
    const call = mockFs.writeTextFile.mock.calls[0];
    const line = call[1] as string;
    expect(line).toContain("[INFO]");
    expect(line).toContain("hello");
  });

  it("includes JSON-stringified data when provided", async () => {
    const { initLogger, logInfo } = await import("./logger");
    await initLogger();

    logInfo("hello", { key: "val" });
    await Promise.resolve();

    const line = mockFs.writeTextFile.mock.calls[0][1] as string;
    expect(line).toContain('{"key":"val"}');
  });

  it("logWarn writes [WARN]", async () => {
    const { initLogger, logWarn } = await import("./logger");
    await initLogger();

    logWarn("careful");
    await Promise.resolve();

    const line = mockFs.writeTextFile.mock.calls[0][1] as string;
    expect(line).toContain("[WARN]");
    expect(line).toContain("careful");
  });

  it("logError writes [ERROR]", async () => {
    const { initLogger, logError } = await import("./logger");
    await initLogger();

    logError("boom");
    await Promise.resolve();

    const line = mockFs.writeTextFile.mock.calls[0][1] as string;
    expect(line).toContain("[ERROR]");
    expect(line).toContain("boom");
  });

  it("is a no-op when initLogger has not been called", async () => {
    const { logInfo } = await import("./logger");

    logInfo("nothing");
    await Promise.resolve();

    expect(mockFs.writeTextFile).not.toHaveBeenCalled();
  });

  it("each line ends with a newline", async () => {
    const { initLogger, logInfo } = await import("./logger");
    await initLogger();

    logInfo("hello");
    await Promise.resolve();

    const line = mockFs.writeTextFile.mock.calls[0][1] as string;
    expect(line.endsWith("\n")).toBe(true);
  });

  it("appends to the file via { append: true }", async () => {
    const { initLogger, logInfo } = await import("./logger");
    await initLogger();

    logInfo("hello");
    await Promise.resolve();

    const opts = mockFs.writeTextFile.mock.calls[0][2];
    expect(opts).toEqual({ append: true });
  });

  it("uses an ISO-style filename with colons replaced by dashes", async () => {
    const { initLogger, logInfo } = await import("./logger");
    await initLogger();

    logInfo("hello");
    await Promise.resolve();

    const path = mockFs.writeTextFile.mock.calls[0][0] as string;
    expect(path).toMatch(
      /^\/mock\/appdata\/SoundsBored\/logs\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.log$/
    );
  });

  it("swallows errors thrown by writeTextFile (does not throw)", async () => {
    mockFs.writeTextFile.mockRejectedValue(new Error("disk full"));
    const { initLogger, logInfo } = await import("./logger");
    await initLogger();

    expect(() => logInfo("hello")).not.toThrow();
    await Promise.resolve();
  });

  it("calling initLogger twice sequentially does not open a second log file", async () => {
    const { initLogger } = await import("./logger");
    await initLogger();
    const firstCallCount = mockFs.mkdir.mock.calls.length;
    await initLogger();
    expect(mockFs.mkdir.mock.calls.length).toBe(firstCallCount);
  });

  it("calling initLogger concurrently only opens one log file", async () => {
    const { initLogger } = await import("./logger");
    await Promise.all([initLogger(), initLogger()]);
    expect(mockFs.mkdir).toHaveBeenCalledTimes(1);
  });

  it("logError serializes Error objects with message and stack", async () => {
    const { initLogger, logError } = await import("./logger");
    await initLogger();

    const err = new Error("something broke");
    logError("Operation failed", err);
    await Promise.resolve();

    const line = mockFs.writeTextFile.mock.calls[0][1] as string;
    expect(line).toContain("[ERROR]");
    expect(line).toContain("something broke");
    expect(line).toContain("stack");
  });
});
