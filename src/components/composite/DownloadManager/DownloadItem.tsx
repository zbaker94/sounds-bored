import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Loading03Icon,
  CheckmarkCircle01Icon,
  Alert02Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCancelDownload } from "@/lib/ytdlp.queries";
import { ACTIVE_STATUSES } from "@/state/downloadStore";
import { basename, cn } from "@/lib/utils";
import type { DownloadJob } from "@/lib/schemas";

interface DownloadItemProps {
  job: DownloadJob;
}

const STATUS_ICON: Record<DownloadJob["status"], { icon: typeof Loading03Icon; className: string }> = {
  queued:      { icon: Loading03Icon,         className: "text-white/50 animate-spin" },
  downloading: { icon: Loading03Icon,         className: "text-primary animate-spin" },
  processing:  { icon: Loading03Icon,         className: "text-primary animate-spin" },
  completed:   { icon: CheckmarkCircle01Icon, className: "text-green-500" },
  failed:      { icon: Alert02Icon,           className: "text-destructive" },
  cancelled:   { icon: Cancel01Icon,          className: "text-white/30" },
};

function useElapsedTime(active: boolean): string {
  const startRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active) {
      startRef.current = null;
      setElapsed(0);
      return;
    }
    if (startRef.current === null) {
      startRef.current = Date.now();
    }
    const start = startRef.current!;
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [active]);

  if (!active) return "";
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function StatusDetail({ job, elapsed }: { job: DownloadJob; elapsed: string }) {
  if (job.status === "queued") return <span className="text-white/40">Queued</span>;
  if (job.status === "downloading") return (
    <div className="flex items-center gap-2">
      <Progress value={job.percent} className="flex-1 h-1.5" />
      <span className="text-white/40 shrink-0">
        {Math.round(job.percent)}%
        {job.speed ? ` · ${job.speed}` : ""}
        {job.eta && job.eta !== "00:00" ? ` · ETA ${job.eta}` : ""}
      </span>
    </div>
  );
  if (job.status === "processing") return (
    <span className="text-white/40">Converting to MP3{elapsed ? ` — ${elapsed}` : "..."}</span>
  );
  if (job.status === "failed" && job.error) return (
    <span className="text-destructive/70 truncate">{job.error}</span>
  );
  if (job.status === "cancelled") return <span className="text-white/30">Cancelled</span>;
  return null;
}

export function DownloadItem({ job }: DownloadItemProps) {
  const { mutate: cancelDownload, isPending: isCancelling } =
    useCancelDownload();

  const isActive = ACTIVE_STATUSES.has(job.status);
  const elapsed = useElapsedTime(job.status === "processing");

  const displayName =
    job.outputPath && !/[\\/]$/.test(job.outputPath)
      ? basename(job.outputPath, job.outputName)
      : job.outputName;

  const { icon, className: iconClass } = STATUS_ICON[job.status];
  const isInactive = job.status === "cancelled" || job.status === "failed";

  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded text-xs">
      <div className="shrink-0">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={job.status}
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={{ duration: 0.12 }}
            style={{ display: "inline-flex" }}
          >
            <HugeiconsIcon icon={icon} size={14} className={iconClass} />
          </motion.span>
        </AnimatePresence>
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className={cn("truncate", isInactive ? "text-white/40" : "text-white/70")}>
          {displayName}
        </span>
        <StatusDetail job={job} elapsed={elapsed} />
      </div>

      {isActive && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="secondary"
              size="icon-xs"
              className="shrink-0"
              onClick={() => cancelDownload(job.id)}
              disabled={isCancelling}
            >
              <HugeiconsIcon icon={Cancel01Icon} size={12} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Cancel download</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
