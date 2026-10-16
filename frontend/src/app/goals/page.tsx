"use client";
import { useCallback, useEffect, useState } from "react";
import { NumInput } from "@/components/NumInput";
import { RequireAuth } from "@/components/RequireAuth";
import { inr } from "@/components/WealthChart";
import { Goal, GoalInput, createGoal, deleteGoal, errMsg, listGoals } from "@/services/api";

// Typical starting assumptions only; the user can change every value.
const PRESETS = [
  { name: "House down payment", inflation: 7 },
  { name: "Higher education", inflation: 10 },
  { name: "Retirement", inflation: 6 },
];

const field = "w-full rounded-lg bg-slate-800 px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500";
const label = "mb-1 block text-xs text-slate-400";

const isoPlusYears = (y: number) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + y);
  return d.toISOString().slice(0, 10);
};
const tomorrow = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
};

function GoalsManager() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [target, setTarget] = useState(0);
  const [date, setDate] = useState(isoPlusYears(10));
  const [inflation, setInflation] = useState(6);
  const [saved, setSaved] = useState(0);
  const [monthly, setMonthly] = useState(0);
  const [ret, setRet] = useState(10);

  const refresh = useCallback(async () => setGoals(await listGoals()), []);
  useEffect(() => {
    refresh().catch((e) => setError(errMsg(e))).finally(() => setLoading(false));
  }, [refresh]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (target <= 0) return setError("Enter a target amount greater than zero.");
    const body: GoalInput = {
      name: name.trim(), target_amount: target, target_date: date,
      inflation_rate: inflation / 100, current_saved: saved,
      monthly_contribution: monthly, expected_return: ret / 100,
    };
    setBusy(true);
    try {
      await createGoal(body);
      await refresh();
      setName(""); setTarget(0); setSaved(0); setMonthly(0);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(g: Goal) {
    if (!window.confirm(`Delete goal "${g.name}"?`)) return;
    try {
      await deleteGoal(g.id);
      await refresh();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">Goals</h1>
        <p className="text-sm text-slate-400">
          Targets are in today&apos;s rupees and are inflated to the goal date. Projections are illustrative, not advice.
        </p>
      </header>

      <form onSubmit={add} className="space-y-4 rounded-xl bg-slate-900 p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-400">Quick start:</span>
          {PRESETS.map((p) => (
            <button type="button" key={p.name} onClick={() => { setName(p.name); setInflation(p.inflation); }}
              className="rounded-full bg-slate-800 px-3 py-1 hover:bg-slate-700">{p.name}</button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div><span className={label}>Goal name</span>
            <input className={field} required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. House down payment" /></div>
          <div><span className={label}>Target today (₹)</span><NumInput value={target} onChange={setTarget} /></div>
          <div><span className={label}>Target date</span>
            <input className={field} type="date" required min={tomorrow()} value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><span className={label}>Inflation (% / yr)</span><NumInput value={inflation} onChange={setInflation} step="0.5" /></div>
          <div><span className={label}>Already saved (₹)</span><NumInput value={saved} onChange={setSaved} /></div>
          <div><span className={label}>Monthly contribution (₹)</span><NumInput value={monthly} onChange={setMonthly} /></div>
          <div><span className={label}>Expected return (% / yr)</span><NumInput value={ret} onChange={setRet} step="0.5" /></div>
        </div>
        <div className="flex items-center gap-3">
          <button disabled={busy} className="rounded-lg bg-emerald-500 px-5 py-2 font-medium text-slate-950 disabled:opacity-50">
            {busy ? "Adding…" : "Add goal"}
          </button>
          {error && <span role="alert" className="text-sm text-red-400">{error}</span>}
        </div>
      </form>

      {loading ? (
        <p className="text-slate-400">Loading goals…</p>
      ) : goals.length === 0 ? (
        <p className="text-slate-500">No goals yet. Add your first one above.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {goals.map((g) => {
            const pct = Math.max(0, Math.min(g.progress_pct, 100));
            return (
              <article key={g.id} className="space-y-3 rounded-xl bg-slate-900 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold">{g.name}</h3>
                    <p className="text-xs text-slate-400">by {g.target_date} · {g.years_left.toFixed(1)} yrs left</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${g.on_track ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"}`}>
                    {g.on_track ? "On track" : "Behind"}
                  </span>
                </div>

                <div>
                  <div className="h-3 overflow-hidden rounded-full bg-slate-800"
                    role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
                    <div className={`h-full ${g.on_track ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-1 flex justify-between text-xs text-slate-400">
                    <span>Projected {inr(g.projected_value)}</span>
                    <span>{g.progress_pct.toFixed(0)}% of {inr(g.inflated_target)}</span>
                  </div>
                </div>

                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div><dt className="text-xs text-slate-400">Target today</dt><dd>{inr(g.target_amount)}</dd></div>
                  <div><dt className="text-xs text-slate-400">Inflated target</dt><dd>{inr(g.inflated_target)}</dd></div>
                  <div><dt className="text-xs text-slate-400">Saving now</dt><dd>{inr(g.monthly_contribution)}/mo</dd></div>
                  <div><dt className="text-xs text-slate-400">Needed to hit it</dt><dd>{inr(g.required_monthly_contribution)}/mo</dd></div>
                </dl>
                {!g.on_track && (
                  <p className="text-xs text-amber-300">Projected shortfall: {inr(g.shortfall)} at the assumed return.</p>
                )}
                <button onClick={() => remove(g)} className="text-xs text-slate-500 hover:text-red-400">Delete</button>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}

export default function GoalsPage() {
  return (
    <RequireAuth>
      <GoalsManager />
    </RequireAuth>
  );
}
