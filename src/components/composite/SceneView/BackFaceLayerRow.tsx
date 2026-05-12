import { useState, useRef, useMemo, memo, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Pad, Layer, Sound } from "@/lib/schemas";
import { Slider } from "@/components/ui/slider";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  PlayIcon,
  StopIcon,
  NextIcon,
  PreviousIcon,
  ListMusicIcon,
  PencilEdit01Icon,
  Cancel01Icon,
  Volume1,
} from "@hugeicons/core-free-icons";
import { useLayerMetricsStore } from "@/state/layerMetricsStore";
import { BackFaceLayerProgressBar } from "./BackFaceLayerProgressBar";
import { useLibraryStore } from "@/state/libraryStore";
import { useProjectStore } from "@/state/projectStore";
import {
  triggerLayer, stopLayerWithRamp, setLayerVolume,
  skipLayerForward, skipLayerBack,
  emitAudioError, resolveLayerSounds, snapshotSounds, getLayerNormalizedVolume, getLayerPlayOrder,
} from "@/lib/audio";
import { summarizeLayerSelection } from "@/lib/layerHelpers";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";

export const BackFaceLayerRow = memo(function BackFaceLayerRow({
  pad,
  layer,
  index,
  onEditLayer,
  onRemoveLayer,
}: {
  pad: Pad;
  layer: Layer;
  index: number;
  onEditLayer: () => void;
  onRemoveLayer: () => void;
}) {
  const canRemove = pad.layers.length > 1;
  const layerActive = useLayerMetricsStore((s) => s.activeLayerIds.has(layer.id));
  const [liveLayerVol, setLiveLayerVol] = useState<number | null>(() => {
    const stored = useLayerMetricsStore.getState().layerVolumes[layer.id];
    return stored !== undefined ? Math.round(stored * 100) : null;
  });
  const [localLayerVol, setLocalLayerVol] = useState<number | null>(null);

  useEffect(() => {
    const THROTTLE_MS = 100;
    let lastUpdate = 0;
    // Sync to current state when layer.id changes so there's no stale value between
    // unsubscribing the old selector and receiving the first notification on the new one.
    const snap = useLayerMetricsStore.getState().layerVolumes[layer.id];
    setLiveLayerVol(snap !== undefined ? Math.round(snap * 100) : null);
    return useLayerMetricsStore.subscribe(
      (state) => state.layerVolumes[layer.id],
      (vol) => {
        if (vol === undefined) { setLiveLayerVol(null); return; }
        const now = Date.now();
        if (now - lastUpdate >= THROTTLE_MS) {
          lastUpdate = now;
          setLiveLayerVol(Math.round(vol * 100));
        }
      }
    );
  }, [layer.id]);

  const layerVol = liveLayerVol ?? Math.round(getLayerNormalizedVolume(layer) * 100);
  const sliderVol = localLayerVol ?? layerVol;

  const sounds = useLibraryStore((s) => s.sounds);
  const allSounds = useMemo(() => resolveLayerSounds(layer, snapshotSounds(sounds)), [layer, sounds]);
  const tags = useLibraryStore((s) => s.tags);
  const sets = useLibraryStore((s) => s.sets);

  const isChained = layer.arrangement === "sequential" || layer.arrangement === "shuffled";
  const [listOpen, setListOpen] = useState(false);
  const [capturedPlayOrder, setCapturedPlayOrder] = useState<Sound[] | null>(null);
  const listAnchorRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (listOpen && layer.arrangement === "shuffled") {
      setCapturedPlayOrder(getLayerPlayOrder(layer.id) ?? null);
    } else if (!listOpen) {
      setCapturedPlayOrder(null);
    }
  }, [listOpen, layer.id, layer.arrangement]);

  const selectionSummary = summarizeLayerSelection(layer, allSounds, tags, sets);

  return (
    <div className="flex flex-col gap-1 rounded-lg bg-muted/50 p-1.5">
      <div className="flex items-center gap-1">
        <span className={`text-xs ${layerActive ? "text-emerald-400" : "text-muted-foreground"}`}>
          {layerActive ? "\u25CF" : "\u25CB"}
        </span>
        {allSounds.length === 1 && allSounds[0]?.coverArtDataUrl && (
          <img
            data-testid="layer-cover-art-thumbnail"
            src={allSounds[0].coverArtDataUrl}
            className="w-4 h-4 rounded-sm object-cover flex-shrink-0"
            alt=""
          />
        )}
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
                onClick={() => triggerLayer(pad, layer).catch((err: unknown) => { emitAudioError(err); })}
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
                {isChained && layer.arrangement === "shuffled" && !capturedPlayOrder && (
                  <p className="text-xs text-muted-foreground mb-1.5">Randomized each trigger</p>
                )}
                <ol className="flex flex-col gap-0.5 max-h-48 overflow-y-auto">
                  {(layer.arrangement === "shuffled" && capturedPlayOrder ? capturedPlayOrder : allSounds).map((s, i) => (
                    <li key={s.id} className="flex items-center gap-1.5 py-0.5 text-xs text-muted-foreground">
                      {s.coverArtDataUrl ? (
                        <img src={s.coverArtDataUrl} className="w-4 h-4 rounded-sm object-cover flex-shrink-0" alt="" />
                      ) : (
                        <span className="w-4 flex-shrink-0" />
                      )}
                      {i + 1}. {s.name}
                    </li>
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
        

      <div className="flex flex-row items-center gap-2 px-1">
        <HugeiconsIcon icon={Volume1} size={14} className="text-muted-foreground" />
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

      <BackFaceLayerProgressBar layerId={layer.id} />
    </div>
  );
});
