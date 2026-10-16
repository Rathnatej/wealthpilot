"use client";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { SimResponse } from "@/services/api";

const COLORS = ["#94a3b8", "#34d399", "#60a5fa", "#f59e0b"];
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
      <LineChart data={rows}>
        <CartesianGrid stroke="#1e293b" />
        <XAxis dataKey="year" stroke="#94a3b8" label={{ value: "Years", position: "insideBottom", offset: -4 }} />
        <YAxis stroke="#94a3b8" tickFormatter={inr} width={80} />
        <Tooltip formatter={(v) => inr(Number(v))} contentStyle={{ background: "#0f172a", border: "1px solid #334155" }} />
        <Legend />
        {all.map((s, i) => (
          <Line key={s.name} dataKey={s.name} stroke={COLORS[i % 4]} dot={false} strokeWidth={2} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
