import { Slider } from "@/components/ui/slider";

interface PadDurationSliderProps {
  label: string;
  value: number; // milliseconds
  onValueChange: (value: number) => void;
  onValueCommit: (value: number) => void;
  sliderClassName?: string;
}

export function PadDurationSlider({
  label,
  value,
  onValueChange,
  onValueCommit,
  sliderClassName,
}: PadDurationSliderProps) {
  return (
    <>
      <div className="flex items-center justify-between text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">{(value / 1000).toFixed(1)}s</span>
      </div>
      <Slider
        compact
        tooltipLabel={(v) => `${(v / 1000).toFixed(1)}s`}
        value={[value]}
        onValueChange={([v]) => onValueChange(v)}
        onValueCommit={([v]) => onValueCommit(v)}
        min={100}
        max={10000}
        step={100}
        className={sliderClassName}
      />
    </>
  );
}
