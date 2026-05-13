import { appDataDir, join } from "@tauri-apps/api/path";
import { exists } from "@tauri-apps/plugin-fs";
import { z } from "zod";
import { DownloadJobSchema } from "./schemas";
import { atomicWriteJson, loadJsonWithRecovery, sweepOrphanedTmpFiles } from "./fsUtils";
import { APP_FOLDER, DOWNLOADS_FILE_NAME } from "./constants";
import { ACTIVE_STATUSES } from "@/state/downloadStore";

const DownloadHistorySchema = z.array(DownloadJobSchema);

interface LoadDownloadHistoryOptions {
  onCorruption?: (message: string) => void;
}

async function getDownloadsFilePath(): Promise<string> {
  const dir = await appDataDir();
  return join(dir, APP_FOLDER, DOWNLOADS_FILE_NAME);
}

export async function loadDownloadHistory(options?: LoadDownloadHistoryOptions) {
  const filePath = await getDownloadsFilePath();
  await sweepOrphanedTmpFiles(filePath);
  if (!(await exists(filePath))) return [];

  const jobs = await loadJsonWithRecovery({
    path: filePath,
    parse: (raw) => DownloadHistorySchema.parse(raw),
    defaults: [] as z.infer<typeof DownloadHistorySchema>,
    onCorruption: options?.onCorruption,
    corruptMessage: `${DOWNLOADS_FILE_NAME} was corrupt and has been reset. Your download history has been cleared.`,
    sweep: false,
  });
  // Any non-terminal job was interrupted by app restart — mark it failed.
  return jobs.map((job) =>
    ACTIVE_STATUSES.has(job.status)
      ? { ...job, status: "failed" as const, error: "Interrupted by app restart" }
      : job,
  );
}

export async function saveDownloadHistory(jobs: Parameters<typeof DownloadHistorySchema.parse>[0]): Promise<void> {
  const filePath = await getDownloadsFilePath();
  await atomicWriteJson(filePath, jobs);
}
