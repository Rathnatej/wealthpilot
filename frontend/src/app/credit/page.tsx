"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { NumInput } from "@/components/NumInput";
import { Slider } from "@/components/Slider";
import { AXIS, GRID, inr, tooltipStyle } from "@/components/WealthChart";
import { useAuth } from "@/context/AuthContext";
import {
  CreditCard, CreditLoan, CreditRequest, CreditResult, CreditSnapshotPoint, PayoffRun, Prefs, WhatIfResult,
  analyzeCredit, creditWhatIf, deleteCreditSnapshot, errMsg, getPrefs, latestCreditSnapshot,
  listCreditSnapshots, saveCreditSnapshot, setPrefs,
} from "@/services/api";

const BANDS = [
  { name: "Poor", from: 300, to: 549 },
  { name: "Fair", from: 550, to: 649 },
  { name: "Good", from: 650, to: 749 },
  { name: "Excellent", from: 750, to: 900 },
];

const statusText: Record<string, string> = { good: "up", warn: "text-warn", bad: "down" };
const statusLabel: Record<string, string> = { good: "Healthy", warn: "Needs attention", bad: "Hurting your score" };

const months = (n: number | null) => (n === null ? "—" : n === 0 ? "now" : n >= 600 ? "50+ yrs" : n >= 24 ? `${(n / 12).toFixed(1)} yrs` : `${n} mo`);

function ScoreBar({ score }: { score: number }) {
  const pos = ((score - 300) / 600) * 100;
  return (
    <div>
      <div className="relative mt-6 h-3 overflow-visible rounded-pill bg-strong">
        <div className="absolute inset-y-0 left-0 rounded-pill bg-primary" style={{ width: `${pos}%` }} />
        <div className="absolute -top-7 -translate-x-1/2 num text-sm text-ink" style={{ left: `${pos}%` }}>{score}</div>
      </div>
      <div className="mt-2 grid grid-cols-4 text-xs text-muted">
        {BANDS.map((b) => <span key={b.name}>{b.name}<br /><span className="num">{b.from}+</span></span>)}
      </div>
    </div>
  );
}

function Plan({ title, run, hint }: { title: string; run: PayoffRun; hint: string }) {
  return (
    <div className="rounded-lg bg-soft p-4">
      <div className="text-sm font-semibold text-ink">{title}</div>
      <div className="mt-0.5 text-xs text-muted">{hint}</div>
      <dl className="mt-3 space-y-1.5 text-sm">
        <div className="flex justify-between"><dt className="text-body">Debt-free in</dt><dd className="num text-ink">{run.cleared ? months(run.months) : "not within 50 yrs"}</dd></div>
        <div className="flex justify-between"><dt className="text-body">Interest paid</dt><dd className="num text-ink">{inr(run.total_interest)}</dd></div>
        <div className="flex justify-between"><dt className="text-body">Under 30% use</dt><dd className="num text-ink">{months(run.months_to_30pct)}</dd></div>
      </dl>
    </div>
  );
}

