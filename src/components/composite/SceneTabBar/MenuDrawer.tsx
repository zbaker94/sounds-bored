import { useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useProjectStore } from "@/state/projectStore";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { ClipboardIcon, FolderExportIcon, Hamburger01Icon, HomeIcon, SaveIcon } from "@hugeicons/core-free-icons";
import { Drawer, DrawerContent, DrawerHeader } from "@/components/ui/drawer";
import { Separator } from "@/components/ui/separator";
import { Kbd } from "@/components/ui/kbd";

export function MenuDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  const isDirty = useProjectStore((s) => s.isDirty);

  // Vaul's escape handling is disabled via onEscapeKeyDown to avoid a race condition
  // where it closes the drawer and re-renders before this hotkey fires, causing it to reopen.
  // This hotkey owns all escape behavior — toggle open/close.
  useHotkeys("esc", () => setIsOpen((prev) => !prev));

  return (
    <Drawer direction="left" open={isOpen} onOpenChange={setIsOpen}>
      <Button
        onClick={() => setIsOpen(true)}
        variant="ghost"
        size="icon-sm"
        aria-label="Open Menu"
        className="shadowed"
      >
        <HugeiconsIcon icon={Hamburger01Icon} size={16} />
      </Button>
      <DrawerContent className="w-64 bricked-background-overlay" onEscapeKeyDown={(e) => e.preventDefault()}>
        <DrawerHeader>
          <h1 className="text-lg font-semibold ">Menu</h1>
        </DrawerHeader>
        <Button disabled={!isDirty} variant="secondary" className="w-full mb-2" onClick={() => null}>
          <HugeiconsIcon icon={SaveIcon} size={16} />
          Save
          <Kbd className="ml-auto">Ctrl + S</Kbd>
        </Button>
        <Button variant="secondary" className="w-full" onClick={() => null}>
          <HugeiconsIcon icon={ClipboardIcon} size={16} />
          Save As
          <Kbd className="ml-auto">Ctrl + Shift + S</Kbd>
        </Button>
        <Separator />
        <Button variant="secondary" className="w-full mt-2" onClick={() => null}>
          <HugeiconsIcon icon={FolderExportIcon} size={16} />
          Export
          <Kbd className="ml-auto">Ctrl + X</Kbd>
        </Button>
        <Separator />
        <Button
          variant="default"
          className="w-full mt-2"
          onClick={() => {
            window.location.assign("/");
          }}
        >
          <HugeiconsIcon icon={HomeIcon} size={16} />
          Return to Main Menu
        </Button>
      </DrawerContent>
    </Drawer>
  );
}
