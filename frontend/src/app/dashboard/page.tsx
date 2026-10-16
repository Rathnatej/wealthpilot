"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { inr } from "@/components/WealthChart";
import { Dashboard, Prefs, errMsg, getDashboard, getPrefs, setPrefs } from "@/services/api";

function Ring({ score }: { score: number }) {
  const r = 70, c = 2 * Math.PI * r, off = c * (1 - Math.min(Math.max(score, 0), 100) / 100);
  return (
    <svg viewBox="0 0 180 180" className="h-44 w-44" role="img" aria-label={`Health score ${score} out of 100`}>
      <circle cx="90" cy="90" r={r} fill="none" strokeWidth="14" className="stroke-strong" />
      <circle cx="90" cy="90" r={r} fill="none" strokeWidth="14" strokeLinecap="round"
        className="stroke-primary" strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 90 90)" />
      <text x="90" y="92" textAnchor="middle" className="fill-ink font-mono" style={{ fontSize: 44, fontWeight: 500 }}>{score}</text>
      <text x="90" y="116" textAnchor="middle" className="fill-muted" style={{ fontSize: 13 }}>out of 100</text>
    </svg>
  );
}

function DashboardView() {
  const [d, setD] = useState<Dashboard | null>(null);
  const [prefs, setPrefsState] = useState<Prefs | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([getDashboard(), getPrefs()])
      .then(([a, b]) => { setD(a); setPrefsState(b); })
      .catch((e) => setError(errMsg(e)));
  }, []);

  async function toggle(on: boolean) {
    try { setPrefsState(await setPrefs(on)); } catch (e) { setError(errMsg(e)); }
  }

  if (error && !d) return <p role="alert" className="container-page py-16 text-down">{error}</p>;
  if (!d) return <p className="container-page py-16 text-body">Loading your dashboard…</p>;

  const h = d.health;
  return (
    <main className="container-page py-12 sm:py-16">
      <header>
        <h1 className="display text-4xl sm:text-5xl">Dashboard</h1>
        <p className="mt-3 max-w-2xl text-body">Your financial health at a glance, with the few things worth acting on.</p>
      </header>

      {!d.has_twin || !h ? (
        <section className="card mt-10 text-center">
          <h2 className="text-xl font-semibold">Start with your financial twin</h2>
          <p className="mx-auto mt-2 max-w-md text-body">Add your income, expenses, assets and loans to see your health score and alerts.</p>
          <Link href="/twin" className="btn-primary mt-6">Set up my twin</Link>
        </section>
      ) : (
        <>
          <section className="mt-10 grid gap-6 lg:grid-cols-3">
            <div className="card flex flex-col items-center text-center">
              <Ring score={h.score} />
              <p className="mt-2 text-lg font-semibold text-ink">{h.band}</p>
              <p className="mt-1 text-sm text-body">Net worth <span className="num text-ink">{d.net_worth !== null ? inr(d.net_worth) : "—"}</span> · snapshot v{d.version_id}</p>
            </div>

            <div className="card lg:col-span-2">
              <h2 className="text-lg font-semibold">What makes up your score</h2>
              <ul className="mt-5 space-y-5">
                {h.components.map((c) => (
                  <li key={c.key}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="font-medium text-ink">{c.label}</span>
                      <span className="num text-ink">{c.points} / {c.max}</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-pill bg-strong">
                      <div className="h-full rounded-pill bg-primary" style={{ width: `${(c.points / c.max) * 100}%` }} />
                    </div>
                    <p className="mt-1.5 text-xs text-muted">{c.note}{c.value !== null && <> Yours: <span className="num">{String(c.value)}</span></>}</p>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="mt-6 grid gap-4 sm:grid-cols-3">
            {[
              ["Emergency fund", h.metrics.emergency_months !== null ? `${h.metrics.emergency_months} months` : "—"],
              ["Debt-to-income", h.metrics.dti_pct !== null ? `${h.metrics.dti_pct}%` : "—"],
              ["Savings rate", h.metrics.savings_rate_pct !== null ? `${h.metrics.savings_rate_pct}%` : "—"],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-soft p-4"><div className="text-sm text-body">{k}</div><div className="num mt-1 text-2xl text-ink">{v}</div></div>
            ))}
          </section>
        </>
      )}

      <section className="mt-10">
        <h2 className="display text-2xl sm:text-3xl">Worth a look</h2>
        {d.alerts.length === 0 ? (
          <p className="card mt-4 text-body">Nothing needs attention right now.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {d.alerts.map((a) => (
              <li key={a.id} className="card !p-5">
                <div className="flex items-center gap-3">
                  <span className={`h-2.5 w-2.5 rounded-full ${a.severity === "warning" ? "bg-warn" : "bg-primary"}`} aria-hidden />
                  <h3 className="font-semibold text-ink">{a.title}</h3>
                </div>
                <p className="mt-2 text-sm text-body">{a.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card mt-10">
        <h2 className="text-lg font-semibold">Email check-ins</h2>
        <label className="mt-3 flex items-start gap-3 text-sm text-ink">
          <input type="checkbox" className="mt-1 h-5 w-5 accent-primary" checked={!!prefs?.email_alerts} disabled={!prefs}
            onChange={(e) => toggle(e.target.checked)} />
          <span>
            Email me when something needs attention (low emergency fund, goal falling behind, card payment due)
            {prefs && !prefs.email_configured && <span className="mt-0.5 block text-xs text-muted">Email sending isn&apos;t set up on this server yet, so nothing will be sent for now.</span>}
          </span>
        </label>
        {error && <p role="alert" className="mt-2 text-sm text-down">{error}</p>}
      </section>

      <section className="mt-10">
        <Link href="/voice" className="card-dark flex flex-wrap items-center justify-between gap-4 !p-6 sm:!p-8">
          <div>
            <div className="text-xl font-semibold">Talk to your assistant</div>
            <div className="mt-1 text-sm opacity-80">A calm voice conversation about your money, in English, Hindi, Telugu and more.</div>
          </div>
          <span className="btn-secondary btn-sm">Start talking</span>
        </Link>
      </section>

      <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["/planners", "Planners", "Retirement, step-up SIP, loan vs invest"],
          ["/chat", "Ask the copilot", "What-if questions in plain words"],
          ["/credit", "Credit coach", "Improve your score step by step"],
          ["/tutor", "Learn", "Finance terms with your own numbers"],
        ].map(([href, t, s]) => (
          <Link key={href} href={href} className="card card-hover !p-5">
            <div className="font-semibold text-ink">{t}</div>
            <div className="mt-1 text-sm text-body">{s}</div>
          </Link>
        ))}
      </section>
    </main>
  );
}

export default function DashboardPage() {
  return <RequireAuth><DashboardView /></RequireAuth>;
}
