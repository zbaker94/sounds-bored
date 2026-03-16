import { EditSection } from "./EditSection";
import { VolumeSection } from "./VolumeSection";
import { PlaySection } from "./PlaySection";

export function SidePanel() {
  return (
    <aside className="h-16 w-full shrink-0 bg-yellow-500 drop-shadow-[0_-5px_0px_rgba(0,0,0,1)] flex flex-row md:h-full md:w-12 md:drop-shadow-[-5px_0_0px_rgba(0,0,0,1)] md:flex-col md:justify-between">
      <EditSection />
      <VolumeSection />
      <PlaySection />
    </aside>
  );
}
