# Pad Control Panel Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `PadLiveControlContent` into a shared `PadControlContent` component that adds a colored header with edit/duplicate/delete actions, adapts its layout responsively via `ResizeObserver`, and is used by both the right-click popover and the edit-mode back face of `PadButton`.

**Architecture:** A new `PadControlContent.tsx` houses the extracted panel logic, `getSoundsForLayer`, and `LayerRow`. It uses a `ResizeObserver` on its root container to switch between full (≥280px), condensed (≥120px), and scroll (<120px) display modes. `PadLiveControlPopover` and `PadButton`'s back face both render `<PadControlContent>`.

**Tech Stack:** React 19, TypeScript strict, Zustand, motion/react, Radix Popover/Drawer, Vitest + Testing Library, `@hugeicons/react`

---

## File Map

| Action | Path |
|--------|------|
| **Create** | `src/components/composite/SceneView/PadControlContent.tsx` |
| **Create** | `src/components/composite/SceneView/PadControlContent.test.tsx` |
| **Modify** | `src/components/composite/SceneView/PadLiveControlPopover.tsx` |
| **Modify** | `src/components/composite/SceneView/PadLiveControlPopover.test.tsx` |
| **Modify** | `src/components/composite/SceneView/PadButton.tsx` |
| **Modify** | `src/components/composite/SceneView/PadButton.test.tsx` |

---

## Task 1: Create PadControlContent.tsx — full mode + header

**Files:**
- Create: `src/components/composite/SceneView/PadControlContent.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/composite/SceneView/PadControlContent.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { PadControlContent } from "./PadControlContent";
import { createMockPad, createMockLayer, createMockHistoryEntry, createMockProject, createMockScene } from "@/test/factories";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { usePlaybackStore, initialPlaybackState } from "@/state/playbackStore";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  PopoverAnchor: () => null,
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="popover-content">{children}</div>
  ),
}));

vi.mock("@/lib/audio/padPlayer", () => ({
  triggerPad: vi.fn().mockResolvedValue(undefined),
  stopPad: vi.fn(),
  fadePadWithLevels: vi.fn().mockResolvedValue(undefined),
  triggerLayer: vi.fn().mockResolvedValue(undefined),
  stopLayerWithRamp: vi.fn(),
  setLayerVolume: vi.fn(),
  commitLayerVolume: vi.fn(),
  skipLayerForward: vi.fn(),
  skipLayerBack: vi.fn(),
  setPadVolume: vi.fn(),
}));

vi.mock("@/lib/audio/audioState", () => ({
  isPadActive: vi.fn().mockReturnValue(false),
  isLayerActive: vi.fn().mockReturnValue(false),
  getLayerChain: vi.fn().mockReturnValue(undefined),
  getLayerPlayOrder: vi.fn().mockReturnValue(undefined),
}));

// Import after mocks are set up
import { stopPad } from "@/lib/audio/padPlayer";

function loadPadInStore(padOverrides = {}) {
  const layer = createMockLayer({ id: "layer-1" });
  const pad = createMockPad({ id: "pad-1", name: "Kick", layers: [layer], ...padOverrides });
  const scene = createMockScene({ id: "scene-1", pads: [pad] });
  const entry = createMockHistoryEntry();
  useProjectStore.getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);
  return pad;
}

function renderContent(padOverrides = {}, onEditClick = vi.fn(), onClose = vi.fn()) {
  const pad = loadPadInStore(padOverrides);
  render(
    <PadControlContent
      pad={pad}
      sceneId="scene-1"
      onClose={onClose}
      onEditClick={onEditClick}
    />
  );
  return { pad, onEditClick, onClose };
}

describe("PadControlContent", () => {
  beforeEach(() => {
    useProjectStore.setState({ ...initialProjectState });
    usePlaybackStore.setState({ ...initialPlaybackState });
    useLibraryStore.setState({ ...initialLibraryState });
    useMultiFadeStore.setState({
      active: false, originPadId: null, selectedPads: new Map(), reopenPadId: null,
    });
    vi.clearAllMocks();
    vi.mocked(stopPad).mockReturnValue(undefined as unknown as ReturnType<typeof stopPad>);
  });

  describe("header", () => {
    it("renders pad name in header", () => {
      renderContent();
      expect(screen.getByText("Kick")).toBeInTheDocument();
    });

    it("renders Edit, Duplicate, and Delete buttons", () => {
      renderContent();
      expect(screen.getByRole("button", { name: /edit pad/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /duplicate pad/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /delete pad/i })).toBeInTheDocument();
    });

    it("clicking Edit calls onEditClick with the pad and onClose", async () => {
      const { pad, onEditClick, onClose } = renderContent();
      await userEvent.click(screen.getByRole("button", { name: /edit pad/i }));
      expect(onEditClick).toHaveBeenCalledWith(pad);
      expect(onClose).toHaveBeenCalled();
    });

    it("clicking Duplicate calls duplicatePad and onClose", async () => {
      renderContent();
      await userEvent.click(screen.getByRole("button", { name: /duplicate pad/i }));
      const pads = useProjectStore.getState().project!.scenes[0].pads;
      expect(pads).toHaveLength(2);
    });

    it("clicking Delete opens ConfirmDeletePadDialog", async () => {
      renderContent();
      await userEvent.click(screen.getByRole("button", { name: /delete pad/i }));
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
    });

    it("confirming delete calls stopPad and deletePad", async () => {
      renderContent();
      await userEvent.click(screen.getByRole("button", { name: /delete pad/i }));
      const confirmBtn = await screen.findByRole("button", { name: /^delete$/i });
      await userEvent.click(confirmBtn);
      expect(stopPad).toHaveBeenCalled();
      expect(useProjectStore.getState().project!.scenes[0].pads).toHaveLength(0);
    });
  });

  describe("full mode content", () => {
    it("renders Start button when pad is not playing", () => {
      renderContent();
      expect(screen.getByRole("button", { name: /start/i })).toBeInTheDocument();
    });

    it("renders Fade In button when pad is not playing", () => {
      renderContent();
      expect(screen.getByRole("button", { name: /fade in/i })).toBeInTheDocument();
    });

    it("renders Synchronized Fades button", () => {
      renderContent();
      expect(screen.getByRole("button", { name: /synchronized fades/i })).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd C:\Repos\sounds-bored && npx tsc --noEmit && npm run test:run -- PadControlContent.test
```

