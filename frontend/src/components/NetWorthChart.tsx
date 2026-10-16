"use client";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TwinPoint } from "@/services/api";
import { AXIS, GRID, inr, tooltipStyle } from "@/components/WealthChart";

export function NetWorthChart({ points }: { points: TwinPoint[] }) {
  const data = points.map((p) => ({
    label: `v${p.version_id} · ${new Date(p.created_at).toLocaleDateString()}`,
    "Net worth": p.net_worth,
    Assets: p.total_assets,
    Liabilities: p.total_liabilities,
  }));
  const dots = data.length < 4;
  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" stroke={AXIS} tickLine={false} tick={{ fontSize: 11 }} />
        <YAxis stroke={AXIS} tickLine={false} axisLine={false} tickFormatter={inr} width={80} />
        <Tooltip formatter={(v) => inr(Number(v))} contentStyle={tooltipStyle} />
        <Legend />
        <Line dataKey="Net worth" stroke="#2f6bff" strokeWidth={3} dot={dots} />
        <Line dataKey="Assets" stroke="#7c828a" strokeWidth={1.5} dot={dots} strokeDasharray="4 3" />
        <Line dataKey="Liabilities" stroke="#cf202f" strokeWidth={1.5} dot={dots} strokeDasharray="4 3" />
      </LineChart>
    </ResponsiveContainer>
  );
}
