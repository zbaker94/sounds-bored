import { useState, useEffect, useRef, useCallback, memo } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Pad } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  PlayIcon,
  StopIcon,
  Copy01Icon,
  Delete02Icon,
} from "@hugeicons/core-free-icons";
import { usePlaybackStore } from "@/state/playbackStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { useProjectStore } from "@/state/projectStore";
import { useUiStore, OVERLAY_ID } from "@/state/uiStore";
import {
  triggerPad, stopPad, executeFadeTap, reverseFade, stopFade,
} from "@/lib/audio/padPlayer";
import { emitAudioError } from "@/lib/audio/audioEvents";
import { createDefaultStoreLayer, padToConfig } from "@/lib/padDefaults";
import { LayerConfigDialog } from "@/components/composite/PadConfigDrawer/LayerConfigDialog";
import { ConfirmDeletePadDialog } from "@/components/modals/ConfirmDeletePadDialog";
import { PadFadeControls } from "./PadFadeControls";
import { PadLayerSection } from "./PadLayerSection";

export interface PadBackFaceProps {
  pad: Pad;
  sceneId: string;
  onMultiFade: () => void;
}

export const PadBackFace = memo(function PadBackFace({ pad, sceneId, onMultiFade }: PadBackFaceProps) {
  const updatePad = useProjectStore((s) => s.updatePad);
  const duplicatePad = useProjectStore((s) => s.duplicatePad);
  const deletePad = useProjectStore((s) => s.deletePad);
  const setEditingPadId = useUiStore((s) => s.setEditingPadId);
  const openOverlay = useUiStore((s) => s.openOverlay);
  const closeOverlay = useUiStore((s) => s.closeOverlay);

  const isPlaying = usePlaybackStore((s) => s.playingPadIds.has(pad.id));
  const isFading = usePlaybackStore((s) => s.fadingPadIds.has(pad.id));
  const isReversing = usePlaybackStore((s) => s.reversingPadIds.has(pad.id));
  const liveVolume = usePlaybackStore((s) => s.padVolumes[pad.id]);
  const enterMultiFade = useMultiFadeStore((s) => s.enterMultiFade);
  const globalFadeDurationMs = useAppSettingsStore((s) => s.settings?.globalFadeDurationMs ?? 2000);

  const [localName, setLocalName] = useState(pad.name);
  useEffect(() => { setLocalName(pad.name); }, [pad.name]);

  function handleNameBlur() {
    const trimmed = localName.trim();
    if (!trimmed) { setLocalName(pad.name); return; }
    if (trimmed === pad.name) return;
    updatePad(sceneId, pad.id, { ...padToConfig(pad), name: trimmed });
  }

  const padRef = useRef(pad);
  padRef.current = pad;

  const [editingLayerIndex, setEditingLayerIndex] = useState<number | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const handleEditLayer = useCallback((index: number) => {
    setEditingLayerIndex(index);
    openOverlay(OVERLAY_ID.LAYER_CONFIG_DIALOG, "dialog");
  }, [openOverlay]);

  function handleLayerDialogClose() {
    closeOverlay(OVERLAY_ID.LAYER_CONFIG_DIALOG);
    setEditingLayerIndex(null);
  }

  const handleAddLayer = useCallback(() => {
    const newLayer = createDefaultStoreLayer();
    const newLayers = [...padRef.current.layers, newLayer];
    updatePad(sceneId, padRef.current.id, padToConfig(padRef.current, newLayers));
    handleEditLayer(newLayers.length - 1);
  }, [sceneId, updatePad, handleEditLayer]);

  const handleRemoveLayer = useCallback((index: number) => {
    if (padRef.current.layers.length <= 1) return;
    const newLayers = padRef.current.layers.filter((_, i) => i !== index);
    updatePad(sceneId, padRef.current.id, padToConfig(padRef.current, newLayers));
  }, [sceneId, updatePad]);

  const handleStartStop = useCallback(() => {
    if (isPlaying) {
      stopPad(pad);
    } else {
      triggerPad(pad).catch((err: unknown) => { emitAudioError(err); });
    }
  }, [isPlaying, pad]);

  const handleFade = useCallback(() => {
    executeFadeTap(padRef.current, globalFadeDurationMs);
  }, [globalFadeDurationMs]);

  const handleStopFade = useCallback(() => {
    stopFade(padRef.current);
  }, []);

  const handleReverse = useCallback(() => {
    reverseFade(padRef.current, globalFadeDurationMs);
  }, [globalFadeDurationMs]);

  const handleMultiFadeInternal = useCallback(() => {
    enterMultiFade(pad.id, pad.volume ?? 100, pad.fadeTargetVol ?? 0);
    onMultiFade();
  }, [pad, enterMultiFade, onMultiFade]);


  return (
    <TooltipProvider>
      <div className="w-full h-full p-2 flex flex-col gap-2 overflow-y-auto text-xs">
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <input
            type="color"
            value={pad.color ?? "#1a1a2e"}
            onChange={(e) => updatePad(sceneId, pad.id, { ...padToConfig(pad), color: e.target.value })}
            className="w-5 h-5 rounded cursor-pointer border border-border flex-shrink-0 p-0"
            aria-label="Pad color"
            title="Pad color"
          />
          <input
            type="text"
            value={localName}
            onChange={(e) => setLocalName(e.target.value)}
            onBlur={handleNameBlur}
            className="flex-1 min-w-0 bg-transparent border-b border-border text-sm font-semibold outline-none focus:border-primary"
            placeholder="Pad name"
            aria-label="Pad name"
          />
          <button
            type="button"
            aria-label="Duplicate pad"
            onClick={() => { duplicatePad(sceneId, pad.id); setEditingPadId(null); }}
            className="p-0.5 rounded hover:bg-muted transition-colors flex-shrink-0"
          >
            <HugeiconsIcon icon={Copy01Icon} size={12} />
          </button>
          <button
            type="button"
            aria-label="Delete pad"
            onClick={() => setConfirmingDelete(true)}
            className="p-0.5 rounded hover:bg-destructive/20 transition-colors flex-shrink-0"
          >
            <HugeiconsIcon icon={Delete02Icon} size={12} />
          </button>
        </div>

        <div className="flex-shrink-0">
          <AnimatePresence mode="wait">
            {isPlaying ? (
              <motion.div key="stop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }}>
                <Button size="sm" variant="destructive" onClick={handleStartStop} className="w-full gap-1.5">
                  <HugeiconsIcon icon={StopIcon} size={14} />Stop
                </Button>
              </motion.div>
            ) : (
              <motion.div key="play" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }}>
                <Button size="sm" variant="default" onClick={handleStartStop} className="w-full gap-1.5">
                  <HugeiconsIcon icon={PlayIcon} size={14} />Start
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <PadFadeControls
          pad={pad}
          sceneId={sceneId}
          isPlaying={isPlaying}
          isFading={isFading}
          isReversing={isReversing}
          globalFadeDurationMs={globalFadeDurationMs}
          liveVolume={liveVolume}
          onFade={handleFade}
          onStopFade={handleStopFade}
          onReverse={handleReverse}
        />

        <PadLayerSection
          pad={pad}
          onAddLayer={handleAddLayer}
          onEditLayer={handleEditLayer}
          onRemoveLayer={handleRemoveLayer}
        />

        <div className="flex-shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" variant="ghost" onClick={handleMultiFadeInternal} className="bg-yellow-500 w-full text-xs">
                Synchronized Fades
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top"><Kbd>X</Kbd></TooltipContent>
          </Tooltip>
        </div>
      </div>

      {editingLayerIndex !== null && (
        <LayerConfigDialog
          pad={pad}
          sceneId={sceneId}
          layerIndex={editingLayerIndex}
          onClose={handleLayerDialogClose}
        />
      )}

      <ConfirmDeletePadDialog
        isOpen={confirmingDelete}
        padName={pad.name}
        onConfirm={() => {
          setConfirmingDelete(false);
          stopPad(pad);
          deletePad(sceneId, pad.id);
          setEditingPadId(null);
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
    </TooltipProvider>
  );
});
