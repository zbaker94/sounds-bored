import type { Pad } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { usePlaybackStore } from "@/state/playbackStore";
import { usePadGesture } from "@/hooks/usePadGesture";

interface PadButtonProps {
  pad: Pad;
  onClick?: () => void;
}

export function PadButton({ pad, onClick }: PadButtonProps) {
  const isPlaying = usePlaybackStore((s) => s.playingPadIds.includes(pad.id));
  const { gestureHandlers, fillVolume } = usePadGesture(pad);

  return (
    <button
      {...gestureHandlers}
      onClick={onClick}
      className={cn(
        "relative w-full h-full rounded-xl border-2 overflow-hidden",
        isPlaying
          ? "border-black drop-shadow-[0_5px_0px_rgba(0,0,0,1)]"
          : "border-black/20",
        "flex items-center justify-center p-2",
        "bg-card text-card-foreground",
        "shadow-[3px_3px_0px_rgba(0,0,0,0.25)]",
        "hover:brightness-110 active:scale-95 active:shadow-none transition-all cursor-pointer",
        "text-sm font-semibold text-center select-none"
      )}
      style={pad.color ? { backgroundColor: pad.color } : undefined}
    >
      {/* Volume fill — visible during hold/drag only */}
      {fillVolume !== null && (
        <div
          className="absolute bottom-0 left-0 right-0 pointer-events-none bg-yellow-500 border-t-2 border-black"
          style={{ height: `${fillVolume * 100}%` }}
        />
      )}
      <span className="relative z-10 line-clamp-3 break-words leading-tight">
        {pad.name}
      </span>
    </button>
  );
}
