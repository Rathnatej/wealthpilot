"use client";
import { useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Explain, Stat } from "@/components/Explain";
import { NumInput } from "@/components/NumInput";
import { AXIS, GRID, inr, tooltipStyle } from "@/components/WealthChart";
import {
  Explained, LoanInput, LoanResult, RetirementInput, RetirementResult, StepUpInput, StepUpResult,
  errMsg, planLoan, planRetirement, planStepUp,
} from "@/services/api";

type Tab = "retirement" | "stepup" | "loan";
const TABS: { id: Tab; label: string; blurb: string }[] = [
  { id: "retirement", label: "Retirement", blurb: "How much you need, and the monthly SIP that gets you there." },
  { id: "stepup", label: "Step-up SIP", blurb: "See what raising your SIP every year does to your wealth." },
  { id: "loan", label: "Loan vs invest", blurb: "Prepay a loan, or invest the money instead?" },
];

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function useRun<I, R>(fn: (i: I) => Promise<Explained<R>>) {
  const [out, setOut] = useState<Explained<R> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(input: I) {
    setBusy(true); setError("");
    try { setOut(await fn(input)); } catch (e) { setError(errMsg(e)); setOut(null); } finally { setBusy(false); }
  }
  return { out, busy, error, run };
}

const yrs = (m: number | null) => (m === null ? "—" : m === 0 ? "immediately" : m >= 24 ? `${(m / 12).toFixed(1)} yrs` : `${m} mo`);

