import { useUiStore, OVERLAY_ID } from "@/state/uiStore";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { ClipboardIcon, FolderExportIcon, Hamburger01Icon, HomeIcon, SaveIcon } from "@hugeicons/core-free-icons";
import { Drawer, DrawerContent, DrawerHeader } from "@/components/ui/drawer";
import { Separator } from "@/components/ui/separator";
import { Kbd } from "@/components/ui/kbd";
import { modKey } from "@/lib/utils";
import { useProjectActions } from "@/contexts/ProjectActionsContext";

export function MenuDrawer() {
  const isOpen = useUiStore((s) => s.isOverlayOpen(OVERLAY_ID.MENU_DRAWER));
  const openOverlay = useUiStore((s) => s.openOverlay);
  const closeOverlay = useUiStore((s) => s.closeOverlay);
  const { canSave, handleSaveClick, requestNavigateAway } = useProjectActions();

  return (
    <Drawer
      direction="left"
      open={isOpen}
      onOpenChange={(open) =>
        open ? openOverlay(OVERLAY_ID.MENU_DRAWER, "drawer") : closeOverlay(OVERLAY_ID.MENU_DRAWER)
      }
    >
      <Button
        onClick={() => openOverlay(OVERLAY_ID.MENU_DRAWER, "drawer")}
        variant="ghost"
        size="icon-sm"
        aria-label="Open Menu"
        className="shadowed"
      >
        <HugeiconsIcon icon={Hamburger01Icon} size={16} />
      </Button>
      {/* onEscapeKeyDown is suppressed here — the global Esc handler owns escape for all overlays. */}
      <DrawerContent className="w-64 bricked-background-overlay" onEscapeKeyDown={(e) => e.preventDefault()}>
        <DrawerHeader>
          <h1 className="text-lg font-semibold ">Menu</h1>
        </DrawerHeader>
        <Button disabled={!canSave} variant="secondary" className="w-full mb-2" onClick={handleSaveClick}>
          <HugeiconsIcon icon={SaveIcon} size={16} />
          Save
          <Kbd className="ml-auto">{modKey} + S</Kbd>
        </Button>
        <Button variant="secondary" className="w-full" onClick={() => null}>
          <HugeiconsIcon icon={ClipboardIcon} size={16} />
          Save As
          <Kbd className="ml-auto">{modKey} + Shift + S</Kbd>
        </Button>
        <Separator />
        <Button variant="secondary" className="w-full mt-2" onClick={() => null}>
          <HugeiconsIcon icon={FolderExportIcon} size={16} />
          Export
          <Kbd className="ml-auto">{modKey} + X</Kbd>
        </Button>
        <Separator />
        <Button
          variant="default"
          className="w-full mt-2"
          onClick={() => { closeOverlay(OVERLAY_ID.MENU_DRAWER); requestNavigateAway("/"); }}
        >
          <HugeiconsIcon icon={HomeIcon} size={16} />
          Return to Main Menu
        </Button>
      </DrawerContent>
    </Drawer>
  );
}
