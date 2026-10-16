"use client";
export function Slider(props: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; format?: (v: number) => string;
}) {
  const { label, value, min, max, step, onChange, format } = props;
  return (
    <label className="block">
      <div className="flex justify-between text-sm text-slate-300">
        <span>{label}</span>
        <span className="font-mono">{format ? format(value) : value}</span>
      </div>
      <input type="range" className="w-full accent-emerald-400" min={min} max={max}
        step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
