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
import { cn } from "@/lib/utils";
import type { DownloadJob } from "@/lib/schemas";

interface DownloadItemProps {
  job: DownloadJob;
}

function getDisplayName(job: DownloadJob): string {
  if (job.outputPath) {
    const segments = job.outputPath.split(/[\\/]/);
    return segments[segments.length - 1] ?? job.outputName;
  }
  return job.outputName;
}

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
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current!) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [active]);

  if (!active) return "";
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function DownloadItem({ job }: DownloadItemProps) {
  const { mutate: cancelDownload, isPending: isCancelling } =
    useCancelDownload();

  const isActive =
    job.status === "queued" ||
    job.status === "downloading" ||
    job.status === "processing";

  const elapsed = useElapsedTime(job.status === "processing");

  const displayName = getDisplayName(job);

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
            {job.status === "queued" && (
              <HugeiconsIcon
                icon={Loading03Icon}
                size={14}
                className="text-white/50 animate-spin"
              />
            )}
            {job.status === "downloading" && (
              <HugeiconsIcon
                icon={Loading03Icon}
                size={14}
                className="text-primary animate-spin"
              />
            )}
            {job.status === "processing" && (
              <HugeiconsIcon
                icon={Loading03Icon}
                size={14}
                className="text-primary animate-spin"
              />
            )}
            {job.status === "completed" && (
              <HugeiconsIcon
                icon={CheckmarkCircle01Icon}
                size={14}
                className="text-green-500"
              />
            )}
            {job.status === "failed" && (
              <HugeiconsIcon
                icon={Alert02Icon}
                size={14}
                className="text-destructive"
              />
            )}
            {job.status === "cancelled" && (
              <HugeiconsIcon
                icon={Cancel01Icon}
                size={14}
                className="text-white/30"
              />
            )}
          </motion.span>
        </AnimatePresence>
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span
          className={cn(
            "truncate",
            job.status === "cancelled" || job.status === "failed"
              ? "text-white/40"
              : "text-white/70"
          )}
        >
          {displayName}
        </span>

        {job.status === "queued" && (
          <span className="text-white/40">Queued</span>
        )}
        {job.status === "downloading" && (
          <div className="flex items-center gap-2">
            <Progress value={job.percent} className="flex-1 h-1.5" />
            <span className="text-white/40 shrink-0">
              {Math.round(job.percent)}%
              {job.speed ? ` · ${job.speed}` : ""}
              {job.eta && job.eta !== "00:00" ? ` · ETA ${job.eta}` : ""}
            </span>
          </div>
        )}
        {job.status === "processing" && (
          <span className="text-white/40">
            Converting to MP3{elapsed ? ` — ${elapsed}` : "..."}
          </span>
        )}
        {job.status === "failed" && job.error && (
          <span className="text-destructive/70 truncate">{job.error}</span>
        )}
        {job.status === "cancelled" && (
          <span className="text-white/30">Cancelled</span>
        )}
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
