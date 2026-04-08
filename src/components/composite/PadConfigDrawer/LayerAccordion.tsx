import { useState, useEffect, useRef, useMemo } from "react";
import { motion } from "motion/react";
import { DndContext, closestCenter, DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Alert02Icon } from "@hugeicons/core-free-icons";
import type { PadConfigForm } from "@/lib/schemas";
import { LayerConfigSection } from "./LayerConfigSection";
import { createDefaultLayer } from "./constants";
import { useLibraryStore } from "@/state/libraryStore";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type LayerWarning = {
  isEmpty: boolean;       // instances array is empty (layer is inert after auto-clean)
  missingNames: string[]; // display names of sounds that are in library but missing from disk
};

interface SortableLayerItemProps {
  fieldId: string;
  index: number;
  canRemove: boolean;
  onRemove: () => void;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  shouldScrollIntoView?: boolean;
  onScrollComplete?: () => void;
  warning: LayerWarning;
}

function SortableLayerItem({
  fieldId,
  index,
  canRemove,
  onRemove,
  isOpen,
  onOpenChange,
  shouldScrollIntoView,
  onScrollComplete,
  warning,
}: SortableLayerItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: fieldId });

  const selfRef = useRef<HTMLDivElement>(null);

  // Combine dnd-kit ref with local ref for scroll targeting
  const setRefs = (el: HTMLDivElement | null) => {
    setNodeRef(el);
    (selfRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
  };

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Scroll into view after the entrance animation completes
  useEffect(() => {
    if (!shouldScrollIntoView || !isOpen) return;
    const timer = setTimeout(() => {
      selfRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      onScrollComplete?.();
    }, 220); // slightly after the 200ms animation
    return () => clearTimeout(timer);
  }, [shouldScrollIntoView, isOpen, onScrollComplete]);

  return (
    <motion.div
      ref={setRefs}
      style={style}
      initial={isDragging ? false : { opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.15, delay: index * 0.04 }}
    >
      <Collapsible
        open={isOpen}
        onOpenChange={onOpenChange}
        className="border rounded-md px-2 mb-2"
      >
        <div className="flex items-center gap-2 py-2">
          {/* Drag handle — not inside CollapsibleTrigger so it doesn't toggle */}
          <button
            type="button"
            aria-label="Drag to reorder"
            {...attributes}
            {...listeners}
            className="cursor-grab touch-none text-muted-foreground hover:text-foreground shrink-0"
          >
            ⠿
          </button>

          {/* Trigger expands/collapses — takes remaining space */}
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex-1 min-w-0 text-left text-sm font-medium hover:text-foreground transition-colors"
            >
              Layer {index + 1}
            </button>
          </CollapsibleTrigger>

          {/* Warning icon — shown when layer has missing or empty sounds */}
          {(warning.isEmpty || warning.missingNames.length > 0) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="shrink-0">
                  <HugeiconsIcon icon={Alert02Icon} size={14} className="text-amber-400" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                {warning.isEmpty
                  ? "No sounds assigned to this layer."
                  : `Missing sounds: ${warning.missingNames.join(", ")}`}
              </TooltipContent>
            </Tooltip>
          )}

          {/* Remove button */}
          <button
            type="button"
            aria-label="Remove layer"
            onClick={onRemove}
            disabled={!canRemove}
            className="ml-2 p-1 rounded text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} />
          </button>
        </div>

        <CollapsibleContent animated isOpen={isOpen} className="pt-2 pb-3">
          <LayerConfigSection index={index} />
        </CollapsibleContent>
      </Collapsible>
    </motion.div>
  );
}

export function LayerAccordion() {
  const { control } = useFormContext<PadConfigForm>();
  const { fields, append, remove, move } = useFieldArray({
    control,
    name: "layers",
    keyName: "rhfId",
  });

  // Track which single item is open (accordion-style: one at a time).
  // Initialize with first field rhfId; sync when fields are replaced (e.g. after form reset).
  const [openId, setOpenId] = useState<string | null>(
    fields.length > 0 ? fields[0].rhfId : null
  );

  // Track which newly-appended layer should scroll into view
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);
  const prevLengthRef = useRef(fields.length);

  // Stable derived key — used by both the sync effect and the memoized items array
  const fieldIdKey = fields.map((f) => f.rhfId).join(",");

  // Keep openId in sync when the field list is replaced by a form reset.
  // If the current openId is no longer in the list, open the first field instead.
  useEffect(() => {
    if (fields.length === 0) {
      setOpenId(null);
      return;
    }
    const stillExists = fields.some((f) => f.rhfId === openId);
    if (!stillExists) {
      setOpenId(fields[0].rhfId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldIdKey]);

  // Detect newly appended layers — auto-open and mark for scroll
  useEffect(() => {
    if (fields.length > prevLengthRef.current && fields.length > 0) {
      const newField = fields[fields.length - 1];
      setOpenId(newField.rhfId);
      setPendingScrollId(newField.rhfId);
    }
    prevLengthRef.current = fields.length;
  }, [fields.length]);

  function handleOpenChange(id: string, open: boolean) {
    setOpenId(open ? id : null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = fields.findIndex((f) => f.rhfId === active.id);
    const to = fields.findIndex((f) => f.rhfId === over.id);
    if (from !== -1 && to !== -1) move(from, to);
  }

  const layerIds = useMemo(() => fieldIdKey.split(",").filter(Boolean), [fieldIdKey]);

  const watchedLayers = useWatch({ control, name: "layers" }) as PadConfigForm["layers"];
  const missingSoundIds = useLibraryStore((s) => s.missingSoundIds);
  const sounds = useLibraryStore((s) => s.sounds);
  const soundById = useMemo(() => new Map(sounds.map((s) => [s.id, s])), [sounds]);

  const layerWarnings = useMemo<LayerWarning[]>(
    () =>
      (watchedLayers ?? []).map((layer) => {
        if (layer.selection.type !== "assigned") return { isEmpty: false, missingNames: [] };
        if (layer.selection.instances.length === 0) return { isEmpty: true, missingNames: [] };
        const missingNames = layer.selection.instances
          .filter((inst) => missingSoundIds.has(inst.soundId))
          .map((inst) => soundById.get(inst.soundId)?.name ?? inst.soundId);
        return { isEmpty: false, missingNames };
      }),
    [watchedLayers, missingSoundIds, soundById],
  );

  return (
    <div className="flex flex-col gap-2">
      <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={layerIds}
          strategy={verticalListSortingStrategy}
        >
          <div className="w-full">
            {fields.map((field, i) => (
              <SortableLayerItem
                key={field.rhfId}
                fieldId={field.rhfId}
                index={i}
                canRemove={fields.length > 1}
                onRemove={() => remove(i)}
                isOpen={openId === field.rhfId}
                onOpenChange={(open) => handleOpenChange(field.rhfId, open)}
                shouldScrollIntoView={pendingScrollId === field.rhfId}
                onScrollComplete={() => setPendingScrollId(null)}
                warning={layerWarnings[i] ?? { isEmpty: false, missingNames: [] }}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => append(createDefaultLayer())}
        className="self-start"
      >
        + Add Layer
      </Button>
    </div>
  );
}
