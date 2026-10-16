"use client";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Explain, Stat } from "@/components/Explain";
import { RequireAuth } from "@/components/RequireAuth";
import { AXIS, GRID, inr, tooltipStyle } from "@/components/WealthChart";
import { InsightFacts, Txn, errMsg, parseBankFile, spendingInsights } from "@/services/api";

const BASE_CATEGORIES = ["salary", "rent", "emi", "investment", "food", "utilities", "shopping", "travel", "health", "other"];
const SHOWN = 150;

function InsightsView() {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [txns, setTxns] = useState<Txn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [res, setRes] = useState<{ facts: InsightFacts; explanation: string; source: "ai" | "template" } | null>(null);
  const [onlyOther, setOnlyOther] = useState(false);

  const categories = useMemo(() => Array.from(new Set([...BASE_CATEGORIES, ...txns.map((t) => t.category)])), [txns]);
  const unsorted = txns.filter((t) => t.category === "other").length;

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setError("Choose a statement file first (CSV or PDF).");
    setBusy(true); setError(""); setRes(null);
    try {
      const r = await parseBankFile(file, password || undefined);
      setTxns(r.transactions);
      if (r.count === 0) setError("No transactions were found in this file. Try a CSV export from your bank.");
    } catch (err) { setError(errMsg(err)); setTxns([]); } finally { setBusy(false); }
  }

  async function analyse() {
    setBusy(true); setError("");
    try { setRes(await spendingInsights(txns)); } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }

  const setCat = (idx: number, category: string) => setTxns((p) => p.map((t, i) => (i === idx ? { ...t, category } : t)));
  const rows = txns.map((t, i) => ({ t, i })).filter((x) => !onlyOther || x.t.category === "other");
  const f = res?.facts;
  const chart = f?.spend_by_month ? Object.entries(f.spend_by_month).map(([month, spend]) => ({ month, spend })) : [];

  return (
    <main className="container-page py-12 sm:py-16">
      <header className="max-w-2xl">
        <span className="badge">Insights</span>
        <h1 className="display mt-4 text-4xl sm:text-5xl">See where your money went.</h1>
        <p className="mt-3 text-body">
          Upload a bank statement (CSV works best, PDF is supported). Check the categories, then get a month-over-month breakdown.
          The file is read in memory and not stored.
        </p>
      </header>

      <form onSubmit={upload} className="card mt-10 space-y-4">
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
          <div>
            <label className="label" htmlFor="stmt">Statement file</label>
            <input id="stmt" type="file" accept=".csv,.pdf,text/csv,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-body file:mr-4 file:h-11 file:cursor-pointer file:rounded-pill file:border-0 file:bg-strong file:px-5 file:font-semibold file:text-ink" />
          </div>
          <div>
            <label className="label" htmlFor="pw">PDF password (if any)</label>
            <input id="pw" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
          </div>
          <button disabled={busy} className="btn-primary">{busy && !txns.length ? "Reading…" : "Read file"}</button>
        </div>
        {error && <p role="alert" className="text-sm font-medium text-down">{error}</p>}
      </form>

      {txns.length > 0 && (
        <section className="card mt-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Review {txns.length} transactions</h2>
              <p className="text-sm text-body">
                {unsorted > 0 ? <><span className="num text-ink">{unsorted}</span> are uncategorised. Fix any that matter, it makes the insights more accurate.</> : "Everything is categorised."}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={onlyOther} onChange={(e) => setOnlyOther(e.target.checked)} />
                Only uncategorised
              </label>
              <button onClick={analyse} disabled={busy} className="btn-primary">{busy ? "Analysing…" : "Get insights"}</button>
            </div>
          </div>

          <div className="mt-4 max-h-[420px] overflow-auto rounded-lg border border-hairline">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="sticky top-0 bg-soft text-left text-muted">
                <tr><th className="p-3">Date</th><th>Description</th><th className="text-right">Amount</th><th className="p-3">Category</th></tr>
              </thead>
              <tbody>
                {rows.slice(0, SHOWN).map(({ t, i }) => (
                  <tr key={i} className={`border-t border-hairline ${t.category === "other" ? "bg-warn/10" : ""}`}>
                    <td className="whitespace-nowrap p-3 text-body">{t.date}</td>
                    <td className="max-w-[260px] truncate text-ink" title={t.description}>{t.description}</td>
                    <td className={`num whitespace-nowrap text-right ${t.type === "credit" ? "up" : "text-ink"}`}>{t.type === "credit" ? "+" : "−"}{inr(t.amount)}</td>
                    <td className="p-3">
                      <select value={t.category} onChange={(e) => setCat(i, e.target.value)} aria-label="Category"
                        className="h-9 rounded-md border border-hairline bg-canvas px-2 text-sm text-ink">
                        {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > SHOWN && <p className="mt-2 text-xs text-muted">Showing the first {SHOWN} of {rows.length}. All rows are included in the analysis.</p>}
        </section>
      )}

      {res && f && (
        <section className="mt-10 space-y-6">
          {!f.months.length ? (
            <p className="card text-body">Not enough dated spending to compare months.{f.skipped_rows ? ` ${f.skipped_rows} rows had unreadable dates.` : ""}</p>
          ) : (
            <>
              <h2 className="display text-2xl sm:text-3xl">Your spending</h2>
              <div className="grid gap-4 sm:grid-cols-3">
                <Stat label={`Spent in ${f.latest_month}`} value={inr(f.spend_by_month?.[f.latest_month ?? ""] ?? 0)} />
                <Stat label="Income that month" value={inr(f.income_latest_month ?? 0)} />
                <Stat label="Savings rate" value={f.savings_rate_latest_pct != null ? `${f.savings_rate_latest_pct}%` : "—"}
                  tone={f.savings_rate_latest_pct != null ? (f.savings_rate_latest_pct >= 20 ? "up" : f.savings_rate_latest_pct < 0 ? "down" : undefined) : undefined} />
              </div>

              <div className="card">
                <h3 className="text-lg font-semibold">Spending by month</h3>
                <div className="mt-4">
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={chart} margin={{ left: 0, right: 8, top: 8 }}>
                      <CartesianGrid stroke={GRID} vertical={false} />
                      <XAxis dataKey="month" stroke={AXIS} tickLine={false} />
                      <YAxis stroke={AXIS} tickLine={false} axisLine={false} tickFormatter={inr} width={72} />
                      <Tooltip formatter={(v) => inr(Number(v))} contentStyle={tooltipStyle} cursor={{ fill: "rgba(124,130,138,0.12)" }} />
                      <Bar dataKey="spend" name="Spent" fill="#2f6bff" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <div className="card">
                  <h3 className="text-lg font-semibold">Top categories</h3>
                  <ul className="mt-4 space-y-4">
                    {(f.top_categories ?? []).map((c) => (
                      <li key={c.category}>
                        <div className="flex justify-between text-sm"><span className="capitalize text-ink">{c.category}</span><span className="num text-ink">{inr(c.total)} · {c.share_pct}%</span></div>
                        <div className="mt-1.5 h-2 overflow-hidden rounded-pill bg-strong"><div className="h-full rounded-pill bg-primary" style={{ width: `${c.share_pct}%` }} /></div>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="card">
                  <h3 className="text-lg font-semibold">Biggest changes{f.previous_month ? ` vs ${f.previous_month}` : ""}</h3>
                  {(f.changes ?? []).length === 0 ? <p className="mt-3 text-sm text-body">Add a second month of data to see changes.</p> : (
                    <ul className="mt-4 divide-y divide-hairline text-sm">
                      {(f.changes ?? []).map((c) => (
                        <li key={c.category} className="flex items-center justify-between gap-3 py-2.5">
                          <span className="capitalize text-ink">{c.category}</span>
                          <span className={`num ${c.change > 0 ? "down" : "up"}`}>
                            {c.change > 0 ? "+" : "−"}{inr(Math.abs(c.change))}{c.change_pct !== null && ` (${c.change_pct > 0 ? "+" : ""}${c.change_pct}%)`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </>
          )}
          <Explain text={res.explanation} source={res.source} />
        </section>
      )}
    </main>
  );
}

export default function InsightsPage() {
  return <RequireAuth><InsightsView /></RequireAuth>;
}
