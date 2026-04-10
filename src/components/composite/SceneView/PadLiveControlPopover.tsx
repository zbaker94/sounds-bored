import { useCallback, memo } from "react";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useIsMd } from "@/hooks/useBreakpoint";
import type { Pad } from "@/lib/schemas";
import { PadControlContent } from "./PadControlContent";

// Re-export so existing imports don't break
export { getSoundsForLayer } from "./PadControlContent";

interface PadLiveControlPopoverProps {
  pad: Pad;
  sceneId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
}

export const PadLiveControlPopover = memo(function PadLiveControlPopover({
  pad,
  sceneId,
  open,
  onOpenChange,
  anchorRef,
}: PadLiveControlPopoverProps) {
  const isDesktop = useIsMd();

  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  if (!isDesktop) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent>
          {/* sr-only title satisfies accessibility without duplicating the visible header */}
          <DrawerTitle className="sr-only">{pad.name}</DrawerTitle>
          <div className="px-4 pb-4 pt-2">
            <PadControlContent pad={pad} sceneId={sceneId} onClose={handleClose} />
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor
        virtualRef={
          anchorRef as React.RefObject<{ getBoundingClientRect: () => DOMRect }>
        }
      />
      <PopoverContent className="w-72" side="top" sideOffset={10} showArrow>
        <PadControlContent pad={pad} sceneId={sceneId} onClose={handleClose} />
      </PopoverContent>
    </Popover>
  );
});
