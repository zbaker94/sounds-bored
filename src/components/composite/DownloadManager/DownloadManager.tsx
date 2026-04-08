import { useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
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

  return (
    <AnimatePresence>
      {sortedJobs.length > 0 && (
        <motion.div
          key="download-manager"
          className="flex flex-col gap-0.5"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.2 }}
        >
          <span className="text-[10px] uppercase tracking-wider text-white/40 px-2">
            Downloads
          </span>
          <AnimatePresence initial={false}>
            {sortedJobs.map((job) => (
              <motion.div
                key={job.id}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.15 }}
                style={{ overflow: "hidden" }}
              >
                <DownloadItem job={job} />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
