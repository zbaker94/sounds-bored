import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { VolumeHighIcon, ShuffleIcon } from "@hugeicons/core-free-icons";
import { Kbd } from "@/components/ui/kbd";
import type { UseFadeModeReturn } from "@/hooks/useFadeMode";

interface FadeToolbarProps {
  // fadeMode is passed as a prop (rather than called internally) because SceneView
  // also consumes it for PadButton rendering (getPadFadeVisual, onPadTap). Calling
  // useFadeMode() twice would create two independent state machines.
  fadeMode: UseFadeModeReturn;
  editMode: boolean;
}

export function FadeToolbar({ fadeMode, editMode }: FadeToolbarProps) {
  if (editMode) return null;

  return (
    <div className="flex items-center gap-2 shrink-0">
      <Button
        variant={fadeMode.mode === "fade" ? "default" : "ghost"}
        size="sm"
        onClick={() =>
          fadeMode.mode === "fade" ? fadeMode.cancel() : fadeMode.enterFade()
        }
        aria-label="Fade pad"
      >
        <HugeiconsIcon icon={VolumeHighIcon} size={16} />
        Fade
        <Kbd className="ml-1">F</Kbd>
      </Button>
      <Button
        variant={fadeMode.mode === "crossfade" ? "default" : "ghost"}
        size="sm"
        onClick={() => {
          if (fadeMode.mode === "crossfade") {
            if (fadeMode.canExecute) fadeMode.execute();
            else fadeMode.cancel();
          } else {
            fadeMode.enterCrossfade();
          }
        }}
        disabled={fadeMode.mode !== "crossfade" && !fadeMode.hasPlayingPads}
        aria-label="Crossfade pads"
      >
        <HugeiconsIcon icon={ShuffleIcon} size={16} />
        Crossfade
        <Kbd className="ml-1">X</Kbd>
      </Button>
      {fadeMode.statusLabel && (
        <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-black/50 text-white border border-white/20">
          {fadeMode.statusLabel}
        </span>
      )}
    </div>
  );
}
