import { useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { startDownload, cancelDownload, listenToDownloadEvents } from "@/lib/ytdlp";
import { useDownloadStore } from "@/state/downloadStore";
import { useLibraryStore } from "@/state/libraryStore";
import type { DownloadJob } from "@/lib/schemas";

export function useStartDownload() {
  const addJob = useDownloadStore((s) => s.addJob);
  const updateJob = useDownloadStore((s) => s.updateJob);

  return useMutation({
    mutationFn: ({
      url,
      outputName,
      downloadFolderPath,
      jobId,
    }: {
      url: string;
      outputName: string;
      downloadFolderPath: string;
      jobId: string;
    }) => startDownload(url, outputName, downloadFolderPath, jobId),
    onMutate: ({ url, outputName, jobId }) => {
      const job: DownloadJob = {
        id: jobId,
        url,
        outputName,
        status: "queued",
        percent: 0,
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

export function useDownloadEventListener(downloadFolderId?: string) {
  const updateJob = useDownloadStore((s) => s.updateJob);
  const updateLibrary = useLibraryStore((s) => s.updateLibrary);

  // Keep a ref so the callback always reads the latest value without
  // needing to be in the effect dependency array (which would cause
  // the listener to be torn down and re-created every time settings load,
  // risking a gap where the unlisten promise hasn't resolved yet).
  const downloadFolderIdRef = useRef(downloadFolderId);
  useEffect(() => {
    downloadFolderIdRef.current = downloadFolderId;
  }, [downloadFolderId]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    listenToDownloadEvents((event) => {
      updateJob(event.id, {
        status: event.status,
        percent: event.percent,
        ...(event.speed !== undefined && { speed: event.speed }),
        ...(event.eta !== undefined && { eta: event.eta }),
        ...(event.error !== undefined && { error: event.error }),
        ...(event.outputPath !== undefined && { outputPath: event.outputPath }),
      });

      if (event.status === "completed" && event.outputPath) {
        const jobs = useDownloadStore.getState().jobs;
        const job = jobs[event.id];
        // Guard against duplicate completion events adding the sound twice
        if (job?.soundId) return;
        const soundId = crypto.randomUUID();
        updateLibrary((draft) => {
          draft.sounds.push({
            id: soundId,
            name: job?.outputName ?? "Downloaded Sound",
            filePath: event.outputPath,
            folderId: downloadFolderIdRef.current,
            sourceUrl: job?.url,
            tags: [],
            sets: [],
          });
        });
        updateJob(event.id, { soundId });
        toast.success("Download complete", { description: job?.outputName });
      }

      if (event.status === "failed") {
        const jobs = useDownloadStore.getState().jobs;
        const job = jobs[event.id];
        toast.error("Download failed", { description: job?.outputName ?? event.error });
      }
    }).then((fn) => {
      // If the effect already cleaned up before this promise resolved,
      // immediately invoke the unlisten function instead of storing it.
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [updateJob, updateLibrary]); // downloadFolderId intentionally omitted — read via ref
}
