"use client";
import { useCallback, useEffect, useState } from "react";
import { NumInput } from "@/components/NumInput";
import { GoalRisk } from "@/components/GoalRisk";
import { RequireAuth } from "@/components/RequireAuth";
import { inr } from "@/components/WealthChart";
import { Goal, GoalInput, createGoal, deleteGoal, errMsg, listGoals } from "@/services/api";

// Typical starting assumptions only; the user can change every value.
const PRESETS = [
  { name: "House down payment", inflation: 7 },
  { name: "Higher education", inflation: 10 },
  { name: "Retirement", inflation: 6 },
];

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
    <main className="container-page py-12 sm:py-16">
      <header>
        <h1 className="display text-4xl sm:text-5xl">Goals</h1>
        <p className="mt-3 max-w-2xl text-body">
          Targets are in today&apos;s rupees and are inflated to the goal date. Projections are illustrative, not advice.
        </p>
      </header>

      <form onSubmit={add} className="card mt-10 space-y-6">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-body">Quick start:</span>
          {PRESETS.map((p) => (
            <button type="button" key={p.name} onClick={() => { setName(p.name); setInflation(p.inflation); }}
              className="btn-secondary btn-sm">{p.name}</button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div><label className="label">Goal name</label>
            <input className="input" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. House down payment" /></div>
          <div><label className="label">Target today (₹)</label><NumInput value={target} onChange={setTarget} /></div>
          <div><label className="label">Target date</label>
            <input className="input" type="date" required min={tomorrow()} value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><label className="label">Inflation (% / yr)</label><NumInput value={inflation} onChange={setInflation} step="0.5" /></div>
          <div><label className="label">Already saved (₹)</label><NumInput value={saved} onChange={setSaved} /></div>
          <div><label className="label">Monthly contribution (₹)</label><NumInput value={monthly} onChange={setMonthly} /></div>
          <div><label className="label">Expected return (% / yr)</label><NumInput value={ret} onChange={setRet} step="0.5" /></div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <button disabled={busy} className="btn-primary">{busy ? "Adding…" : "Add goal"}</button>
          {error && <span role="alert" className="text-sm font-medium text-down">{error}</span>}
        </div>
      </form>

      {loading ? (
        <p className="mt-10 text-body">Loading goals…</p>
      ) : goals.length === 0 ? (
        <p className="mt-10 text-muted">No goals yet. Add your first one above.</p>
      ) : (
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {goals.map((g) => {
            const pct = Math.max(0, Math.min(g.progress_pct, 100));
            return (
              <article key={g.id} className="card card-hover space-y-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-ink">{g.name}</h3>
                    <p className="mt-0.5 text-sm text-body">by {g.target_date} · <span className="num">{g.years_left.toFixed(1)}</span> yrs left</p>
                  </div>
                  <span className={`badge normal-case ${g.on_track ? "up" : "down"}`}>
                    {g.on_track ? "On track" : "Behind"}
                  </span>
                </div>

                <div>
                  <div className="h-2 overflow-hidden rounded-pill bg-strong" role="progressbar"
                    aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full rounded-pill bg-primary" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-2 flex justify-between text-sm text-body">
                    <span>Projected <span className="num text-ink">{inr(g.projected_value)}</span></span>
                    <span><span className="num text-ink">{g.progress_pct.toFixed(0)}%</span> of <span className="num">{inr(g.inflated_target)}</span></span>
                  </div>
                </div>

                <dl className="grid grid-cols-2 gap-4 border-t border-hairline pt-4 text-sm">
                  <div><dt className="text-muted">Target today</dt><dd className="num mt-0.5 text-ink">{inr(g.target_amount)}</dd></div>
                  <div><dt className="text-muted">Inflated target</dt><dd className="num mt-0.5 text-ink">{inr(g.inflated_target)}</dd></div>
                  <div><dt className="text-muted">Saving now</dt><dd className="num mt-0.5 text-ink">{inr(g.monthly_contribution)}/mo</dd></div>
                  <div><dt className="text-muted">Needed to hit it</dt><dd className="num mt-0.5 text-ink">{inr(g.required_monthly_contribution)}/mo</dd></div>
                </dl>
                {!g.on_track && (
                  <p className="text-sm text-body">Projected shortfall: <span className="num down">{inr(g.shortfall)}</span> at the assumed return.</p>
                )}
                <GoalRisk goalId={g.id} />
                <button onClick={() => remove(g)} className="text-sm font-medium text-muted hover:text-down">Delete</button>
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
