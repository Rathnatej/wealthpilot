"use client";
export function NumInput({
  value, onChange, placeholder = "0", step = "any", className = "", min = 0,
}: {
  value: number; onChange: (v: number) => void; placeholder?: string;
  step?: string; className?: string; min?: number;
}) {
  return (
    <input
      type="number" inputMode="decimal" min={min} step={step} placeholder={placeholder}
      value={Number.isFinite(value) && value !== 0 ? value : ""}
      onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
      className={`w-full rounded-lg bg-slate-800 px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500 ${className}`}
    />
  );
}
