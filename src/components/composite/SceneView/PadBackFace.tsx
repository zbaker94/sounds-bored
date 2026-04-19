import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useHotkeys } from "react-hotkeys-hook";
import type { Pad, Layer, PadConfig } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  PlayIcon,
  StopIcon,
  VolumeHighIcon,
  NextIcon,
  PreviousIcon,
  ListMusicIcon,
  PencilEdit01Icon,
  Cancel01Icon,
  Add01Icon,
  Copy01Icon,
  Delete02Icon,
} from "@hugeicons/core-free-icons";
import { usePlaybackStore } from "@/state/playbackStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { useProjectStore } from "@/state/projectStore";
import { useLibraryStore } from "@/state/libraryStore";
import { useUiStore, OVERLAY_ID } from "@/state/uiStore";
import {
  triggerPad, stopPad, fadePadWithLevels,
  triggerLayer, stopLayerWithRamp, setLayerVolume, setPadVolume,
  skipLayerForward, skipLayerBack,
} from "@/lib/audio/padPlayer";
import { resolveLayerSounds } from "@/lib/audio/resolveSounds";
import { getLayerNormalizedVolume } from "@/lib/audio/layerTrigger";
import { createDefaultLayer } from "@/components/composite/PadConfigDrawer/constants";
import { LayerConfigDialog } from "@/components/composite/PadConfigDrawer/LayerConfigDialog";
import { ConfirmDeletePadDialog } from "@/components/modals/ConfirmDeletePadDialog";
import { toast } from "sonner";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";

function padToConfig(pad: Pad, layers?: Layer[]): PadConfig {
  return {
    name: pad.name,
    layers: layers ?? pad.layers,
    muteTargetPadIds: pad.muteTargetPadIds,
    muteGroupId: pad.muteGroupId,
    color: pad.color,
    icon: pad.icon,
    fadeDurationMs: pad.fadeDurationMs,
    fadeLowVol: pad.fadeLowVol ?? 0,
    fadeHighVol: pad.fadeHighVol ?? 1,
  };
}

