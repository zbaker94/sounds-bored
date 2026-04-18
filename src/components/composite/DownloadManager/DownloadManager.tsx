import { useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useDownloadStore, ACTIVE_STATUSES } from "@/state/downloadStore";
import { DownloadItem } from "./DownloadItem";

export function DownloadManager() {
  const jobs = useDownloadStore((s) => s.jobs);

  const sortedJobs = useMemo(() => {
    const all = Object.values(jobs);
    const active = all.filter((j) => ACTIVE_STATUSES.has(j.status));
    const inactive = all.filter((j) => !ACTIVE_STATUSES.has(j.status));
    return [...active, ...inactive];
  }, [jobs]);

  return (
    <motion.div
      className="flex flex-col gap-0.5"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
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
  );
}
