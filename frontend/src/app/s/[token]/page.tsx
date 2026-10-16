"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Explain } from "@/components/Explain";
import { AXIS, GRID, SERIES_COLORS, inr, tooltipStyle } from "@/components/WealthChart";
import { SharedScenario, errMsg, getShare } from "@/services/api";

export default function SharedPage() {
  const { token } = useParams<{ token: string }>();
  const [d, setD] = useState<SharedScenario | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getShare(token).then(setD).catch((e) => setError(errMsg(e)));
  }, [token]);

  if (error) return <main className="container-page py-20"><p className="card text-down">{error}</p></main>;
  if (!d) return <main className="container-page py-20 text-body">Loading…</main>;

  const all = [d.baseline, ...d.results];
  const months = d.baseline.series.map((s) => s.month);
  const data = months.map((m, i) => {
    const row: Record<string, number> = { month: m };
    all.forEach((s) => { if (s.series[i]) row[s.name] = s.series[i].corpus; });
    return row;
  });

  return (
    <main className="container-page py-12 sm:py-16">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <span className="badge">Shared scenario</span>
        <button onClick={() => window.print()} className="btn-outline btn-sm">Save as PDF</button>
      </div>
      <h1 className="display mt-4 text-4xl sm:text-5xl">{d.title}</h1>
      <p className="mt-2 text-sm text-muted">Created {new Date(d.created_at).toLocaleDateString()} · projections, not advice</p>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {all.map((s, i) => (
          <div key={s.name} className="card">
            <p className="text-sm text-muted">{s.name}</p>
            <p className="num mt-1 text-2xl font-semibold" style={{ color: SERIES_COLORS[i % SERIES_COLORS.length] }}>{inr(s.final_corpus)}</p>
          </div>
        ))}
      </div>

      <div className="card mt-6">
        <ResponsiveContainer width="100%" height={340}>
          <LineChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="month" stroke={AXIS} tickLine={false} tickFormatter={(m) => `${Math.round(m / 12)}y`} />
            <YAxis stroke={AXIS} tickLine={false} axisLine={false} tickFormatter={inr} width={72} />
            <Tooltip formatter={(v) => inr(Number(v))} labelFormatter={(m) => `Month ${m}`} contentStyle={tooltipStyle} />
            <Legend />
            {all.map((s, i) => <Line key={s.name} type="monotone" dataKey={s.name} stroke={SERIES_COLORS[i % SERIES_COLORS.length]} strokeWidth={2.5} dot={false} />)}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-6"><Explain text={d.explanation} source="template" /></div>

      <div className="no-print mt-10 text-center">
        <Link href="/" className="btn-primary btn-lg">Try your own scenario</Link>
      </div>
    </main>
  );
}
