import { HugeiconsIcon } from "@hugeicons/react";
import { Loading03Icon, Download04Icon } from "@hugeicons/core-free-icons";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { ButtonGroup, ButtonGroupSeparator } from "@/components/ui/button-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDownloadStore, ACTIVE_STATUSES } from "@/state/downloadStore";
import { DownloadManager } from "./DownloadManager";

interface DownloadButtonProps {
  onOpenDialog: () => void;
}

export function DownloadButton({ onOpenDialog }: DownloadButtonProps) {
  const { hasJobs, hasActive, activeCount } = useDownloadStore(
    useShallow((s) => {
      const all = Object.values(s.jobs);
      const active = all.filter((j) => ACTIVE_STATUSES.has(j.status));
      return {
        hasJobs: all.length > 0,
        hasActive: active.length > 0,
        activeCount: active.length,
      };
    }),
  );

  return (
    <Popover>
      <ButtonGroup>
        <PopoverTrigger asChild>
          <Button variant="secondary" size="icon-sm" aria-label="Download status" className="relative">
            <HugeiconsIcon
              icon={hasActive ? Loading03Icon : Download04Icon}
              size={14}
              className={hasActive ? "animate-spin" : undefined}
            />
            {activeCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-bold leading-none text-primary-foreground">
                {activeCount > 9 ? "9+" : activeCount}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <ButtonGroupSeparator />
        <Button variant="secondary" size="sm" onClick={onOpenDialog}>
          Download from URL
        </Button>
      </ButtonGroup>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-80 p-2 gap-0 bg-zinc-900 text-white border-white/10"
      >
        {hasJobs ? (
          <DownloadManager />
        ) : (
          <p className="text-xs text-white/40 px-2 py-1">No downloads yet</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