Expected: compilation error (module not found) or test failures — `PadControlContent` does not exist yet.

- [ ] **Step 3: Create PadControlContent.tsx**

Create `src/components/composite/SceneView/PadControlContent.tsx` with the full implementation. This is a large file — copy the existing `PadLiveControlContent`, `LayerRow`, and `getSoundsForLayer` bodies from `PadLiveControlPopover.tsx` verbatim, then add the header and ResizeObserver on top.

```tsx
import { useState, useEffect, useRef, useCallback, memo, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  PlayIcon,
  StopIcon,
  VolumeHighIcon,
  NextIcon,
  PreviousIcon,
  ListMusicIcon,
  PencilEdit01Icon,
  Copy01Icon,
  Delete02Icon,
  Settings01Icon,
  Layers01Icon,
} from "@hugeicons/core-free-icons";
import { usePlaybackStore } from "@/state/playbackStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { useProjectStore } from "@/state/projectStore";
import {
  isPadActive,
  isLayerActive as checkLayerActive,
  getLayerChain,
  getLayerPlayOrder,
} from "@/lib/audio/audioState";
import {
  triggerPad,
  stopPad,
  fadePadWithLevels,
  triggerLayer,
  stopLayerWithRamp,
  setLayerVolume,
  commitLayerVolume,
  setPadVolume,
  skipLayerForward,
  skipLayerBack,
} from "@/lib/audio/padPlayer";
import type { Pad, Sound, Layer } from "@/lib/schemas";
import { toast } from "sonner";
import { useLibraryStore } from "@/state/libraryStore";
import { cn } from "@/lib/utils";
import { ConfirmDeletePadDialog } from "@/components/modals/ConfirmDeletePadDialog";

const STAGGER_DELAY = 0.04;

type DisplayMode = "full" | "condensed" | "scroll";

function getDisplayMode(height: number): DisplayMode {
  if (height >= 280) return "full";
  if (height >= 120) return "condensed";
  return "scroll";
}

export interface PadControlContentProps {
  pad: Pad;
  sceneId: string;
  onClose: () => void;
  onEditClick?: (pad: Pad) => void;
}

export function getSoundsForLayer(layer: Layer, sounds: Sound[]): Sound[] {
  const sel = layer.selection;
  switch (sel.type) {
    case "assigned":
      return sel.instances
        .map((inst) => sounds.find((s) => s.id === inst.soundId))
        .filter((s): s is Sound => s !== undefined);
    case "tag":
      return sounds.filter((s) => {
        if (sel.matchMode === "all") {
          return sel.tagIds.every((id) => s.tags.includes(id));
        }
        return sel.tagIds.some((id) => s.tags.includes(id));
      });
    case "set":
      return sounds.filter((s) => s.sets.includes(sel.setId));
  }
}

// ─── LayerRow ────────────────────────────────────────────────────────────────
// Copied verbatim from PadLiveControlPopover.tsx — no logic changes.

function LayerRow({
  pad,
  layer,
  idx,
  layerActive,
}: {
  pad: Pad;
  layer: Pad["layers"][number];
  idx: number;
  layerActive: boolean;
}) {
  const layerVol = usePlaybackStore(
    (s) => Math.round((s.layerVolumes[layer.id] ?? (layer.volume / 100)) * 100)
  );
  const isChainedArrangement =
    layer.arrangement === "sequential" || layer.arrangement === "shuffled";
  const showSkip = isChainedArrangement;

  const sounds = useLibraryStore((s) => s.sounds);
  const allSounds = useMemo(
    () => getSoundsForLayer(layer, sounds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layer.selection, sounds]
  );
  const tags = useLibraryStore((s) => s.tags);
  const sets = useLibraryStore((s) => s.sets);
  const missingSoundIds = useLibraryStore((s) => s.missingSoundIds);

  const [listOpen, setListOpen] = useState(false);
  const listAnchorRef = useRef<HTMLButtonElement>(null);

  const totalSoundCount =
    layer.selection.type === "assigned"
      ? layer.selection.instances.length
      : allSounds.length;

  const selectionTitle = (() => {
    const sel = layer.selection;
    switch (sel.type) {
      case "assigned":
        return "Sounds";
      case "tag": {
        const names = sel.tagIds
          .map((id) => tags.find((t) => t.id === id)?.name ?? id)
          .join(", ");
        return `Tag: ${names}`;
      }
      case "set": {
        const name = sets.find((s) => s.id === sel.setId)?.name ?? sel.setId;
        return `Set: ${name}`;
      }
    }
  })();

  const [currentSoundId, setCurrentSoundId] = useState<string | null>(null);
  const [activePlayOrder, setActivePlayOrder] = useState<Sound[] | null>(null);
  const soundRafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!layerActive || !isChainedArrangement) {
      setCurrentSoundId(null);
      setActivePlayOrder(null);
      if (soundRafRef.current !== null) {
        cancelAnimationFrame(soundRafRef.current);
        soundRafRef.current = null;
      }
      return;
    }
    const poll = () => {
      const playOrder = getLayerPlayOrder(layer.id);
      const chain = getLayerChain(layer.id);
      if (playOrder && playOrder.length > 0) {
        setActivePlayOrder((prev) => (prev === playOrder ? prev : playOrder));
        const chainLength = chain?.length ?? 0;
        const currentIdx = Math.max(0, playOrder.length - chainLength - 1);
        const currentSound = playOrder[currentIdx];
        const nextId = currentSound?.id ?? null;
        setCurrentSoundId((prev) => (prev === nextId ? prev : nextId));
      } else {
        setActivePlayOrder(null);
        setCurrentSoundId(null);
      }
      soundRafRef.current = requestAnimationFrame(poll);
    };
    soundRafRef.current = requestAnimationFrame(poll);
    return () => {
      if (soundRafRef.current !== null) {
        cancelAnimationFrame(soundRafRef.current);
        soundRafRef.current = null;
      }
      setCurrentSoundId(null);
      setActivePlayOrder(null);
    };
  }, [layerActive, isChainedArrangement, layer.id]);

  const displayText = (() => {
    if (layerActive && isChainedArrangement && currentSoundId) {
      const current = allSounds.find((s) => s.id === currentSoundId);
      return current?.name ?? allSounds.map((s) => s.name).join(" · ");
    }
    return allSounds.map((s) => s.name).join(" · ");
  })();

  const containerRef = useRef<HTMLDivElement>(null);
  const [isOverflow, setIsOverflow] = useState(false);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setIsOverflow(el.scrollWidth > el.clientWidth);
  }, [displayText]);

  return (
    <motion.div
      key={layer.id}
      className="flex flex-col gap-1 rounded-lg bg-muted/50 p-1.5"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.12, delay: STAGGER_DELAY * 2 + idx * 0.03 }}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={`text-xs ${layerActive ? "text-emerald-400" : "text-muted-foreground"}`}
        >
          {layerActive ? "\u25CF" : "\u25CB"}
        </span>
        <span className="text-xs font-medium flex-1 truncate">
          {layer.name || `Layer ${idx + 1}`}
        </span>
        <AnimatePresence mode="wait">
          {layerActive ? (
            <motion.div
              key="stop-layer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.1 }}
            >
              <button
                type="button"
                onClick={() => stopLayerWithRamp(pad, layer.id)}
                className="p-0.5 rounded hover:bg-destructive/20 transition-colors"
                aria-label={`Stop ${layer.name || `Layer ${idx + 1}`}`}
              >
                <HugeiconsIcon icon={StopIcon} size={12} />
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="play-layer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.1 }}
            >
              <button
                type="button"
                onClick={() => {
                  triggerLayer(pad, layer).catch((err: unknown) => {
                    const message = err instanceof Error ? err.message : String(err);
                    toast.error(`Playback error: ${message}`);
                  });
                }}
                className="p-0.5 rounded hover:bg-primary/20 transition-colors"
                aria-label={`Play ${layer.name || `Layer ${idx + 1}`}`}
              >
                <HugeiconsIcon icon={PlayIcon} size={12} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        {showSkip && (
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
      </div>
      {allSounds.length > 0 && (
        <div className="flex items-center gap-1" data-testid="layer-sound-display">
          <div ref={containerRef} className="overflow-hidden flex-1 min-w-0">
            {isOverflow ? (
              <div
                className="flex gap-8"
                style={{ animation: "marquee 10s linear infinite" }}
              >
                <span className="whitespace-nowrap text-xs text-muted-foreground">
                  {displayText}
                </span>
                <span
                  className="whitespace-nowrap text-xs text-muted-foreground"
                  aria-hidden
                >
                  {displayText}
                </span>
              </div>
            ) : (
              <span className="whitespace-nowrap text-xs text-muted-foreground">
                {displayText}
              </span>
            )}
          </div>
          {totalSoundCount > 1 && (
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
                <PopoverAnchor
                  virtualRef={
                    listAnchorRef as React.RefObject<{
                      getBoundingClientRect: () => DOMRect;
                    }>
                  }
                />
                <PopoverContent side="top" sideOffset={6} className="w-48 p-2">
                  <p className="text-xs font-semibold mb-1.5">{selectionTitle}</p>
                  <ol className="flex flex-col gap-0.5 max-h-48 overflow-y-auto">
                    {(activePlayOrder ?? allSounds).map((sound, i) => (
                      <li
                        key={sound.id}
                        className={cn(
                          "text-xs py-0.5",
                          currentSoundId === sound.id
                            ? "font-semibold text-foreground"
                            : missingSoundIds.has(sound.id)
                            ? "text-muted-foreground italic"
                            : "text-muted-foreground"
                        )}
                      >
                        {i + 1}. {sound.name}
                      </li>
                    ))}
                  </ol>
                </PopoverContent>
              </Popover>
            </>
          )}
        </div>
      )}
      <Slider
        compact
        tooltipLabel={(v) => `${v}%`}
        value={[layerVol]}
        onValueChange={([v]) => setLayerVolume(layer.id, v / 100)}
        onValueCommit={([v]) => commitLayerVolume(layer.id, v / 100)}
        min={0}
        max={100}
        step={1}
      />
    </motion.div>
  );
}

// ─── PadControlContent ───────────────────────────────────────────────────────

export const PadControlContent = memo(function PadControlContent({
  pad,
  sceneId,
  onClose,
  onEditClick,
}: PadControlContentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("full");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [subPopover, setSubPopover] = useState<null | "fade" | "layers">(null);
  const fadeOptionsAnchorRef = useRef<HTMLButtonElement>(null);
  const layersAnchorRef = useRef<HTMLButtonElement>(null);

  const duplicatePad = useProjectStore((s) => s.duplicatePad);
  const deletePad = useProjectStore((s) => s.deletePad);
  const updatePad = useProjectStore((s) => s.updatePad);

  const isPlaying = usePlaybackStore((s) => s.playingPadIds.has(pad.id));
  const padVolume = usePlaybackStore((s) => s.padVolumes[pad.id] ?? 1.0);
  const enterMultiFade = useMultiFadeStore((s) => s.enterMultiFade);
  const globalFadeDurationMs = useAppSettingsStore(
    (s) => s.settings?.globalFadeDurationMs ?? 2000
  );
  const fadeDuration = pad.fadeDurationMs ?? globalFadeDurationMs;

  const [fadeLevels, setFadeLevels] = useState<[number, number]>([0, 100]);
  const startThumbDraggingRef = useRef(false);

  // ResizeObserver — switches display mode based on available height
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setDisplayMode(getDisplayMode(el.getBoundingClientRect().height));
    const ro = new ResizeObserver(([entry]) => {
      setDisplayMode(getDisplayMode(entry.contentRect.height));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Reset end thumb when pad stops
  useEffect(() => {
    if (!isPlaying) setFadeLevels([0, 100]);
  }, [isPlaying]);

  // Sync right thumb from padVolume when not actively dragging
  useEffect(() => {
    if (!startThumbDraggingRef.current) {
      setFadeLevels((prev) => {
        const newRight = Math.round(padVolume * 100);
        return prev[1] === newRight ? prev : [prev[0], newRight];
      });
    }
  }, [padVolume]);

  // Clear startThumbDraggingRef on pointer release anywhere
  useEffect(() => {
    const handlePointerUp = () => {
      if (startThumbDraggingRef.current) {
        startThumbDraggingRef.current = false;
        usePlaybackStore.getState().clearVolumeTransition(pad.id);
      }
    };
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointerup", handlePointerUp);
      if (startThumbDraggingRef.current) {
        startThumbDraggingRef.current = false;
        usePlaybackStore.getState().clearVolumeTransition(pad.id);
      }
    };
  }, [pad.id]);

  // Track active layers via RAF while pad is playing
  const [activeLayerIds, setActiveLayerIds] = useState<Set<string>>(new Set());
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isPlaying) {
      setActiveLayerIds((prev) => (prev.size === 0 ? prev : new Set()));
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }
    const poll = () => {
      const active = new Set<string>();
      for (const layer of pad.layers) {
        if (checkLayerActive(layer.id)) active.add(layer.id);
      }
      setActiveLayerIds((prev) => {
        if (prev.size === active.size && [...active].every((id) => prev.has(id))) return prev;
        return active;
      });
      rafRef.current = requestAnimationFrame(poll);
    };
    rafRef.current = requestAnimationFrame(poll);
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      setActiveLayerIds(new Set());
    };
  }, [isPlaying, pad.layers]);

  const handleStartStop = useCallback(() => {
    if (isPlaying) {
      stopPad(pad);
    } else {
      triggerPad(pad).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`Playback error: ${message}`);
      });
    }
  }, [isPlaying, pad]);

  const handleFade = useCallback(() => {
    const fromLevel = fadeLevels[0] / 100;
    const toLevel = fadeLevels[1] / 100;
    fadePadWithLevels(pad, fadeDuration, fromLevel, toLevel).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Playback error: audio fade failed — ${message}`);
    });
    onClose();
  }, [pad, fadeLevels, fadeDuration, onClose]);

  const handleMultiFade = useCallback(() => {
    const playing = isPadActive(pad.id);
    enterMultiFade(pad.id, playing, padVolume);
    onClose();
  }, [pad.id, padVolume, enterMultiFade, onClose]);

  const fadeSection = (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{isPlaying ? "end" : "start"}</span>
        <span>{isPlaying ? "start (current)" : "end"}</span>
      </div>
      <Slider
        tooltipLabel={(v) => `${v}%`}
        value={fadeLevels}
        onValueChange={(v) => {
          const next = v as [number, number];
          if (isPlaying && next[1] !== fadeLevels[1]) {
            setPadVolume(pad.id, next[1] / 100);
            usePlaybackStore.getState().startVolumeTransition(pad.id);
          }
          setFadeLevels(next);
        }}
        onPointerUp={() => {
          if (startThumbDraggingRef.current) {
            startThumbDraggingRef.current = false;
            usePlaybackStore.getState().clearVolumeTransition(pad.id);
          }
        }}
        onThumbPointerDown={(index) => {
          if (index === 1) startThumbDraggingRef.current = true;
        }}
        min={0}
        max={100}
        step={1}
      />
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Fade Duration</span>
          <span className="tabular-nums">{(fadeDuration / 1000).toFixed(1)}s</span>
        </div>
        <Slider
          compact
          tooltipLabel={(v) => `${(v / 1000).toFixed(1)}s`}
          value={[fadeDuration]}
          onValueChange={([v]) => {
            const { id, ...config } = pad;
            updatePad(sceneId, id, { ...config, fadeDurationMs: v });
          }}
          min={100}
          max={10000}
          step={100}
        />
        {pad.fadeDurationMs !== undefined ? (
          <button
            type="button"
            className="text-xs text-muted-foreground underline self-start"
            onClick={() => {
              const { id, ...config } = pad;
              updatePad(sceneId, id, { ...config, fadeDurationMs: undefined });
            }}
          >
            Reset to default
          </button>
        ) : (
          <p className="text-xs text-muted-foreground">
            Global default ({(globalFadeDurationMs / 1000).toFixed(1)}s)
          </p>
        )}
      </div>
      <Button size="sm" variant="secondary" onClick={handleFade} className="w-full gap-1.5">
        <HugeiconsIcon icon={VolumeHighIcon} size={14} />
        {isPlaying ? "Fade Out" : "Fade In"}
      </Button>
    </div>
  );

  const layersSection = (
    <div className="flex flex-col gap-1">
      {pad.layers.map((layer, idx) => (
        <LayerRow
          key={layer.id}
          pad={pad}
          layer={layer}
          idx={idx}
          layerActive={activeLayerIds.has(layer.id)}
        />
      ))}
    </div>
  );

  return (
    <>
      <div
        ref={containerRef}
        className={cn(
          "flex flex-col gap-3 w-full h-full",
          displayMode === "scroll" && "overflow-y-auto"
        )}
      >
        {/* Header — always visible */}
        <motion.div
          className="flex items-center gap-1"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15 }}
        >
          <h3 className="font-deathletter tracking-wider text-base font-semibold truncate flex-1 min-w-0">
            {pad.name}
          </h3>
          <Button
            size="icon-xs"
            variant="default"
            aria-label="Edit pad"
            onClick={() => { onEditClick?.(pad); onClose(); }}
          >
            <HugeiconsIcon icon={PencilEdit01Icon} size={12} />
          </Button>
          <Button
            size="icon-xs"
            variant="secondary"
            aria-label="Duplicate pad"
            onClick={() => { duplicatePad(sceneId, pad.id); onClose(); }}
          >
            <HugeiconsIcon icon={Copy01Icon} size={12} />
          </Button>
          <Button
            size="icon-xs"
            variant="destructive"
            aria-label="Delete pad"
            onClick={() => setConfirmingDelete(true)}
          >
            <HugeiconsIcon icon={Delete02Icon} size={12} />
          </Button>
        </motion.div>

        {/* ── Full mode ─────────────────────────────────────────────────── */}
        {displayMode === "full" && (
          <>
            <motion.div
              className="flex flex-col gap-2"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15, delay: STAGGER_DELAY }}
            >
              <AnimatePresence mode="wait">
                {isPlaying ? (
                  <motion.div
                    key="stop"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.1 }}
                  >
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={handleStartStop}
                      className="w-full gap-1.5"
                    >
                      <HugeiconsIcon icon={StopIcon} size={14} />
                      Stop
                    </Button>
                  </motion.div>
                ) : (
                  <motion.div
                    key="play"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.1 }}
                  >
                    <Button
                      size="sm"
                      variant="default"
                      onClick={handleStartStop}
                      className="w-full gap-1.5"
                    >
                      <HugeiconsIcon icon={PlayIcon} size={14} />
                      Start
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
              {fadeSection}
            </motion.div>

            <motion.div
              className="flex flex-col gap-1.5"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15, delay: STAGGER_DELAY * 2 }}
            >
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Layers
              </h4>
              {layersSection}
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15, delay: STAGGER_DELAY * 3 }}
            >
              <Button
                size="sm"
                variant="ghost"
                onClick={handleMultiFade}
                className="bg-yellow-500 w-full text-xs"
              >
                Synchronized Fades
              </Button>
            </motion.div>
          </>
        )}

        {/* ── Condensed / Scroll mode ───────────────────────────────────── */}
        {(displayMode === "condensed" || displayMode === "scroll") && (
          <>
            {/* Start/Stop */}
            <AnimatePresence mode="wait">
              {isPlaying ? (
                <motion.div
                  key="stop-c"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.1 }}
                >
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleStartStop}
                    className="w-full gap-1.5"
                  >
                    <HugeiconsIcon icon={StopIcon} size={14} />
                    Stop
                  </Button>
                </motion.div>
              ) : (
                <motion.div
                  key="play-c"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.1 }}
                >
                  <Button
                    size="sm"
                    variant="default"
                    onClick={handleStartStop}
                    className="w-full gap-1.5"
                  >
                    <HugeiconsIcon icon={PlayIcon} size={14} />
                    Start
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Compact action row */}
            <div className="flex items-center gap-1">
              {/* Fade In/Out — fires with default levels */}
              <Button
                size="sm"
                variant="secondary"
                onClick={handleFade}
                className="flex-1 gap-1 text-xs"
              >
                <HugeiconsIcon icon={VolumeHighIcon} size={12} />
                {isPlaying ? "Fade Out" : "Fade In"}
              </Button>

              {/* Fade options sub-popover anchor */}
              <Button
                ref={fadeOptionsAnchorRef}
                size="icon-xs"
                variant="outline"
                aria-label="Fade options"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() =>
                  setSubPopover((p) => (p === "fade" ? null : "fade"))
                }
              >
                <HugeiconsIcon icon={Settings01Icon} size={12} />
              </Button>

              {/* Layers sub-popover anchor */}
              <Button
                ref={layersAnchorRef}
                size="icon-xs"
                variant="outline"
                aria-label="Layers"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() =>
                  setSubPopover((p) => (p === "layers" ? null : "layers"))
                }
              >
                <HugeiconsIcon icon={Layers01Icon} size={12} />
              </Button>

              {/* Synchronized Fades — fires directly */}
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Synchronized Fades"
                className="bg-yellow-500"
                onClick={handleMultiFade}
              >
                <HugeiconsIcon icon={PlayIcon} size={12} />
              </Button>
            </div>

            {/* Fade options sub-popover */}
            <Popover
              open={subPopover === "fade"}
              onOpenChange={(o) => setSubPopover(o ? "fade" : null)}
            >
              <PopoverAnchor
                virtualRef={
                  fadeOptionsAnchorRef as React.RefObject<{
                    getBoundingClientRect: () => DOMRect;
                  }>
                }
              />
              <PopoverContent side="top" sideOffset={6} className="w-64 p-3">
                {fadeSection}
              </PopoverContent>
            </Popover>

            {/* Layers sub-popover */}
            <Popover
              open={subPopover === "layers"}
              onOpenChange={(o) => setSubPopover(o ? "layers" : null)}
            >
              <PopoverAnchor
                virtualRef={
                  layersAnchorRef as React.RefObject<{
                    getBoundingClientRect: () => DOMRect;
                  }>
                }
              />
              <PopoverContent side="top" sideOffset={6} className="w-64 p-3">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                  Layers
                </h4>
                {layersSection}
              </PopoverContent>
            </Popover>
          </>
        )}
      </div>

      <ConfirmDeletePadDialog
        isOpen={confirmingDelete}
        padName={pad.name}
        onConfirm={() => {
          setConfirmingDelete(false);
          stopPad(pad);
          deletePad(sceneId, pad.id);
          onClose();
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
    </>
  );
});
```

**Note on icons:** `Layers01Icon` and `Settings01Icon` must exist in `@hugeicons/core-free-icons`. If `tsc --noEmit` reports them missing, replace with any available icon (e.g. `ListMusicIcon`, `Menu01Icon`). Check with: `grep -r "Layers01Icon\|Settings01Icon" node_modules/@hugeicons/core-free-icons/dist` or just attempt the TSC check in the next step.

- [ ] **Step 4: Run TypeScript check and tests**

```bash
cd C:\Repos\sounds-bored && npx tsc --noEmit && npm run test:run -- PadControlContent.test
```

Expected: all tests pass. If any icon imports fail TSC, replace the missing icon name with an available one (see Note above).

- [ ] **Step 5: Commit**

```bash
git add src/components/composite/SceneView/PadControlContent.tsx src/components/composite/SceneView/PadControlContent.test.tsx
git commit -m "feat: extract PadControlContent with header actions and responsive display modes"
```

---

## Task 2: Add condensed/scroll mode tests

**Files:**
- Modify: `src/components/composite/SceneView/PadControlContent.test.tsx`

The condensed and scroll mode rendering is already in the implementation from Task 1. This task adds the tests to verify the responsive switching.

- [ ] **Step 1: Add ResizeObserver mock and condensed/scroll tests**

Add the following describe block at the end of the `describe("PadControlContent", ...)` block in `PadControlContent.test.tsx`:

```tsx
describe("responsive display modes", () => {
  // Each test sets up a ResizeObserver mock that fires with a specific height,
  // then verifies which layout is rendered.

  function mockResizeObserverWithHeight(height: number) {
    const callbacks: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      vi.fn().mockImplementation((cb: ResizeObserverCallback) => {
        callbacks.push(cb);
        return {
          observe: vi.fn().mockImplementation(() => {
            // Fire immediately with the specified height
            cb(
              [{ contentRect: { height } } as ResizeObserverEntry],
              {} as ResizeObserver
            );
          }),
          unobserve: vi.fn(),
          disconnect: vi.fn(),
        };
      })
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("full mode (>=280px): renders fade section and layers section", () => {
    mockResizeObserverWithHeight(300);
    renderContent();
    // Fade section has "start"/"end" labels and fade button
    expect(screen.getByText(/fade in/i)).toBeInTheDocument();
    // Layers section heading
    expect(screen.getByText(/^layers$/i)).toBeInTheDocument();
    // Synchronized fades button
    expect(screen.getByRole("button", { name: /synchronized fades/i })).toBeInTheDocument();
    // Condensed compact row should NOT be present
    expect(screen.queryByRole("button", { name: /fade options/i })).not.toBeInTheDocument();
  });

  it("condensed mode (>=120px, <280px): renders compact action row with sub-popover buttons", () => {
    mockResizeObserverWithHeight(150);
    renderContent();
    // Compact Fade In/Out button present
    expect(screen.getByRole("button", { name: /fade (in|out)/i })).toBeInTheDocument();
    // Sub-popover icon buttons
    expect(screen.getByRole("button", { name: /fade options/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /layers/i })).toBeInTheDocument();
    // Synchronized Fades icon button
    expect(screen.getByRole("button", { name: /synchronized fades/i })).toBeInTheDocument();
    // Full mode sections should not be visible
    expect(screen.queryByText(/^layers$/i)).not.toBeInTheDocument();
  });

  it("scroll mode (<120px): renders condensed layout (scroll is same layout, different container)", () => {
    mockResizeObserverWithHeight(80);
    renderContent();
    // Same condensed buttons present
    expect(screen.getByRole("button", { name: /fade options/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /layers/i })).toBeInTheDocument();
  });

  it("condensed mode: clicking Fade Options button opens fade sub-popover", async () => {
    mockResizeObserverWithHeight(150);
    renderContent();
    const fadeOptionsBtn = screen.getByRole("button", { name: /fade options/i });
    await userEvent.click(fadeOptionsBtn);
    // The sub-popover content should now be visible (mocked PopoverContent renders)
    const popoverContents = screen.getAllByTestId("popover-content");
    expect(popoverContents.length).toBeGreaterThan(0);
  });

  it("condensed mode: clicking Layers button opens layers sub-popover", async () => {
    mockResizeObserverWithHeight(150);
    renderContent();
    const layersBtn = screen.getByRole("button", { name: /^layers$/i });
    await userEvent.click(layersBtn);
    const popoverContents = screen.getAllByTestId("popover-content");
    expect(popoverContents.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
cd C:\Repos\sounds-bored && npx tsc --noEmit && npm run test:run -- PadControlContent.test
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/composite/SceneView/PadControlContent.test.tsx
git commit -m "test: add responsive display mode tests for PadControlContent"
```

---

## Task 3: Update PadLiveControlPopover to use PadControlContent

**Files:**
- Modify: `src/components/composite/SceneView/PadLiveControlPopover.tsx`
- Modify: `src/components/composite/SceneView/PadLiveControlPopover.test.tsx`

- [ ] **Step 1: Rewrite PadLiveControlPopover.tsx**

The file becomes a thin wrapper. Delete everything except the popover/drawer shell and re-export `getSoundsForLayer` for backward compatibility.

Replace the entire file content with:

```tsx
import { useCallback, memo } from "react";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useIsMd } from "@/hooks/useBreakpoint";
import type { Pad } from "@/lib/schemas";
import { PadControlContent } from "./PadControlContent";

// Re-export so existing test imports don't break until Task 4 updates them
export { getSoundsForLayer } from "./PadControlContent";

interface PadLiveControlPopoverProps {
  pad: Pad;
  sceneId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
}

export const PadLiveControlPopover = memo(function PadLiveControlPopover({
  pad,
  sceneId,
  open,
  onOpenChange,
  anchorRef,
}: PadLiveControlPopoverProps) {
  const isDesktop = useIsMd();

  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  if (!isDesktop) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent>
          {/* sr-only title satisfies accessibility without duplicating the visible header */}
          <DrawerTitle className="sr-only">{pad.name}</DrawerTitle>
          <div className="px-4 pb-4 pt-2">
            <PadControlContent pad={pad} sceneId={sceneId} onClose={handleClose} />
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor
        virtualRef={
          anchorRef as React.RefObject<{ getBoundingClientRect: () => DOMRect }>
        }
      />
      <PopoverContent className="w-72" side="top" sideOffset={10} showArrow>
        <PadControlContent pad={pad} sceneId={sceneId} onClose={handleClose} />
      </PopoverContent>
    </Popover>
  );
});
```

- [ ] **Step 2: Update PadLiveControlPopover.test.tsx**

The test file needs two changes:
1. The `getSoundsForLayer` tests already pass via the re-export — no import change needed yet.
2. The mobile drawer test currently passes because the name appears twice. After the fix it appears once (in `PadControlContent` header) plus once in `DrawerTitle` (sr-only). We need to add a mock for `PadControlContent`.

Add a mock for `PadControlContent` at the top of the file (after the existing mocks), so the popover tests remain fast and isolated:

```tsx
// Add after the existing vi.mock("@/lib/audio/audioState", ...) call:
vi.mock("./PadControlContent", () => ({
  PadControlContent: ({ pad }: { pad: { name: string } }) => (
    <div data-testid="pad-control-content">
      <span>{pad.name}</span>
    </div>
  ),
  getSoundsForLayer: (await import("./PadControlContent")).getSoundsForLayer,
}));
```

Wait — that pattern won't work cleanly because `getSoundsForLayer` tests are in the same file and need the real implementation. The better approach: **move the `getSoundsForLayer` tests to `PadControlContent.test.tsx`** and update the import in the test from `"./PadLiveControlPopover"` to `"./PadControlContent"`.

Here is the complete set of changes to `PadLiveControlPopover.test.tsx`:

**a) Remove the `getSoundsForLayer` import from this file and its test suite.** Those tests move to `PadControlContent.test.tsx` in a follow-up (Step 3 below).

**b) Change the import at line 5** from:
```tsx
import { PadLiveControlPopover, getSoundsForLayer } from "./PadLiveControlPopover";
```
to:
```tsx
import { PadLiveControlPopover } from "./PadLiveControlPopover";
import { getSoundsForLayer } from "./PadControlContent";
```

**c) Add a mock for `PadControlContent`** right after the existing `vi.mock("@/lib/audio/audioState", ...)` block:
```tsx
vi.mock("./PadControlContent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./PadControlContent")>();
  return {
    ...actual,
    PadControlContent: ({ pad, onClose }: { pad: { name: string }; onClose: () => void }) => (
      <div data-testid="pad-control-content">
        <span>{pad.name}</span>
        <button type="button" onClick={onClose}>Close</button>
      </div>
    ),
  };
});
```

**d) Update the mobile drawer test** to assert exactly one rendered instance of the pad name in non-sr-only content:
```tsx
it("renders a Drawer instead of Popover on mobile", () => {
  vi.mocked(useIsMd).mockReturnValue(false);
  renderPopover({ name: "Mobile Test Pad" });

  // PadControlContent mock renders the name; sr-only DrawerTitle also renders it
  // — but only the mock's span is non-hidden. Assert it appears at least once.
  expect(screen.getAllByText("Mobile Test Pad").length).toBeGreaterThanOrEqual(1);

  // Verify popover-content is NOT present (drawer renders instead)
  expect(screen.queryByTestId("popover-content")).not.toBeInTheDocument();

  // Verify PadControlContent rendered (our mock)
  expect(screen.getByTestId("pad-control-content")).toBeInTheDocument();
});
```

**e) Add `getSoundsForLayer` tests to `PadControlContent.test.tsx`** (copy the entire `describe("getSoundsForLayer", ...)` block from `PadLiveControlPopover.test.tsx` into `PadControlContent.test.tsx`, updating the import at the top of that file to include `getSoundsForLayer`):

In `PadControlContent.test.tsx`, update the import line:
```tsx
import { PadControlContent, getSoundsForLayer } from "./PadControlContent";
```

Then paste the full `describe("getSoundsForLayer", ...)` block (lines 626–703 of the current `PadLiveControlPopover.test.tsx`) at the end of `PadControlContent.test.tsx`.

Finally, **delete** the `describe("getSoundsForLayer", ...)` block from `PadLiveControlPopover.test.tsx`.

- [ ] **Step 3: Run TypeScript check and all tests**

```bash
cd C:\Repos\sounds-bored && npx tsc --noEmit && npm run test:run -- PadLiveControlPopover.test PadControlContent.test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/composite/SceneView/PadLiveControlPopover.tsx src/components/composite/SceneView/PadLiveControlPopover.test.tsx src/components/composite/SceneView/PadControlContent.test.tsx
git commit -m "refactor: PadLiveControlPopover delegates to PadControlContent; fix duplicate mobile heading"
```

---

## Task 4: Update PadButton back face to use PadControlContent

**Files:**
- Modify: `src/components/composite/SceneView/PadButton.tsx`
- Modify: `src/components/composite/SceneView/PadButton.test.tsx`

- [ ] **Step 1: Update PadButton.tsx**

Make the following changes to `PadButton.tsx`:

**a) Update imports** — remove `PencilEdit01Icon`, `Copy01Icon`, `Delete02Icon`, `ConfirmDeletePadDialog`. Add `PadControlContent`:

Remove:
```tsx
import { PencilEdit01Icon, Copy01Icon, Delete02Icon, Alert02Icon } from "@hugeicons/core-free-icons";
import { ConfirmDeletePadDialog } from "@/components/modals/ConfirmDeletePadDialog";
```

Add:
```tsx
import { Alert02Icon } from "@hugeicons/core-free-icons";
import { PadControlContent } from "./PadControlContent";
```

**b) Remove `confirmingDelete` state and `duplicatePad`/`deletePad` store selectors** from the component body. Those have moved to `PadControlContent`. The `stopPad` import can also be removed from `@/lib/audio/padPlayer` (it was only used in the delete confirm handler).

Remove these lines from the component:
```tsx
const duplicatePad = useProjectStore((s) => s.duplicatePad);
const deletePad = useProjectStore((s) => s.deletePad);
const [confirmingDelete, setConfirmingDelete] = useState(false);
```

Update the padPlayer import to remove `stopPad` (keep `getPadProgress` and `setPadVolume`):
```tsx
import { getPadProgress, setPadVolume } from "@/lib/audio/padPlayer";
```

**c) Replace the back face JSX** — find the block starting with `{/* Back face — edit overlay */}` and replace it entirely:

Old back face (lines 392–433):
```tsx
{/* Back face — edit overlay */}
<div
  className="absolute inset-0 rounded-xl overflow-hidden bg-card flex flex-col items-center justify-between p-1.5 [backface-visibility:hidden]"
  style={{ transform: 'rotateY(180deg)', backgroundColor: pad.color ?? undefined }}
  aria-hidden={!editMode || undefined}
>
  {/* Dark overlay for readability — sits on top of the pad color */}
  <div className="absolute inset-0 bg-black/60" />
  <div className="relative z-10 flex flex-col items-center gap-0.5">
    <span className="text-white text-xs font-semibold line-clamp-2 text-center leading-tight">
      {pad.name}
    </span>
    <span className="text-white/70 text-xs">
      {layerCount} {layerCount === 1 ? "layer" : "layers"}
    </span>
  </div>
  <div className="relative z-10 flex gap-1">
    <button
      type="button"
      aria-label="Edit pad"
      onClick={(e) => { e.stopPropagation(); onEditClick?.(pad); }}
      className="p-1 rounded bg-white/20 hover:bg-white/40 transition-colors"
    >
      <HugeiconsIcon icon={PencilEdit01Icon} size={14} className="text-white" />
    </button>
    <button
      type="button"
      aria-label="Duplicate pad"
      onClick={(e) => { e.stopPropagation(); duplicatePad(sceneId, pad.id); }}
      className="p-1 rounded bg-white/20 hover:bg-white/40 transition-colors"
    >
      <HugeiconsIcon icon={Copy01Icon} size={14} className="text-white" />
    </button>
    <button
      type="button"
      aria-label="Delete pad"
      onClick={(e) => { e.stopPropagation(); setConfirmingDelete(true); }}
      className="p-1 rounded bg-white/20 hover:bg-red-500/80 transition-colors"
    >
      <HugeiconsIcon icon={Delete02Icon} size={14} className="text-white" />
    </button>
  </div>
</div>
```

New back face:
```tsx
{/* Back face — shared control panel */}
<div
  className="absolute inset-0 rounded-xl overflow-hidden [backface-visibility:hidden]"
  style={{ transform: 'rotateY(180deg)', backgroundColor: pad.color ?? undefined }}
  aria-hidden={!editMode || undefined}
>
  {/* Dark overlay for readability */}
  <div className="absolute inset-0 bg-black/60" />
  <div className="relative z-10 w-full h-full p-2">
    <PadControlContent
      pad={pad}
      sceneId={sceneId}
      onClose={() => {}}
      onEditClick={onEditClick}
    />
  </div>
</div>
```

**d) Remove the standalone `<ConfirmDeletePadDialog>` and `<PadLiveControlPopover>` render at the bottom of the component** — wait, `PadLiveControlPopover` stays. Only remove `ConfirmDeletePadDialog`. The JSX at the bottom becomes:

```tsx
{/* PadLiveControlPopover stays — right-click in normal mode */}
<PadLiveControlPopover
  pad={pad}
  sceneId={sceneId}
  open={popoverOpen}
  onOpenChange={setPopoverOpen}
  anchorRef={buttonRef}
/>
```

(Remove the `<ConfirmDeletePadDialog .../>` block entirely — it now lives inside `PadControlContent`.)

Also remove the `layerCount` variable if it's now unused:
```tsx
// Remove this line if layerCount is no longer referenced:
const layerCount = pad.layers.length;
```

- [ ] **Step 2: Update PadButton.test.tsx**

**a) Add a mock for `PadControlContent`** right after the existing `vi.mock("./PadLiveControlPopover", ...)` block:

```tsx
vi.mock("./PadControlContent", () => ({
  PadControlContent: ({
    pad,
    onEditClick,
    onClose,
  }: {
    pad: { name: string; id: string };
    onEditClick?: (pad: { name: string; id: string }) => void;
    onClose: () => void;
  }) => (
    <div data-testid="pad-control-content">
      <button
        type="button"
        aria-label="Edit pad"
        onClick={() => { onEditClick?.(pad); onClose(); }}
      />
      <button type="button" aria-label="Duplicate pad" />
      <button type="button" aria-label="Delete pad" />
    </div>
  ),
}));
```

**b) Update the edit mode describe block.** The "shows layer count in overlay" test no longer applies — `PadControlContent` does not render a layer count. Replace that test with one that checks `PadControlContent` is rendered on the back face:

Remove:
```tsx
it("shows layer count in overlay", () => {
  const pad = loadPadInStore();
  render(<PadButton pad={pad} sceneId="scene-1" />);
  expect(screen.getByText(/1 layer/i)).toBeInTheDocument();
});
```

Add:
```tsx
it("renders PadControlContent on the back face in edit mode", () => {
  const pad = loadPadInStore();
  render(<PadButton pad={pad} sceneId="scene-1" />);
  expect(screen.getByTestId("pad-control-content")).toBeInTheDocument();
});
```

**c) Update the remaining edit mode tests.** "shows the edit overlay with action buttons" and "clicking edit button calls onEditClick" still work via the mock — **leave them as-is.** Remove "clicking duplicate button calls duplicatePad" — with the mock, the duplicate button has no store logic, and this behaviour is already covered in `PadControlContent.test.tsx`.

**d) Remove the delete dialog tests from PadButton.test.tsx** — those are now tested in `PadControlContent.test.tsx`. Remove:
- `"clicking delete button shows confirm dialog"`
- `"confirming delete removes the pad"`
- `"confirming delete calls stopPad before removing the pad"`

- [ ] **Step 3: Run TypeScript check and full test suite**

```bash
cd C:\Repos\sounds-bored && npx tsc --noEmit && npm run test:run -- PadButton.test PadControlContent.test PadLiveControlPopover.test
```

Expected: all tests pass.

- [ ] **Step 4: Run the full test suite**

```bash
cd C:\Repos\sounds-bored && npm run test:run
```

Expected: all tests pass (no regressions in other test files).

- [ ] **Step 5: Commit**

```bash
git add src/components/composite/SceneView/PadButton.tsx src/components/composite/SceneView/PadButton.test.tsx
git commit -m "feat: use PadControlContent on back face; remove inline edit/delete from PadButton"
```
