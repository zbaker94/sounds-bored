import { HugeiconsIcon } from "@hugeicons/react";
import { Loading03Icon, Download04Icon } from "@hugeicons/core-free-icons";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDownloadStore, ACTIVE_STATUSES } from "@/state/downloadStore";
import { DownloadManager } from "./DownloadManager";

export function DownloadStatusButton() {
  const { hasJobs, hasActive } = useDownloadStore(
    useShallow((s) => {
      const all = Object.values(s.jobs);
      return {
        hasJobs: all.length > 0,
        hasActive: all.some((j) => ACTIVE_STATUSES.has(j.status)),
      };
    }),
  );

  if (!hasJobs) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="icon-sm" aria-label="Download status">
          <HugeiconsIcon
            icon={hasActive ? Loading03Icon : Download04Icon}
            size={14}
            className={hasActive ? "animate-spin" : undefined}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-80 p-2 gap-0">
        <DownloadManager />
      </PopoverContent>
    </Popover>
  );
}