export default function CreditPage() {
  const [score, setScore] = useState(0);
  const [income, setIncome] = useState(0);
  const [missed, setMissed] = useState(0);
  const [settled, setSettled] = useState(false);
  const [age, setAge] = useState(0);
  const [enq, setEnq] = useState(0);
  const [budget, setBudget] = useState(0);
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [loans, setLoans] = useState<CreditLoan[]>([]);
  const [res, setRes] = useState<CreditResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const { user } = useAuth();
  const [history, setHistory] = useState<CreditSnapshotPoint[]>([]);
  const [prefs, setPrefsState] = useState<Prefs | null>(null);
  const [notice, setNotice] = useState("");
  const [extra, setExtra] = useState(0);
  const [whatIf, setWhatIf] = useState<WhatIfResult | null>(null);
  const filled = useRef(false);

  const setCard = (i: number, p: Partial<CreditCard>) => setCards((c) => c.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const setLoan = (i: number, p: Partial<CreditLoan>) => setLoans((c) => c.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const buildReq = (): CreditRequest => ({
    score: score || null, monthly_income: income, missed_payments_12m: Math.min(missed, 12),
    has_settled_or_written_off: settled, oldest_account_years: age, enquiries_6m: enq,
    monthly_card_budget: budget,
    cards: cards.map((c) => ({ ...c, name: c.name.trim(), due_day: c.due_day || null })),
    loans: loans.filter((l) => l.name.trim()).map((l) => ({ ...l, name: l.name.trim() })),
  });

  function validate(): string {
    if (score && (score < 300 || score > 900)) return "Score must be between 300 and 900.";
    if (cards.some((c) => !c.name.trim() || c.limit <= 0)) return "Give each card a name and a limit above zero.";
    if (cards.some((c) => c.due_day && (c.due_day < 1 || c.due_day > 31))) return "Due day must be between 1 and 31.";
    return "";
  }

  // Logged-in users: prefill the form from their last snapshot and load history + reminder preference.
  useEffect(() => {
    if (!user) { setHistory([]); setPrefsState(null); return; }
    (async () => {
      try {
        const [h, p, latest] = await Promise.all([listCreditSnapshots(), getPrefs(), latestCreditSnapshot()]);
        setHistory(h);
        setPrefsState(p);
        if (latest && !filled.current) {
          filled.current = true;
          const i = latest.inputs;
          setScore(i.score ?? 0); setIncome(i.monthly_income); setMissed(i.missed_payments_12m);
          setSettled(i.has_settled_or_written_off); setAge(i.oldest_account_years); setEnq(i.enquiries_6m);
          setBudget(i.monthly_card_budget); setCards(i.cards); setLoans(i.loans);
        }
      } catch { /* the coach still works without saved data */ }
    })();
  }, [user]);

  // "What if I pay ₹X": debounce, and ignore stale responses.
  useEffect(() => {
    if (!res || cards.length === 0 || extra <= 0) { setWhatIf(null); return; }
    let live = true;
    const t = setTimeout(async () => {
      try {
        const w = await creditWhatIf(buildReq(), extra);
        if (live) setWhatIf(w);
      } catch { if (live) setWhatIf(null); }
    }, 250);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extra, res]);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setNotice(""); setExtra(0);
    const bad = validate();
    if (bad) return setError(bad);
    setBusy(true);
    try {
      setRes(await analyzeCredit(buildReq()));
      setTimeout(() => document.getElementById("results")?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveSnapshot() {
    setNotice("");
    const bad = validate();
    if (bad) return setNotice(bad);
    try {
      await saveCreditSnapshot(buildReq());
      setHistory(await listCreditSnapshots());
      setNotice("Snapshot saved. Come back next month and save another to see your progress.");
    } catch (err) {
      setNotice(errMsg(err));
    }
  }

  async function removeSnapshot(id: number) {
    if (!window.confirm("Delete this snapshot?")) return;
    try {
      await deleteCreditSnapshot(id);
      setHistory(await listCreditSnapshots());
    } catch (err) {
      setNotice(errMsg(err));
    }
  }

  async function toggleReminders(on: boolean) {
    try {
      setPrefsState(await setPrefs(on));
    } catch (err) {
      setNotice(errMsg(err));
    }
  }

  return (
    <main className="container-page py-12 sm:py-16">
      <header className="max-w-2xl">
        <span className="badge">Credit coach</span>
        <h1 className="display mt-4 text-4xl sm:text-5xl">Improve your credit score, step by step.</h1>
        <p className="mt-3 text-body">
          Enter your score and a few details from your credit report. We work out what is helping and hurting, how much to pay down, and the cheapest order to clear your cards. Nothing is saved.
        </p>
      </header>

      <form onSubmit={run} className="card mt-10 space-y-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div><label className="label">Credit score (300–900)</label><NumInput value={score} onChange={setScore} placeholder="e.g. 640" step="1" /></div>
          <div><label className="label">Monthly income (₹)</label><NumInput value={income} onChange={setIncome} /></div>
          <div><label className="label">Late-payment months (last 12)</label><NumInput value={missed} onChange={(v) => setMissed(Math.round(v))} step="1" /></div>
          <div><label className="label">Oldest account (years)</label><NumInput value={age} onChange={setAge} step="0.5" /></div>
          <div><label className="label">New applications (last 6 mo)</label><NumInput value={enq} onChange={(v) => setEnq(Math.round(v))} step="1" /></div>
          <div><label className="label">Can pay on cards / month (₹)</label><NumInput value={budget} onChange={setBudget} /></div>
          <label className="flex items-center gap-3 self-end pb-3 text-sm text-ink sm:col-span-2">
            <input type="checkbox" checked={settled} onChange={(e) => setSettled(e.target.checked)} className="h-5 w-5 accent-primary" />
            I have a settled or written-off account
          </label>
        </div>

        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Credit cards</h2>
            <button type="button" className="btn-secondary btn-sm"
              onClick={() => setCards([...cards, { name: "", limit: 0, balance: 0, apr: 42 }])}>+ Add card</button>
          </div>
          {cards.length === 0 && <p className="mt-2 text-sm text-muted">No cards added.</p>}
          {cards.length > 0 && <p className="mt-2 text-xs text-muted">Due day (1–31) is optional. Add it to get payment reminders by email.</p>}
          <div className="mt-3 space-y-3">
            {cards.map((c, i) => (
              <div key={i} className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]">
                <input className="input" placeholder="Card name" maxLength={80} value={c.name} onChange={(e) => setCard(i, { name: e.target.value })} />
                <NumInput value={c.limit} onChange={(v) => setCard(i, { limit: v })} placeholder="Limit ₹" />
                <NumInput value={c.balance} onChange={(v) => setCard(i, { balance: v })} placeholder="Balance ₹" />
                <NumInput value={c.apr} onChange={(v) => setCard(i, { apr: Math.min(v, 100) })} placeholder="APR %" step="0.5" />
                <NumInput value={c.due_day ?? 0} onChange={(v) => setCard(i, { due_day: v ? Math.min(Math.max(Math.round(v), 1), 31) : null })} placeholder="Due day" step="1" min={0} />
                <button type="button" aria-label="Remove card" className="px-3 text-muted hover:text-down" onClick={() => setCards(cards.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Loans (EMIs)</h2>
            <button type="button" className="btn-secondary btn-sm"
              onClick={() => setLoans([...loans, { name: "", emi: 0, outstanding: 0 }])}>+ Add loan</button>
          </div>
          {loans.length === 0 && <p className="mt-2 text-sm text-muted">No loans added.</p>}
          <div className="mt-3 space-y-3">
            {loans.map((l, i) => (
              <div key={i} className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto]">
                <input className="input" placeholder="Loan name" maxLength={80} value={l.name} onChange={(e) => setLoan(i, { name: e.target.value })} />
                <NumInput value={l.emi} onChange={(v) => setLoan(i, { emi: v })} placeholder="EMI ₹" />
                <NumInput value={l.outstanding} onChange={(v) => setLoan(i, { outstanding: v })} placeholder="Outstanding ₹" />
                <button type="button" aria-label="Remove loan" className="px-3 text-muted hover:text-down" onClick={() => setLoans(loans.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-4">
          <button disabled={busy} className="btn-primary btn-lg">{busy ? "Analysing…" : "Build my plan"}</button>
          {error && <span role="alert" className="text-sm font-medium text-down">{error}</span>}
        </div>
      </form>

      {res && (
        <div id="results" className="mt-12 space-y-8">
          <section className="card">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-sm text-body">Your starting point</p>
                <h2 className="display text-3xl sm:text-4xl">
                  {res.band ? <>{res.band.name} <span className="num">{res.score}</span></> : "Score not entered"}
                </h2>
                {res.band?.next_band && (
                  <p className="mt-1 text-body">
                    <span className="num text-ink">{res.band.points_to_next_band}</span> points to reach {res.band.next_band}.
                  </p>
                )}
              </div>
              <div className="flex gap-6 text-sm">
                {res.utilization_pct !== null && <div><div className="text-muted">Card use</div><div className="num text-2xl text-ink">{res.utilization_pct}%</div></div>}
                {res.dti_pct !== null && <div><div className="text-muted">Obligations / income</div><div className="num text-2xl text-ink">{res.dti_pct}%</div></div>}
              </div>
            </div>
            {res.score !== null && <ScoreBar score={res.score} />}
          </section>

          <section>
            <h2 className="display text-2xl sm:text-3xl">What is moving your score</h2>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {res.factors.map((f) => (
                <article key={f.key} className="card card-hover !p-6">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-semibold text-ink">{f.label}</h3>
                    <span className={`text-sm font-semibold ${statusText[f.status]}`}>{statusLabel[f.status]}</span>
                  </div>
                  <p className="num mt-2 text-ink">{f.value}</p>
                  <p className="mt-2 text-sm text-body">{f.why}</p>
                  <p className="mt-3 text-xs text-muted">Influence: {f.impact}</p>
                </article>
              ))}
            </div>
          </section>

          <section>
            <h2 className="display text-2xl sm:text-3xl">Your action plan</h2>
            <ol className="mt-5 space-y-3">
              {res.actions.map((a, i) => (
                <li key={i} className="card !p-6">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-white dark:text-dark">{i + 1}</span>
                    <h3 className="font-semibold text-ink">{a.title}</h3>
                    <span className="badge ml-auto normal-case">{a.when}</span>
                  </div>
                  <p className="mt-3 text-sm text-body">{a.detail}</p>
                </li>
              ))}
            </ol>
          </section>

          {res.cards.length > 0 && (
            <section className="card">
              <h2 className="text-lg font-semibold">Pay-down targets per card</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="text-left text-muted">
                    <tr><th className="py-2">Card</th><th className="text-right">Use</th><th className="text-right">Pay to reach 30%</th><th className="text-right">Pay to reach 10%</th></tr>
                  </thead>
                  <tbody>
                    {res.cards.map((c) => (
                      <tr key={c.name} className="border-t border-hairline">
                        <td className="py-3 text-ink">{c.name}</td>
                        <td className="num text-right">{c.utilization_pct}%</td>
                        <td className="num text-right text-ink">{c.pay_to_30pct ? inr(c.pay_to_30pct) : "✓"}</td>
                        <td className="num text-right text-ink">{c.pay_to_10pct ? inr(c.pay_to_10pct) : "✓"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {cards.length > 0 && cards.some((c) => c.balance > 0) && (
            <section className="card">
              <h2 className="text-lg font-semibold">What if I pay a lump sum?</h2>
              <p className="mt-1 text-sm text-body">Drag to see the effect. It goes to your highest-interest card first.</p>
              <div className="mt-5">
                <Slider label="Extra payment now" value={extra} min={0}
                  max={Math.max(1000, Math.round(cards.reduce((s, c) => s + c.balance, 0)))}
                  step={500} format={inr} onChange={setExtra} />
              </div>
              {whatIf && extra > 0 && (
                <div className="mt-6 space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg bg-soft p-4">
                      <div className="text-sm text-body">Card use</div>
                      <div className="num mt-1 text-2xl text-ink">
                        {whatIf.utilization_before_pct}% → <span className={whatIf.under_30_after ? "up" : ""}>{whatIf.utilization_after_pct}%</span>
                      </div>
                      <div className="mt-1 text-xs text-muted">
                        {whatIf.under_10_after ? "Under 10%: excellent" : whatIf.under_30_after ? "Under 30%: healthy" : "Still above 30%"}
                      </div>
                    </div>
                    <div className="rounded-lg bg-soft p-4">
                      <div className="text-sm text-body">Debt-free in</div>
                      <div className="num mt-1 text-2xl text-ink">{months(whatIf.months_before)} → {months(whatIf.months_after)}</div>
                    </div>
                    <div className="rounded-lg bg-soft p-4">
                      <div className="text-sm text-body">Interest saved</div>
                      <div className="num up mt-1 text-2xl">{inr(whatIf.interest_saved)}</div>
                    </div>
                  </div>
                  {whatIf.allocation.length > 0 && (
                    <p className="text-sm text-body">
                      Applied to: {whatIf.allocation.map((a) => `${a.card} (${inr(a.paid)})`).join(", ")}.
                    </p>
                  )}
                  <p className="text-xs text-muted">{whatIf.note}</p>
                </div>
              )}
            </section>
          )}

          {res.payoff && (
            <section className="card-dark">
              <h2 className="display !text-white text-2xl sm:text-3xl">Fastest way out of card debt</h2>
              <p className="mt-2 text-white/70">
                Paying <span className="num text-white">{inr(res.payoff.monthly_budget)}</span> a month.
                {res.payoff.interest_saved_vs_minimum > 0 && (
                  <> The avalanche order saves <span className="num up">{inr(res.payoff.interest_saved_vs_minimum)}</span> in interest versus paying minimums.</>
                )}
              </p>
              <div className="mt-6 grid gap-4 text-ink md:grid-cols-3">
                <Plan title="Avalanche" hint="Highest interest first. Cheapest." run={res.payoff.avalanche} />
                <Plan title="Snowball" hint="Smallest balance first. Quick wins." run={res.payoff.snowball} />
                <Plan title="Minimums only" hint="What happens if nothing changes." run={res.payoff.minimum_only} />
              </div>
              <ul className="mt-6 list-disc space-y-1 pl-5 text-xs text-white/60">
                {res.payoff.assumptions.map((a) => <li key={a}>{a}</li>)}
              </ul>
            </section>
          )}

          <section className="card">
            <h2 className="text-lg font-semibold">Track your progress</h2>
            {!user ? (
              <p className="mt-2 text-body">
                <Link href="/signup" className="btn-text">Create a free account</Link> to save snapshots, see your score and card use over time, and get payment-due reminders.
              </p>
            ) : (
              <>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button onClick={saveSnapshot} className="btn-primary">Save this snapshot</button>
                  {notice && <span className="text-sm text-body">{notice}</span>}
                </div>

                {history.length >= 2 && (() => {
                  const first = history[0], last = history[history.length - 1];
                  const dScore = first.score !== null && last.score !== null ? last.score - first.score : null;
                  const dUtil = first.utilization_pct !== null && last.utilization_pct !== null ? last.utilization_pct - first.utilization_pct : null;
                  return (
                    <div className="mt-6 grid gap-3 sm:grid-cols-2">
                      {dScore !== null && (
                        <div className="rounded-lg bg-soft p-4">
                          <div className="text-sm text-body">Score since first snapshot</div>
                          <div className={`num mt-1 text-2xl ${dScore >= 0 ? "up" : "down"}`}>{dScore >= 0 ? "+" : "−"}{Math.abs(dScore)}</div>
                        </div>
                      )}
                      {dUtil !== null && (
                        <div className="rounded-lg bg-soft p-4">
                          <div className="text-sm text-body">Card use since first snapshot</div>
                          <div className={`num mt-1 text-2xl ${dUtil <= 0 ? "up" : "down"}`}>{dUtil > 0 ? "+" : dUtil < 0 ? "−" : ""}{Math.abs(dUtil).toFixed(1)} pts</div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {history.length >= 2 && (
                  <div className="mt-6">
                    <ResponsiveContainer width="100%" height={260}>
                      <LineChart data={history.map((h) => ({
                        label: h.created_at ? new Date(h.created_at).toLocaleDateString() : `#${h.id}`,
                        Score: h.score, "Card use %": h.utilization_pct,
                      }))} margin={{ left: 0, right: 8, top: 8 }}>
                        <CartesianGrid stroke={GRID} vertical={false} />
                        <XAxis dataKey="label" stroke={AXIS} tickLine={false} tick={{ fontSize: 11 }} />
                        <YAxis yAxisId="s" stroke={AXIS} tickLine={false} axisLine={false} domain={[300, 900]} width={40} />
                        <YAxis yAxisId="u" orientation="right" stroke={AXIS} tickLine={false} axisLine={false} domain={[0, 100]} width={40} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Line yAxisId="s" dataKey="Score" stroke="#2f6bff" strokeWidth={3} connectNulls />
                        <Line yAxisId="u" dataKey="Card use %" stroke="#7c828a" strokeWidth={2} strokeDasharray="4 3" connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
                    <p className="mt-1 text-xs text-muted">Blue: score (left axis). Gray dashed: card use % (right axis).</p>
                  </div>
                )}
                {history.length === 1 && <p className="mt-4 text-sm text-body">One snapshot saved. Save another next month to see a trend.</p>}

                {history.length > 0 && (
                  <ul className="mt-6 divide-y divide-hairline text-sm">
                    {[...history].reverse().slice(0, 6).map((h) => (
                      <li key={h.id} className="flex items-center justify-between gap-3 py-2">
                        <span className="text-body">{h.created_at ? new Date(h.created_at).toLocaleDateString() : "—"}</span>
                        <span className="num text-ink">{h.score ?? "no score"} · {h.utilization_pct ?? "—"}% use</span>
                        <button onClick={() => removeSnapshot(h.id)} className="text-muted hover:text-down">Delete</button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-6 flex items-start gap-3 border-t border-hairline pt-5">
                  <input id="rem" type="checkbox" className="mt-1 h-5 w-5 accent-primary"
                    checked={!!prefs?.email_alerts} disabled={!prefs} onChange={(e) => toggleReminders(e.target.checked)} />
                  <label htmlFor="rem" className="text-sm text-ink">
                    Email me when a card payment is due in the next 3 days
                    <span className="mt-0.5 block text-xs text-muted">
                      Uses the due days and balances from your latest saved snapshot, so save a fresh one after you pay.
                      {prefs && !prefs.email_configured && " Email sending is not set up on this server yet."}
                    </span>
                  </label>
                </div>
              </>
            )}
          </section>

          <p className="text-xs text-muted">{res.disclaimer}</p>
        </div>
      )}
    </main>
  );
}
