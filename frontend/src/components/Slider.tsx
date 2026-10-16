"use client";
export function Slider(props: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; format?: (v: number) => string;
}) {
  const { label, value, min, max, step, onChange, format } = props;
  return (
    <label className="block">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium text-ink">{label}</span>
        <span className="num text-ink">{format ? format(value) : value}</span>
      </div>
      <input type="range" className="mt-2 h-2 w-full cursor-pointer accent-primary" min={min} max={max}
        step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
