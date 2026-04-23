import { appDataDir, join } from "@tauri-apps/api/path";
import { readTextFile, exists } from "@tauri-apps/plugin-fs";
import { z } from "zod";
import { DownloadJobSchema } from "./schemas";
import { atomicWriteJson } from "./fsUtils";
import { APP_FOLDER, DOWNLOADS_FILE_NAME } from "./constants";
import { ACTIVE_STATUSES } from "@/state/downloadStore";

const DownloadHistorySchema = z.array(DownloadJobSchema);

async function getDownloadsFilePath(): Promise<string> {
  const dir = await appDataDir();
  return join(dir, APP_FOLDER, DOWNLOADS_FILE_NAME);
}

export async function loadDownloadHistory() {
  const filePath = await getDownloadsFilePath();
  if (!(await exists(filePath))) return [];

  try {
    const text = await readTextFile(filePath);
    const parsed = DownloadHistorySchema.parse(JSON.parse(text));
    // Any non-terminal job was interrupted by app restart — mark it failed.
    return parsed.map((job) =>
      ACTIVE_STATUSES.has(job.status)
        ? { ...job, status: "failed" as const, error: "Interrupted by app restart" }
        : job,
    );
  } catch {
    return [];
  }
}

export async function saveDownloadHistory(jobs: Parameters<typeof DownloadHistorySchema.parse>[0]): Promise<void> {
  const filePath = await getDownloadsFilePath();
  await atomicWriteJson(filePath, jobs);
}
