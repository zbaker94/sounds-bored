import { useMemo } from "react";
import { useDownloadStore } from "@/state/downloadStore";
import { DownloadItem } from "./DownloadItem";
import type { DownloadStatus } from "@/lib/schemas";

const ACTIVE_STATUSES: DownloadStatus[] = [
  "queued",
  "downloading",
  "processing",
];

export function DownloadManager() {
  const jobs = useDownloadStore((s) => s.jobs);

  const sortedJobs = useMemo(() => {
    const all = Object.values(jobs);
    const active = all.filter((j) =>
      ACTIVE_STATUSES.includes(j.status),
    );
    const inactive = all.filter(
      (j) => !ACTIVE_STATUSES.includes(j.status),
    );
    return [...active, ...inactive];
  }, [jobs]);

  if (sortedJobs.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-white/40 px-2">
        Downloads
      </span>
      {sortedJobs.map((job) => (
        <DownloadItem key={job.id} job={job} />
      ))}
    </div>
  );
}
