import * as React from "react"
import { Slider as SliderPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  compact,
  tooltipLabel,
  onThumbPointerDown,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & {
  /** Render a compact track (h-2) with smaller thumbs (size-3). */
  compact?: boolean
  /** When provided, each thumb shows a tooltip with this function's return value. */
  tooltipLabel?: (value: number) => string
  /** Called when a thumb receives pointerdown, with its index. */
  onThumbPointerDown?: (index: number) => void
}) {
  const _values = React.useMemo(
    () =>
      Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
          ? defaultValue
          : [min, max],
    [value, defaultValue, min, max]
  )

  const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null)
  const [draggingIndex, setDraggingIndex] = React.useState<number | null>(null)

  React.useEffect(() => {
    if (!tooltipLabel) return
    const handlePointerUp = () => setDraggingIndex(null)
    window.addEventListener("pointerup", handlePointerUp)
    return () => window.removeEventListener("pointerup", handlePointerUp)
  }, [tooltipLabel])

  const thumbClass = cn(
    "block shrink-0 rounded-4xl border border-primary bg-white shadow-sm ring-ring/50 transition-colors select-none hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50",
    compact ? "size-3" : "size-4"
  )

  return (
    <TooltipProvider>
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className={cn(
          "relative grow overflow-hidden rounded-4xl bg-muted data-vertical:h-full data-vertical:w-3",
          compact ? "data-horizontal:h-2" : "data-horizontal:h-3"
        )}
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="absolute bg-primary select-none data-horizontal:h-full data-vertical:w-full"
        />
      </SliderPrimitive.Track>
      {Array.from({ length: _values.length }, (_, index) => {
        if (tooltipLabel) {
          return (
            <Tooltip key={index} open={hoveredIndex === index || draggingIndex === index}>
              <TooltipTrigger asChild>
                <SliderPrimitive.Thumb
                  data-slot="slider-thumb"
                  className={thumbClass}
                  onPointerEnter={() => setHoveredIndex(index)}
                  onPointerLeave={() => setHoveredIndex(null)}
                  onPointerDown={() => {
                    setDraggingIndex(index)
                    onThumbPointerDown?.(index)
                  }}
                />
              </TooltipTrigger>
              <TooltipContent>{tooltipLabel(_values[index])}</TooltipContent>
            </Tooltip>
          )
        }

        return (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            className={thumbClass}
            onPointerDown={onThumbPointerDown ? () => onThumbPointerDown(index) : undefined}
          />
        )
      })}
    </SliderPrimitive.Root>
    </TooltipProvider>
  )
}

export { Slider }
