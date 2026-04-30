import { appLogDir, join } from "@tauri-apps/api/path";
import { mkdir, writeTextFile } from "@tauri-apps/plugin-fs";

type LogLevel = "INFO" | "WARN" | "ERROR";

let logFilePath: string | null = null;
let initPromise: Promise<void> | null = null;

export function initLogger(): Promise<void> {
  if (initPromise !== null) return initPromise;
  initPromise = (async () => {
    const logsDir = await appLogDir();
    await mkdir(logsDir, { recursive: true });
    // Replace colons so the filename is valid on Windows.
    const filename = `${new Date().toISOString().replace(/:/g, "-")}.log`;
    logFilePath = await join(logsDir, filename);
  })();
  return initPromise;
}

function writeLog(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  if (logFilePath === null) return;
  const path = logFilePath;
  const timestamp = new Date().toISOString();
  const suffix = data !== undefined ? ` ${JSON.stringify(data)}` : "";
  const line = `[${timestamp}] [${level}] ${message}${suffix}\n`;
  // Fire-and-forget: never throw from a log call.
  void writeTextFile(path, line, { append: true }).catch(() => {});
}

export function logInfo(message: string, data?: Record<string, unknown>): void {
  writeLog("INFO", message, data);
}

export function logWarn(message: string, data?: Record<string, unknown>): void {
  writeLog("WARN", message, data);
}

export function logError(message: string, data?: Record<string, unknown> | Error): void {
  if (data instanceof Error) {
    writeLog("ERROR", message, { error: data.message, stack: data.stack ?? "" });
  } else {
    writeLog("ERROR", message, data);
  }
}
