import type { Pad } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { triggerPad } from "@/lib/audio/padPlayer";
import { usePlaybackStore } from "@/state/playbackStore";

interface PadButtonProps {
  pad: Pad;
  onClick?: () => void;
}

export function PadButton({ pad, onClick }: PadButtonProps) {
  const isPlaying = usePlaybackStore((s) => s.playingPadIds.includes(pad.id));

  async function handleClick() {
    onClick?.();
    await triggerPad(pad);
  }

  return (
    <button
      onClick={handleClick}
      className={cn(
        "w-full h-full rounded-xl border-2",
        isPlaying ? "border-white/70" : "border-black/20",
        "flex items-center justify-center p-2",
        "bg-card text-card-foreground",
        "shadow-[3px_3px_0px_rgba(0,0,0,0.25)]",
        "hover:brightness-110 active:scale-95 active:shadow-none transition-all cursor-pointer",
        "text-sm font-semibold text-center"
      )}
      style={pad.color ? { backgroundColor: pad.color } : undefined}
    >
      <span className="line-clamp-3 break-words leading-tight">{pad.name}</span>
    </button>
  );
}
