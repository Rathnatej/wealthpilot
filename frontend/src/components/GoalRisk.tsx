"use client";
import { useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Explain } from "@/components/Explain";
import { AXIS, GRID, inr, tooltipStyle } from "@/components/WealthChart";
import { GoalRisk as Risk, errMsg, goalRisk } from "@/services/api";

const LEVELS = [
  { v: 0.08, label: "Calm (8%)" },
  { v: 0.15, label: "Typical equity (15%)" },
  { v: 0.22, label: "Choppy (22%)" },
];

export function GoalRisk({ goalId }: { goalId: number }) {
  const [open, setOpen] = useState(false);
  const [vol, setVol] = useState(0.15);
  const [data, setData] = useState<Risk | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load(v: number) {
    setBusy(true); setError("");
    try { setData(await goalRisk(goalId, v)); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !data) load(vol);
  }

  const p = data?.probability_pct ?? 0;
  return (
    <div className="border-t border-hairline pt-4">
      <button onClick={toggle} aria-expanded={open} className="btn-text text-sm">
        {open ? "Hide" : "Check"} the odds of reaching this goal
      </button>
      {open && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-body">Market ups and downs:</span>
            {LEVELS.map((l) => (
              <button key={l.v} onClick={() => { setVol(l.v); load(l.v); }}
                className={vol === l.v ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>{l.label}</button>
            ))}
          </div>
          {busy && <p className="text-sm text-muted">Running {5000} simulated futures…</p>}
          {error && <p role="alert" className="text-sm text-down">{error}</p>}
          {data && !busy && (
            <>
              <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
                <div>
                  <div className="text-sm text-body">Chance of reaching it</div>
                  <div className={`num text-4xl ${p >= 75 ? "up" : p < 50 ? "down" : "text-ink"}`}>{p}%</div>
                </div>
                <dl className="grid grid-cols-3 gap-x-6 text-sm">
                  <div><dt className="text-muted">Bad case (10%)</dt><dd className="num text-ink">{inr(data.p10)}</dd></div>
                  <div><dt className="text-muted">Middle</dt><dd className="num text-ink">{inr(data.p50)}</dd></div>
                  <div><dt className="text-muted">Good case (90%)</dt><dd className="num text-ink">{inr(data.p90)}</dd></div>
                </dl>
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={data.fan.map((f) => ({ ...f, year: +(f.month / 12).toFixed(1) }))} margin={{ left: 0, right: 8, top: 8 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="year" stroke={AXIS} tickLine={false} />
                  <YAxis stroke={AXIS} tickLine={false} axisLine={false} tickFormatter={inr} width={72} />
                  <Tooltip formatter={(v) => inr(Number(v))} labelFormatter={(y) => `Year ${y}`} contentStyle={tooltipStyle} />
                  <Legend />
                  <ReferenceLine y={data.inflated_target} stroke="#05b169" strokeDasharray="5 4" label={{ value: "Target", fill: "#05b169", fontSize: 12, position: "insideTopLeft" }} />
                  <Line dataKey="p90" name="Good case" stroke="#7c828a" strokeDasharray="4 3" dot={false} />
                  <Line dataKey="p50" name="Middle" stroke="#2f6bff" strokeWidth={3} dot={false} />
                  <Line dataKey="p10" name="Bad case" stroke="#7c828a" strokeDasharray="4 3" dot={false} />
                </LineChart>
              </ResponsiveContainer>
              <Explain text={data.explanation} source={data.source} title="What this means" />
              <p className="text-xs text-muted">Based on {data.paths.toLocaleString()} simulated futures with {(data.volatility * 100).toFixed(0)}% yearly volatility. A model, not a forecast.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
