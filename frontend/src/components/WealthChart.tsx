"use client";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { SimResponse } from "@/services/api";

// Baseline is neutral gray; the first scenario carries the single brand blue.
export const SERIES_COLORS = ["#7c828a", "#2f6bff", "#05b169", "#f4b000"];
export const GRID = "rgba(124,130,138,0.25)";
export const AXIS = "#7c828a";
export const tooltipStyle = {
  background: "rgb(var(--surface-card))",
  border: "1px solid rgb(var(--hairline))",
  borderRadius: 12,
  color: "rgb(var(--ink))",
};

export const inr = (v: number) =>
  v >= 1e7 ? `₹${(v / 1e7).toFixed(2)} Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(2)} L` : `₹${Math.round(v)}`;

export function WealthChart({ data }: { data: SimResponse }) {
  const all = [data.baseline, ...data.scenarios];
  const rows = data.baseline.series
    .filter((p) => p.month % 6 === 0)
    .map((p) => {
      const row: Record<string, number> = { year: p.month / 12 };
      all.forEach((s) => (row[s.name] = s.series[p.month].corpus));
      return row;
    });
  return (
    <ResponsiveContainer width="100%" height={380}>
      <LineChart data={rows} margin={{ left: 0, right: 8, top: 8 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="year" stroke={AXIS} tickLine={false} label={{ value: "Years", position: "insideBottom", offset: -4, fill: AXIS }} />
        <YAxis stroke={AXIS} tickLine={false} axisLine={false} tickFormatter={inr} width={80} />
        <Tooltip formatter={(v) => inr(Number(v))} contentStyle={tooltipStyle} />
        <Legend />
        {all.map((s, i) => (
          <Line key={s.name} dataKey={s.name} stroke={SERIES_COLORS[i % 4]} dot={false} strokeWidth={i === 1 ? 3 : 2} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
