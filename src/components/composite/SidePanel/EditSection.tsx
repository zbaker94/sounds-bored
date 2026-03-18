import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { FolderMusicIcon, PencilEdit01Icon } from "@hugeicons/core-free-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMd } from "@/hooks/useBreakpoint";
import { useMemo, useState } from "react";
import { Kbd } from "@/components/ui/kbd";
import { DrawerDialog } from "@/components/ui/drawer-dialog";
import gibbering from "@/assets/gibbering.gif";
import { SoundsPanel } from "./SoundsPanel";
import { useHotkeys } from "react-hotkeys-hook";

export function EditSection() {
  const isMd = useIsMd();
  const tooltipSide = useMemo(() => (isMd ? "left" : "top"), [isMd]);
  const [soundsOpen, setSoundsOpen] = useState(false);

  useHotkeys("ctrl+shift+m, cmd+shift+m", () => setSoundsOpen((open) => !open));

  return (
    <div className="flex flex-row items-center p-1 gap-2 md:flex-col">
      <DrawerDialog
        open={soundsOpen}
        onOpenChange={setSoundsOpen}
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
          <Button variant="default" size="icon" className="size-11 md:size-9" onClick={() => setSoundsOpen(true)}>
            <HugeiconsIcon icon={FolderMusicIcon} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side={tooltipSide}>
          <p>Manage Sounds</p>
          <Kbd>Ctrl+Shift+M</Kbd>
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
          <Kbd>Ctrl+E</Kbd>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
