import { Slider } from "@/components/ui/slider";

interface PadOverlaySliderProps {
  label: string;
  value: number;
  formatValue: (v: number) => string;
  onValueChange: (value: number) => void;
  onValueCommit: (value: number) => void;
  min: number;
  max: number;
  step: number;
  sliderClassName?: string;
}

export function PadOverlaySlider({
  label,
  value,
  formatValue,
  onValueChange,
  onValueCommit,
  min,
  max,
  step,
  sliderClassName,
}: PadOverlaySliderProps) {
  return (
    <div className="flex flex-col gap-0.5">
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
      <div className="flex justify-between text-[9px] text-white/70">
        <span>{label}</span>
        <span>{formatValue(value)}</span>
      </div>
    </div>
  );
}