const BackFaceLayerRow = memo(function BackFaceLayerRow({
  pad,
  layer,
  index,
  canRemove,
  onEditLayer,
  onRemoveLayer,
}: {
  pad: Pad;
  layer: Layer;
  index: number;
  sceneId: string;
  canRemove: boolean;
  onEditLayer: () => void;
  onRemoveLayer: () => void;
}) {
  const layerActive = usePlaybackStore((s) => s.activeLayerIds.has(layer.id));
  const layerVol = usePlaybackStore(
    (s) => Math.round((s.layerVolumes[layer.id] ?? getLayerNormalizedVolume(layer)) * 100)
  );
  const [localLayerVol, setLocalLayerVol] = useState<number | null>(null);
  const sliderVol = localLayerVol ?? layerVol;

  const sounds = useLibraryStore((s) => s.sounds);
  const allSounds = useMemo(() => resolveLayerSounds(layer, sounds), [layer, sounds]);
  const tags = useLibraryStore((s) => s.tags);
  const sets = useLibraryStore((s) => s.sets);

  const isChained = layer.arrangement === "sequential" || layer.arrangement === "shuffled";
  const [listOpen, setListOpen] = useState(false);
  const listAnchorRef = useRef<HTMLButtonElement>(null);

  const selectionSummary = (() => {
    const sel = layer.selection;
    switch (sel.type) {
      case "assigned":
        return allSounds.length === 0
          ? "No sounds assigned"
          : allSounds.map((s) => s.name).join(", ");
      case "tag": {
        const names = sel.tagIds.map((id) => tags.find((t) => t.id === id)?.name ?? id).join(", ");
        return `Tag: ${names || "\u2014"}`;
      }
      case "set": {
        const name = sets.find((s) => s.id === sel.setId)?.name ?? sel.setId;
        return `Set: ${name}`;
      }
    }
  })();

  return (
    <div className="flex flex-col gap-1 rounded-lg bg-muted/50 p-1.5">
      <div className="flex items-center gap-1">
        <span className={`text-xs ${layerActive ? "text-emerald-400" : "text-muted-foreground"}`}>
          {layerActive ? "\u25CF" : "\u25CB"}
        </span>
        <span className="text-xs font-medium flex-1 truncate">Layer {index + 1}</span>

        <AnimatePresence mode="wait">
          {layerActive ? (
            <motion.div key="stop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }}>
              <button
                type="button"
                onClick={() => stopLayerWithRamp(pad, layer.id)}
                className="p-0.5 rounded hover:bg-destructive/20 transition-colors"
                aria-label={`Stop layer ${index + 1}`}
              >
                <HugeiconsIcon icon={StopIcon} size={12} />
              </button>
            </motion.div>
          ) : (
            <motion.div key="play" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }}>
              <button
                type="button"
                onClick={() => triggerLayer(pad, layer).catch((err: unknown) => {
                  toast.error(`Playback error: ${err instanceof Error ? err.message : String(err)}`);
                })}
                className="p-0.5 rounded hover:bg-primary/20 transition-colors"
                aria-label={`Play layer ${index + 1}`}
              >
                <HugeiconsIcon icon={PlayIcon} size={12} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {isChained && (
          <>
            <button
              type="button"
              onClick={() => skipLayerBack(pad, layer.id)}
              className="p-0.5 rounded hover:bg-muted transition-colors"
              aria-label="Skip back"
            >
              <HugeiconsIcon icon={PreviousIcon} size={12} />
            </button>
            <button
              type="button"
              onClick={() => skipLayerForward(pad, layer.id)}
              className="p-0.5 rounded hover:bg-muted transition-colors"
              aria-label="Skip forward"
            >
              <HugeiconsIcon icon={NextIcon} size={12} />
            </button>
          </>
        )}

        {allSounds.length > 1 && (
          <>
            <button
              ref={listAnchorRef}
              type="button"
              aria-label="Show sound list"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => setListOpen((o) => !o)}
              className="p-0.5 rounded hover:bg-muted transition-colors flex-shrink-0"
            >
              <HugeiconsIcon icon={ListMusicIcon} size={12} />
            </button>
            <Popover open={listOpen} onOpenChange={setListOpen}>
              <PopoverAnchor virtualRef={listAnchorRef as React.RefObject<{ getBoundingClientRect: () => DOMRect }>} />
              <PopoverContent side="top" sideOffset={6} className="w-48 p-2">
                <ol className="flex flex-col gap-0.5 max-h-48 overflow-y-auto">
                  {allSounds.map((s, i) => (
                    <li key={s.id} className="text-xs py-0.5 text-muted-foreground">{i + 1}. {s.name}</li>
                  ))}
                </ol>
              </PopoverContent>
            </Popover>
          </>
        )}

        <button
          type="button"
          aria-label={`Edit layer ${index + 1}`}
          onClick={onEditLayer}
          className="p-0.5 rounded hover:bg-muted transition-colors"
        >
          <HugeiconsIcon icon={PencilEdit01Icon} size={12} />
        </button>

        <button
          type="button"
          aria-label={`Remove layer ${index + 1}`}
          onClick={onRemoveLayer}
          disabled={!canRemove}
          className="p-0.5 rounded hover:bg-destructive/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} />
        </button>
      </div>

      <p className="text-xs text-muted-foreground truncate px-1">{selectionSummary}</p>

      <Slider
        compact
        tooltipLabel={(v) => `${v}%`}
        value={[sliderVol]}
        onValueChange={([v]) => { setLocalLayerVol(v); setLayerVolume(layer.id, v / 100); }}
        onValueCommit={([v]) => { setLocalLayerVol(null); useProjectStore.getState().updateLayerVolume(layer.id, v / 100); }}
        min={0}
        max={100}
        step={1}
      />
    </div>
  );
});

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
  const isFadingOut = usePlaybackStore((s) => s.fadingOutPadIds.has(pad.id));
  const enterMultiFade = useMultiFadeStore((s) => s.enterMultiFade);
  const globalFadeDurationMs = useAppSettingsStore((s) => s.settings?.globalFadeDurationMs ?? 2000);
  const fadeDuration = pad.fadeDurationMs ?? globalFadeDurationMs;

  const [localName, setLocalName] = useState(pad.name);
  useEffect(() => { setLocalName(pad.name); }, [pad.name]);

  function handleNameBlur() {
    const trimmed = localName.trim();
    if (trimmed === pad.name) return;
    updatePad(sceneId, pad.id, { ...padToConfig(pad), name: trimmed });
  }

  const [fadeLevels, setFadeLevels] = useState<[number, number]>(() => [
    Math.round((pad.fadeLowVol ?? 0) * 100),
    Math.round((pad.fadeHighVol ?? 1) * 100),
  ]);
  const startThumbDraggingRef = useRef(false);
  const setPadFadeLevels = useProjectStore((s) => s.setPadFadeLevels);

  useEffect(() => {
    if (!isPlaying) {
      setFadeLevels([
        Math.round((pad.fadeLowVol ?? 0) * 100),
        Math.round((pad.fadeHighVol ?? 1) * 100),
      ]);
    }
  }, [isPlaying, pad.fadeLowVol, pad.fadeHighVol]);

  useEffect(() => {
    const handlePointerUp = () => { startThumbDraggingRef.current = false; };
    window.addEventListener("pointerup", handlePointerUp);
    return () => window.removeEventListener("pointerup", handlePointerUp);
  }, []);

  const [editingLayerIndex, setEditingLayerIndex] = useState<number | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function handleEditLayer(index: number) {
    setEditingLayerIndex(index);
    openOverlay(OVERLAY_ID.LAYER_CONFIG_DIALOG, "dialog");
  }

  function handleLayerDialogClose() {
    closeOverlay(OVERLAY_ID.LAYER_CONFIG_DIALOG);
    setEditingLayerIndex(null);
  }

  function handleAddLayer() {
    const newLayer = createDefaultLayer();
    const newLayers = [...pad.layers, newLayer];
    updatePad(sceneId, pad.id, padToConfig(pad, newLayers));
    handleEditLayer(newLayers.length - 1);
  }

  function handleRemoveLayer(index: number) {
    if (pad.layers.length <= 1) return;
    const newLayers = pad.layers.filter((_, i) => i !== index);
    updatePad(sceneId, pad.id, padToConfig(pad, newLayers));
  }

  const handleStartStop = useCallback(() => {
    if (isPlaying) {
      stopPad(pad);
    } else {
      triggerPad(pad).catch((err: unknown) => {
        toast.error(`Playback error: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }, [isPlaying, pad]);

  const handleFade = useCallback(() => {
    fadePadWithLevels(pad, fadeDuration).catch((err: unknown) => {
      toast.error(`Playback error: audio fade failed \u2014 ${err instanceof Error ? err.message : String(err)}`);
    });
  }, [pad, fadeDuration]);

  const handleMultiFadeInternal = useCallback(() => {
    enterMultiFade(pad.id, pad.fadeLowVol ?? 0, pad.fadeHighVol ?? 1);
    onMultiFade();
  }, [pad, enterMultiFade, onMultiFade]);

  useHotkeys("f", handleFade, { enableOnFormTags: true });
  useHotkeys("x", handleMultiFadeInternal, { enableOnFormTags: true });

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

        <div className="flex flex-col gap-1.5 flex-shrink-0">
          <div className="flex justify-between text-muted-foreground">
            <span>{isPlaying ? "end" : "start"}</span>
            <span>{isPlaying ? "start (current)" : "end"}</span>
          </div>
          <Slider
            tooltipLabel={(v) => `${v}%`}
            value={fadeLevels}
            onValueChange={(v) => {
              const next = v as [number, number];
              if (isPlaying && next[1] !== fadeLevels[1]) setPadVolume(pad.id, next[1] / 100);
              setFadeLevels(next);
            }}
            onPointerUp={() => {
              startThumbDraggingRef.current = false;
              setPadFadeLevels(sceneId, pad.id, fadeLevels[0] / 100, fadeLevels[1] / 100);
            }}
            onThumbPointerDown={(index) => { if (index === 1) startThumbDraggingRef.current = true; }}
            min={0} max={100} step={1}
          />
          <div className="flex items-center justify-between text-muted-foreground">
            <span>Duration</span>
            <span className="tabular-nums">{(fadeDuration / 1000).toFixed(1)}s</span>
          </div>
          <Slider
            compact
            tooltipLabel={(v) => `${(v / 1000).toFixed(1)}s`}
            value={[fadeDuration]}
            onValueChange={([v]) => updatePad(sceneId, pad.id, { ...padToConfig(pad), fadeDurationMs: v })}
            min={100} max={10000} step={100}
          />
          {pad.fadeDurationMs !== undefined ? (
            <button
              type="button"
              className="text-muted-foreground underline self-start"
              onClick={() => updatePad(sceneId, pad.id, { ...padToConfig(pad), fadeDurationMs: undefined })}
            >
              Reset to default
            </button>
          ) : (
            <p className="text-muted-foreground">Global default ({(globalFadeDurationMs / 1000).toFixed(1)}s)</p>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" variant="secondary" onClick={handleFade} className="w-full gap-1.5">
                <HugeiconsIcon icon={VolumeHighIcon} size={14} />
                {isPlaying && !isFadingOut ? "Fade Out" : "Fade In"}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top"><Kbd>F</Kbd></TooltipContent>
          </Tooltip>
        </div>

        <div className="flex flex-col gap-1 flex-shrink-0">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-muted-foreground uppercase tracking-wide">Layers</h4>
            <button
              type="button"
              aria-label="Add layer"
              onClick={handleAddLayer}
              className="p-0.5 rounded hover:bg-muted transition-colors"
            >
              <HugeiconsIcon icon={Add01Icon} size={12} />
            </button>
          </div>
          <div className="flex flex-col gap-1">
            {pad.layers.map((layer, i) => (
              <BackFaceLayerRow
                key={layer.id}
                pad={pad}
                layer={layer}
                index={i}
                sceneId={sceneId}
                canRemove={pad.layers.length > 1}
                onEditLayer={() => handleEditLayer(i)}
                onRemoveLayer={() => handleRemoveLayer(i)}
              />
            ))}
          </div>
        </div>

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
