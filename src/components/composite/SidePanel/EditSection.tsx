import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { PencilEdit01Icon, Upload03Icon } from "@hugeicons/core-free-icons";

export function EditSection() {
  return (
    <div className="flex flex-row items-center p-1 gap-2 md:flex-col">
      <Button variant="default" size="icon" className="size-11 md:size-9">
        <HugeiconsIcon icon={Upload03Icon} />
      </Button>
      <Button variant="default" size="icon" className="size-11 md:size-9">
        <HugeiconsIcon icon={PencilEdit01Icon} />
      </Button>
    </div>
  );
}
