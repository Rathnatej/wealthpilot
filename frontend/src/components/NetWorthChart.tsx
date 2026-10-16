"use client";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TwinPoint } from "@/services/api";
import { inr } from "@/components/WealthChart";

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
      <LineChart data={data}>
        <CartesianGrid stroke="#1e293b" />
        <XAxis dataKey="label" stroke="#94a3b8" tick={{ fontSize: 11 }} />
        <YAxis stroke="#94a3b8" tickFormatter={inr} width={80} />
        <Tooltip formatter={(v) => inr(Number(v))} contentStyle={{ background: "#0f172a", border: "1px solid #334155" }} />
        <Legend />
        <Line dataKey="Net worth" stroke="#34d399" strokeWidth={3} dot={dots} />
        <Line dataKey="Assets" stroke="#60a5fa" strokeWidth={1.5} dot={dots} strokeDasharray="4 3" />
        <Line dataKey="Liabilities" stroke="#f87171" strokeWidth={1.5} dot={dots} strokeDasharray="4 3" />
      </LineChart>
    </ResponsiveContainer>
  );
}
