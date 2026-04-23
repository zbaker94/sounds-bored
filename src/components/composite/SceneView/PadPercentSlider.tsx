import { Slider } from "@/components/ui/slider";

interface PadPercentSliderProps {
  label: string;
  value: number; // 0–100 integer
  onValueChange: (value: number) => void;
  onValueCommit: (value: number) => void;
  sliderClassName?: string;
}

export function PadPercentSlider({
  label,
  value,
  onValueChange,
  onValueCommit,
  sliderClassName,
}: PadPercentSliderProps) {
  return (
    <>
      <div className="flex items-center justify-between text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">{value}%</span>
      </div>
      <Slider
        compact
        tooltipLabel={(v) => `${v}%`}
        value={[value]}
        onValueChange={([v]) => onValueChange(v)}
        onValueCommit={([v]) => onValueCommit(v)}
        min={0}
        max={100}
        step={1}
        className={sliderClassName}
      />
    </>
  );
}
