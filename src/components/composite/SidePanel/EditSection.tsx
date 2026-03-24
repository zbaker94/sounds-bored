import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { FolderMusicIcon, PencilEdit01Icon } from "@hugeicons/core-free-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMd } from "@/hooks/useBreakpoint";
import { useMemo } from "react";
import { Kbd } from "@/components/ui/kbd";
import { modKey } from "@/lib/utils";
import { DrawerDialog } from "@/components/ui/drawer-dialog";
import gibbering from "@/assets/gibbering.gif";
import { SoundsPanel } from "./SoundsPanel";
import { useUiStore, OVERLAY_ID } from "@/state/uiStore";

export function EditSection() {
  const isMd = useIsMd();
  const tooltipSide = useMemo(() => (isMd ? "left" : "top"), [isMd]);
  const soundsOpen = useUiStore((s) => s.isOverlayOpen(OVERLAY_ID.SOUNDS_PANEL));
  const openOverlay = useUiStore((s) => s.openOverlay);
  const closeOverlay = useUiStore((s) => s.closeOverlay);

  return (
    <div className="flex flex-row items-center p-1 gap-2 md:flex-col">
      <DrawerDialog
        open={soundsOpen}
        onOpenChange={(open) =>
          open ? openOverlay(OVERLAY_ID.SOUNDS_PANEL, "dialog") : closeOverlay(OVERLAY_ID.SOUNDS_PANEL)
        }
        title="Sounds"
        content={<SoundsPanel />}
        footer={null}
        classNames={{
          content: "!max-w-[98vw] h-[95vh] grid-rows-[auto_1fr]",
          title: "[font-family:DeathLetter] tracking-wider text-2xl text-white",
        }}
        styles={{
          title: {color: "white", backdropFilter: "blur(18px)"},
          content: { backgroundImage: `url(${gibbering})`, backgroundRepeat: "repeat" },
        }}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="default"
            size="icon"
            className="size-11 md:size-9"
            onClick={() => openOverlay(OVERLAY_ID.SOUNDS_PANEL, "dialog")}
          >
            <HugeiconsIcon icon={FolderMusicIcon} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side={tooltipSide}>
          <p>Manage Sounds</p>
          <Kbd>{modKey}+Shift+M</Kbd>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="default" size="icon" className="size-11 md:size-9">
            <HugeiconsIcon icon={PencilEdit01Icon} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side={tooltipSide}>
          <p>Toggle Edit Mode</p>
          <Kbd>{modKey}+E</Kbd>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