/* ---------------- Retirement ---------------- */
function Retirement() {
  const [f, setF] = useState<RetirementInput>({
    current_age: 30, retirement_age: 60, life_expectancy: 85, monthly_expenses: 50000,
    inflation_pct: 6, pre_return_pct: 11, post_return_pct: 7, current_corpus: 500000, monthly_sip: 20000, step_up_pct: 0,
  });
  const { out, busy, error, run } = useRun(planRetirement);
  const set = (k: keyof RetirementInput) => (v: number) => setF((p) => ({ ...p, [k]: v }));
  const r: RetirementResult | undefined = out?.result;

  return (
    <div className="space-y-8">
      <form onSubmit={(e) => { e.preventDefault(); run(f); }} className="card space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Your age"><NumInput value={f.current_age} onChange={(v) => set("current_age")(Math.round(v))} step="1" min={18} /></Field>
          <Field label="Retire at"><NumInput value={f.retirement_age} onChange={(v) => set("retirement_age")(Math.round(v))} step="1" min={19} /></Field>
          <Field label="Plan until age"><NumInput value={f.life_expectancy} onChange={(v) => set("life_expectancy")(Math.round(v))} step="1" min={20} /></Field>
          <Field label="Monthly expenses today (₹)"><NumInput value={f.monthly_expenses} onChange={set("monthly_expenses")} /></Field>
          <Field label="Current savings (₹)"><NumInput value={f.current_corpus} onChange={set("current_corpus")} /></Field>
          <Field label="Monthly SIP (₹)"><NumInput value={f.monthly_sip} onChange={set("monthly_sip")} /></Field>
          <Field label="Yearly SIP step-up (%)"><NumInput value={f.step_up_pct} onChange={set("step_up_pct")} step="0.5" /></Field>
          <Field label="Inflation (% / yr)"><NumInput value={f.inflation_pct} onChange={set("inflation_pct")} step="0.5" /></Field>
          <Field label="Return before retiring (%)"><NumInput value={f.pre_return_pct} onChange={set("pre_return_pct")} step="0.5" /></Field>
          <Field label="Return after retiring (%)"><NumInput value={f.post_return_pct} onChange={set("post_return_pct")} step="0.5" /></Field>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <button disabled={busy} className="btn-primary">{busy ? "Calculating…" : "Calculate"}</button>
          {error && <span role="alert" className="text-sm font-medium text-down">{error}</span>}
        </div>
      </form>

      {r && out && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Corpus you need" value={inr(r.corpus_needed)} sub={`at age ${f.retirement_age}`} />
            <Stat label="Projected corpus" value={inr(r.projected_corpus)} />
            <Stat label={r.on_track ? "Surplus" : "Gap"} value={r.on_track ? "On track" : inr(r.gap)} tone={r.on_track ? "up" : "down"} />
            <Stat label="SIP to close the gap" value={r.required_monthly_sip > 0 ? `${inr(r.required_monthly_sip)}/mo` : "Not needed"} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Monthly spend at retirement" value={inr(r.expenses_at_retirement_monthly)} sub="after inflation" />
            <Stat label="25× rule, in today's money" value={inr(r.fire_number_today)} sub="a rough benchmark only" />
            <Stat label="Money runs out at" value={r.depletion_age ? `age ${r.depletion_age}` : "Lasts the plan"} tone={r.depletion_age ? "down" : "up"} />
          </div>
          <section className="card">
            <h3 className="text-lg font-semibold">Your corpus by age</h3>
            <div className="mt-4">
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={r.series} margin={{ left: 0, right: 8, top: 8 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="age" stroke={AXIS} tickLine={false} />
                  <YAxis stroke={AXIS} tickLine={false} axisLine={false} tickFormatter={inr} width={80} />
                  <Tooltip formatter={(v) => inr(Number(v))} labelFormatter={(a) => `Age ${a}`} contentStyle={tooltipStyle} />
                  <ReferenceLine x={f.retirement_age} stroke={AXIS} strokeDasharray="4 3" label={{ value: "Retire", fill: AXIS, fontSize: 12 }} />
                  <Line dataKey="corpus" name="Corpus" stroke="#2f6bff" strokeWidth={3} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4"><Explain text={out.explanation} source={out.source} /></div>
          </section>
        </div>
      )}
    </div>
  );
}

/* ---------------- Step-up SIP ---------------- */
function StepUp() {
  const [f, setF] = useState<StepUpInput>({ current_corpus: 0, monthly_sip: 15000, step_up_pct: 10, annual_return_pct: 12, years: 20 });
  const { out, busy, error, run } = useRun(planStepUp);
  const set = (k: keyof StepUpInput) => (v: number) => setF((p) => ({ ...p, [k]: v }));
  const r: StepUpResult | undefined = out?.result;

  return (
    <div className="space-y-8">
      <form onSubmit={(e) => { e.preventDefault(); run(f); }} className="card space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Current savings (₹)"><NumInput value={f.current_corpus} onChange={set("current_corpus")} /></Field>
          <Field label="Monthly SIP (₹)"><NumInput value={f.monthly_sip} onChange={set("monthly_sip")} /></Field>
          <Field label="Yearly step-up (%)"><NumInput value={f.step_up_pct} onChange={set("step_up_pct")} step="0.5" /></Field>
          <Field label="Expected return (%)"><NumInput value={f.annual_return_pct} onChange={set("annual_return_pct")} step="0.5" /></Field>
          <Field label="Years"><NumInput value={f.years} onChange={(v) => set("years")(Math.round(v))} step="1" min={1} /></Field>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <button disabled={busy} className="btn-primary">{busy ? "Calculating…" : "Calculate"}</button>
          {error && <span role="alert" className="text-sm font-medium text-down">{error}</span>}
        </div>
      </form>

      {r && out && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Flat SIP ends at" value={inr(r.final_flat)} sub={`invested ${inr(r.invested_flat)}`} />
            <Stat label="Step-up SIP ends at" value={inr(r.final_step_up)} sub={`invested ${inr(r.invested_step_up)}`} />
            <Stat label="Extra wealth" value={inr(r.extra_wealth)} tone="up" />
            <Stat label="SIP in the final year" value={`${inr(r.final_year_sip)}/mo`} />
          </div>
          <section className="card">
            <h3 className="text-lg font-semibold">Flat vs step-up</h3>
            <div className="mt-4">
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={r.series} margin={{ left: 0, right: 8, top: 8 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="year" stroke={AXIS} tickLine={false} />
                  <YAxis stroke={AXIS} tickLine={false} axisLine={false} tickFormatter={inr} width={80} />
                  <Tooltip formatter={(v) => inr(Number(v))} labelFormatter={(y) => `Year ${y}`} contentStyle={tooltipStyle} />
                  <Legend />
                  <Line dataKey="flat" name="Flat SIP" stroke="#7c828a" strokeWidth={2} dot={false} />
                  <Line dataKey="step_up" name="Step-up SIP" stroke="#2f6bff" strokeWidth={3} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4"><Explain text={out.explanation} source={out.source} /></div>
          </section>
        </div>
      )}
    </div>
  );
}

/* ---------------- Loan vs invest ---------------- */
function LoanVsInvest() {
  const [f, setF] = useState<LoanInput>({
    principal: 2000000, annual_rate_pct: 9, remaining_months: 180, emi: null,
    lump_sum: 300000, extra_monthly: 0, invest_return_pct: 12,
  });
  const { out, busy, error, run } = useRun(planLoan);
  const set = (k: keyof LoanInput) => (v: number) => setF((p) => ({ ...p, [k]: v }));
  const r: LoanResult | undefined = out?.result;

  return (
    <div className="space-y-8">
      <form onSubmit={(e) => { e.preventDefault(); run(f); }} className="card space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Loan outstanding (₹)"><NumInput value={f.principal} onChange={set("principal")} /></Field>
          <Field label="Loan interest (% / yr)"><NumInput value={f.annual_rate_pct} onChange={set("annual_rate_pct")} step="0.1" /></Field>
          <Field label="Months left"><NumInput value={f.remaining_months} onChange={(v) => set("remaining_months")(Math.round(v))} step="1" min={1} /></Field>
          <Field label="Your EMI (₹)" hint="Leave empty to calculate it"><NumInput value={f.emi ?? 0} onChange={(v) => setF((p) => ({ ...p, emi: v > 0 ? v : null }))} /></Field>
          <Field label="Lump sum available (₹)"><NumInput value={f.lump_sum} onChange={set("lump_sum")} /></Field>
          <Field label="Extra per month (₹)"><NumInput value={f.extra_monthly} onChange={set("extra_monthly")} /></Field>
          <Field label="Investment return (% / yr)"><NumInput value={f.invest_return_pct} onChange={set("invest_return_pct")} step="0.5" /></Field>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <button disabled={busy} className="btn-primary">{busy ? "Comparing…" : "Compare"}</button>
          {error && <span role="alert" className="text-sm font-medium text-down">{error}</span>}
        </div>
      </form>

      {r && out && (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            {([["Prepay the loan", r.prepay, "prepay"], ["Invest instead", r.invest, "invest"]] as const).map(([title, run_, key]) => (
              <section key={key} className={r.winner === key ? "card-dark" : "card"}>
                <div className="flex items-center justify-between">
                  <h3 className={`text-lg font-semibold ${r.winner === key ? "!text-white" : ""}`}>{title}</h3>
                  {r.winner === key && <span className="badge !bg-white/10 !text-white">Ends ahead</span>}
                </div>
                <dl className="mt-4 space-y-2 text-sm">
                  <div className="flex justify-between"><dt className={r.winner === key ? "text-white/60" : "text-body"}>Net worth at the end</dt><dd className="num">{inr(run_.final_net_worth)}</dd></div>
                  <div className="flex justify-between"><dt className={r.winner === key ? "text-white/60" : "text-body"}>Interest paid</dt><dd className="num">{inr(run_.interest_paid)}</dd></div>
                  <div className="flex justify-between"><dt className={r.winner === key ? "text-white/60" : "text-body"}>Loan closed in</dt><dd className="num">{yrs(run_.loan_closed_month)}</dd></div>
                  <div className="flex justify-between"><dt className={r.winner === key ? "text-white/60" : "text-body"}>Investments</dt><dd className="num">{inr(run_.investments)}</dd></div>
                </dl>
              </section>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Difference" value={inr(r.difference)} sub={`in favour of ${r.winner === "prepay" ? "prepaying" : "investing"}`} />
            <Stat label="Interest saved by prepaying" value={inr(r.interest_saved)} />
            <Stat label="Break-even return" value={r.breakeven_return !== null ? `${(r.breakeven_return * 100).toFixed(1)}%` : "—"}
              sub="investing wins only if returns beat this" />
          </div>
          <Explain text={out.explanation} source={out.source} />
          <p className="text-xs text-muted">Investment returns are not guaranteed and are not post-tax. Prepayment can also have penalties or tax effects not modelled here.</p>
        </div>
      )}
    </div>
  );
}

export default function PlannersPage() {
  const [tab, setTab] = useState<Tab>("retirement");
  const cur = TABS.find((t) => t.id === tab)!;
  return (
    <main className="container-page py-12 sm:py-16">
      <header className="max-w-2xl">
        <span className="badge">Planners</span>
        <h1 className="display mt-4 text-4xl sm:text-5xl">Plan the big decisions.</h1>
        <p className="mt-3 text-body">{cur.blurb} Educational projections, not advice.</p>
      </header>

      <div role="tablist" className="mt-8 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={tab === t.id ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>{t.label}</button>
        ))}
      </div>

      <div className="mt-8">
        {tab === "retirement" && <Retirement />}
        {tab === "stepup" && <StepUp />}
        {tab === "loan" && <LoanVsInvest />}
      </div>
    </main>
  );
}
