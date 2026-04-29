import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { startDownload, cancelDownload } from "@/lib/ytdlp";
import { useDownloadStore } from "@/state/downloadStore";
import type { DownloadJob } from "@/lib/schemas";

type StartDownloadInput = {
  url: string;
  outputName: string;
  downloadFolderPath: string;
  jobId: string;
  tags?: string[];
  sets?: string[];
};

export function useStartDownload() {
  const addJob = useDownloadStore((s) => s.addJob);
  const updateJob = useDownloadStore((s) => s.updateJob);

  return useMutation({
    mutationFn: ({ url, outputName, downloadFolderPath, jobId }: StartDownloadInput) =>
      startDownload(url, outputName, downloadFolderPath, jobId),
    onMutate: ({ url, outputName, jobId, tags = [], sets = [] }: StartDownloadInput) => {
      const job: DownloadJob = {
        id: jobId,
        url,
        outputName,
        status: "queued",
        percent: 0,
        tags,
        sets,
      };
      addJob(job);
    },
    onError: (error, { jobId }) => {
      toast.error("Failed to start download", { description: error.message });
      updateJob(jobId, { status: "failed", error: error.message });
    },
  });
}

export function useCancelDownload() {
  const updateJob = useDownloadStore((s) => s.updateJob);

  return useMutation({
    mutationFn: (jobId: string) => cancelDownload(jobId),
    onSuccess: (_data, jobId) => {
      updateJob(jobId, { status: "cancelled" });
    },
    onError: (error) => {
      toast.error("Failed to cancel download", { description: error.message });
    },
  });
}

