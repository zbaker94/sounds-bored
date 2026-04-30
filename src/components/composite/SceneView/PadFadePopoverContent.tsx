import { useCallback } from "react";
import type { Pad } from "@/lib/schemas";
import { useUiStore } from "@/state/uiStore";
import { useProjectStore } from "@/state/projectStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { executeFadeTap } from "@/lib/audio/padPlayer";
import { Slider } from "@/components/ui/slider";

interface Props {
  pad: Pad;
  sceneId: string;
}

// Isolated so that fadePopoverTarget pointer-move updates only re-render this component,
// not every PadButton instance on the scene.
export function PadFadePopoverContent({ pad, sceneId }: Props) {
  const fadePopoverTarget = useUiStore((s) => s.fadePopoverTarget);
  const setFadePopoverTarget = useUiStore((s) => s.setFadePopoverTarget);

  const handleCommit = useCallback((target: number) => {
    useProjectStore.getState().setPadFadeTarget(sceneId, pad.id, target);
    const globalMs = useAppSettingsStore.getState().settings?.globalFadeDurationMs;
    executeFadeTap({ ...pad, fadeTargetVol: target }, globalMs);
    useUiStore.getState().setFadePopoverPadId(null); // also clears fadePopoverTarget
  }, [pad, sceneId]);

  return (
    <>
      <div
        className="absolute left-0 right-0 h-px bg-amber-400/80 pointer-events-none z-10"
        style={{ bottom: `${fadePopoverTarget ?? (pad.fadeTargetVol ?? 0)}%` }}
      />
      <div
        className="absolute bottom-0 left-0 right-0 z-20 px-2 pb-1.5 pt-0.5 bg-black/60 backdrop-blur-sm rounded-b-xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Slider
          compact
          tooltipLabel={(v) => `${v}%`}
          value={[Math.round(fadePopoverTarget ?? (pad.fadeTargetVol ?? 0))]}
          onValueChange={([v]) => setFadePopoverTarget(v)}
          onValueCommit={([v]) => handleCommit(v)}
          min={0}
          max={100}
          step={1}
        />
        <div className="text-[9px] text-white/70 mt-0.5 text-center">
          target · press F to fade
        </div>
      </div>
    </>
  );
}
