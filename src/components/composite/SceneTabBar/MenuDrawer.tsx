import { useUiStore, OVERLAY_ID, selectIsOverlayOpen } from "@/state/uiStore";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { ClipboardIcon, FolderExportIcon, Hamburger01Icon, HomeIcon, SaveIcon, Settings01Icon } from "@hugeicons/core-free-icons";
import { Drawer, DrawerContent, DrawerHeader } from "@/components/ui/drawer";
import { Separator } from "@/components/ui/separator";
import { Kbd } from "@/components/ui/kbd";
import { modKey } from "@/lib/utils";
import { useProjectActions } from "@/contexts/ProjectActionsContext";
import handsigil from "@/assets/handsigil.png";
import brickOverlay from "@/assets/brick-overlay.png";

export function MenuDrawer() {
  const isOpen = useUiStore(selectIsOverlayOpen(OVERLAY_ID.MENU_DRAWER));
  const openOverlay = useUiStore((s) => s.openOverlay);
  const closeOverlay = useUiStore((s) => s.closeOverlay);
  const { canSave, handleSaveClick, requestNavigateAway, handleSaveAsMenuClick, handleExportClick } = useProjectActions();

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
      <DrawerContent
        className="w-64"
        style={{
          backgroundImage: `url(${brickOverlay})`,
          backgroundRepeat: "repeat",
          backgroundColor: "var(--background)",
        }}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DrawerHeader>
          <h1 className="text-lg font-semibold text-white">Menu</h1>
        </DrawerHeader>
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-2">
            <Button disabled={!canSave} variant="secondary" className="w-full" onClick={handleSaveClick}>
              <HugeiconsIcon icon={SaveIcon} size={16} />
              Save
              <Kbd className="ml-auto">{modKey} + S</Kbd>
            </Button>
            <Button variant="secondary" className="w-full" onClick={() => { closeOverlay(OVERLAY_ID.MENU_DRAWER); handleSaveAsMenuClick(); }}>
              <HugeiconsIcon icon={ClipboardIcon} size={16} />
              Save As
              <Kbd className="ml-auto">{modKey} + Shift + S</Kbd>
            </Button>
          </div>
          <Separator />
          <Button variant="secondary" className="w-full" onClick={() => { closeOverlay(OVERLAY_ID.MENU_DRAWER); handleExportClick(); }}>
            <HugeiconsIcon icon={FolderExportIcon} size={16} />
            Export
            <Kbd className="ml-auto">{modKey} + Shift + E</Kbd>
          </Button>
          <Separator />
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => { closeOverlay(OVERLAY_ID.MENU_DRAWER); openOverlay(OVERLAY_ID.SETTINGS_DIALOG, "dialog"); }}
            aria-label="Settings"
          >
            <HugeiconsIcon icon={Settings01Icon} size={16} />
            Settings
          </Button>
          <Separator />
          <Button
            variant="default"
            className="w-full"
            onClick={() => { closeOverlay(OVERLAY_ID.MENU_DRAWER); requestNavigateAway("/"); }}
          >
            <HugeiconsIcon icon={HomeIcon} size={16} />
            Return to Main Menu
          </Button>
        </div>
        <img
          src={handsigil}
          alt=""
          aria-hidden
          className="pointer-events-none mt-auto w-full object-contain"
        />
      </DrawerContent>
    </Drawer>
  );
}
