import { useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { stat } from "@tauri-apps/plugin-fs";
import { startDownload, cancelDownload, listenToDownloadEvents } from "@/lib/ytdlp";
import { useDownloadStore } from "@/state/downloadStore";
import type { DownloadJobUpdate } from "@/state/downloadStore";
import { useLibraryStore } from "@/state/libraryStore";
import type { DownloadJob, DownloadProgressEvent } from "@/lib/schemas";

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

/**
 * Converts a raw DownloadProgressEvent into a typed DownloadJobUpdate.
 * Each status variant maps to the exact fields that variant requires,
 * ensuring the store always receives a well-formed update.
 */
function buildJobUpdate(event: DownloadProgressEvent): DownloadJobUpdate {
  switch (event.status) {
    case "completed":
      // If the sidecar emits "completed" without an output path the file cannot
      // be used — treat as a failed download rather than storing an empty path.
      if (!event.outputPath) {
        return { status: "failed", error: "Download completed but no output path was reported" };
      }
      return { status: "completed", percent: event.percent, outputPath: event.outputPath };
    case "failed":
      return { status: "failed", error: event.error ?? "Unknown error" };
    case "cancelled":
      return { status: "cancelled" };
    case "downloading":
      return { status: "downloading", percent: event.percent, speed: event.speed, eta: event.eta };
    case "processing":
      return { status: "processing", percent: event.percent, speed: event.speed, eta: event.eta };
    case "queued":
      return { status: "queued" };
    default: {
      const _exhaustive: never = event.status;
      throw new Error(`Unhandled download status: ${_exhaustive}`);
    }
  }
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
      updateJob(event.id, buildJobUpdate(event));

      if (event.status === "completed" && event.outputPath) {
        const outputPath = event.outputPath;
        const eventId = event.id;
        (async () => {
          const jobs = useDownloadStore.getState().jobs;
          const job = jobs[eventId];
          // Guard against duplicate completion events adding the sound twice
          if (job?.soundId) return;
          const soundId = crypto.randomUUID();

          let fileSizeBytes: number | undefined;
          try {
            const statResult = await stat(outputPath);
            fileSizeBytes = statResult.size;
          } catch {
            // file stat failed — proceed without size
          }

          updateLibrary((draft) => {
            draft.sounds.push({
              id: soundId,
              name: job?.outputName ?? "Downloaded Sound",
              filePath: outputPath,
              folderId: downloadFolderIdRef.current,
              sourceUrl: job?.url,
              tags: [],
              sets: [],
              ...(fileSizeBytes !== undefined && { fileSizeBytes }),
            });
          });
          updateJob(eventId, { soundId });
          toast.success("Download complete", { description: job?.outputName });
        })().catch((err: unknown) => {
          toast.error("Failed to finalize download", {
            description: err instanceof Error ? err.message : String(err),
          });
        });
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
    }).catch((err: unknown) => {
      toast.error("Failed to start download listener", {
        description: err instanceof Error ? err.message : String(err),
      });
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [updateJob, updateLibrary]); // downloadFolderId intentionally omitted — read via ref
}
