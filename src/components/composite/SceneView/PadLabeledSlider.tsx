import { Slider } from "@/components/ui/slider";

interface PadLabeledSliderProps {
  label: string;
  value: number;
  onValueChange: (value: number) => void;
  onValueCommit: (value: number) => void;
  min: number;
  max: number;
  step: number;
  formatValue: (v: number) => string;
  sliderClassName?: string;
}

export function PadLabeledSlider({
  label,
  value,
  onValueChange,
  onValueCommit,
  min,
  max,
  step,
  formatValue,
  sliderClassName,
}: PadLabeledSliderProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">{formatValue(value)}</span>
      </div>
      <Slider
        compact
        tooltipLabel={formatValue}
        value={[value]}
        onValueChange={([v]) => onValueChange(v)}
        onValueCommit={([v]) => onValueCommit(v)}
        min={min}
        max={max}
        step={step}
        className={sliderClassName}
      />
    </div>
  );
}
