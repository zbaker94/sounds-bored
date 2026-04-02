import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { DownloadProgressEventSchema, type DownloadProgressEvent } from "@/lib/schemas";
import { DOWNLOAD_EVENT } from "@/lib/constants";

export async function startDownload(
  url: string,
  outputName: string,
  downloadFolderPath: string,
  jobId: string
): Promise<void> {
  await invoke<void>("start_download", { url, outputName, downloadFolderPath, jobId });
}

export async function cancelDownload(jobId: string): Promise<void> {
  await invoke<void>("cancel_download", { jobId });
}

export async function listenToDownloadEvents(
  onEvent: (event: DownloadProgressEvent) => void
): Promise<UnlistenFn> {
  return await listen<unknown>(DOWNLOAD_EVENT, (event) => {
    const parsed = DownloadProgressEventSchema.safeParse(event.payload);
    if (parsed.success) {
      onEvent(parsed.data);
    }
  });
}
