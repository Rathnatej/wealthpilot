"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Slider } from "@/components/Slider";
import { WealthChart, inr } from "@/components/WealthChart";
import { useAuth } from "@/context/AuthContext";
import { copilot, errMsg, latestTwin, simulate, Scenario, SimResponse, Twin } from "@/services/api";

const blank = (name: string): Scenario => ({
  name, sip_delta: 0, new_loan_emi: 0, new_loan_months: 0, lump_sum: 0, return_delta: 0,
});

export default function Home() {
  const { user } = useAuth();
  const [twin, setTwin] = useState<Twin>({
    current_corpus: 500000, monthly_sip: 20000, annual_return: 0.12,
    monthly_emi: 0, emi_months: 0, years: 10,
  });
  const [scenarios, setScenarios] = useState<Scenario[]>([
    { ...blank("Scenario A"), sip_delta: 10000 },
    { ...blank("Scenario B"), new_loan_emi: 15000, new_loan_months: 60 },
  ]);
  const [data, setData] = useState<SimResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [aiMsg, setAiMsg] = useState("");
  const [aiNotes, setAiNotes] = useState<string[]>([]);
  const [twinMsg, setTwinMsg] = useState("");

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true); setError("");
      try { setData(await simulate(twin, scenarios)); }
      catch (e) { setError(errMsg(e)); }
      finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [twin, scenarios]);

  const setS = (i: number, patch: Partial<Scenario>) =>
    setScenarios((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function loadMyTwin() {
    setTwinMsg("");
    try {
      const t = await latestTwin();
      if (!t) return setTwinMsg("You haven't saved a twin yet. Add one on the My Twin page.");
      // Investable assets exclude real estate.
      const investable = t.assets.filter((a) => a.kind !== "real_estate").reduce((s, a) => s + a.value, 0);
      setTwin((p) => ({
        ...p,
        current_corpus: Math.min(investable, 20000000),
        monthly_sip: Math.min(t.monthly_sip, 200000),
        annual_return: Math.min(Math.max(t.annual_return, 0.02), 0.2),
      }));
      setTwinMsg(`Loaded your twin (v${t.version_id}).`);
    } catch (e) { setTwinMsg(errMsg(e)); }
  }

  async function ask() {
    if (!user) return setAiMsg("Log in to use the AI assistant.");
    if (!query.trim()) return;
    setAiMsg("Thinking…");
    setAiNotes([]);
    try {
      const r = await copilot(query);
      if (r.refused || !r.scenario) { setAiMsg(r.message || "I can only help with educational what-if scenarios."); return; }
      setScenarios((s) => [{ ...r.scenario!, name: "AI Scenario" }, ...s.slice(1)]);
      setAiMsg(r.explanation || "Scenario A replaced with your parsed scenario.");
      setAiNotes(r.assumptions);
    } catch (e) {
      setAiMsg(errMsg(e, "The assistant is unavailable right now."));
    }
  }

  const finals = data ? [data.baseline, ...data.scenarios] : [];

  return (
    <main>
      {/* Dark editorial hero with layered product cards */}
      <section className="overflow-hidden bg-dark text-white">
        <div className="container-page grid items-center gap-12 py-16 sm:py-24 lg:grid-cols-2">
          <div>
            <span className="inline-flex rounded-pill bg-dark-elevated px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white/80">
              Educational simulator
            </span>
            <h1 className="display mt-6 !text-white text-[40px] sm:text-6xl lg:text-7xl">
              See where your money could go.
            </h1>
            <p className="mt-6 max-w-md text-base text-white/70 sm:text-lg">
              Model SIPs, loans and lump sums side by side. Every figure comes from a deterministic engine, so the numbers are never guessed.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#simulator" className="btn-primary btn-lg !text-white">Try the simulator</a>
              {!user && <Link href="/signup" className="btn-outline btn-lg">Create free account</Link>}
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-md lg:max-w-none">
            <div className="card-dark relative z-10 lg:translate-x-6">
              <p className="text-sm text-white/60">Projected corpus · {twin.years} yrs</p>
              <p className="num mt-2 text-4xl text-white">{data ? inr(data.baseline.final_corpus) : "—"}</p>
              <p className="mt-1 text-sm text-white/60">Baseline at {(twin.annual_return * 100).toFixed(1)}% a year</p>
            </div>
            {finals[1] && (
              <div className="card-dark relative mt-4 hidden border border-white/5 sm:block lg:-mt-2 lg:-translate-x-2 lg:rotate-[-2deg]">
                <p className="text-sm text-white/60">{finals[1].name}</p>
                <p className="num mt-2 text-2xl text-white">{inr(finals[1].final_corpus)}</p>
                <p className={`num mt-1 text-sm ${finals[1].final_corpus >= finals[0].final_corpus ? "up" : "down"}`}>
                  {finals[1].final_corpus >= finals[0].final_corpus ? "+" : "−"}
                  {inr(Math.abs(finals[1].final_corpus - finals[0].final_corpus))} vs baseline
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      <section id="simulator" className="container-page section">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="display text-3xl sm:text-5xl">Scenario simulator</h2>
            <p className="mt-2 text-body">Drag the sliders. The chart updates as you move. Not investment advice.</p>
          </div>
          {user ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {twinMsg && <span className="text-body">{twinMsg}</span>}
              <button onClick={loadMyTwin} className="btn-secondary">Load my saved twin</button>
            </div>
          ) : (
            <p className="text-sm text-body">
              <Link href="/signup" className="btn-text">Create an account</Link> to save your twin and goals.
            </p>
          )}
        </header>

        <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <section className="card card-hover space-y-5">
            <h3 className="text-lg font-semibold">Your twin</h3>
            <Slider label="Current corpus" value={twin.current_corpus} min={0} max={20000000} step={100000} format={inr} onChange={(v) => setTwin({ ...twin, current_corpus: v })} />
            <Slider label="Monthly SIP" value={twin.monthly_sip} min={0} max={200000} step={1000} format={inr} onChange={(v) => setTwin({ ...twin, monthly_sip: v })} />
            <Slider label="Expected return" value={twin.annual_return} min={0.02} max={0.2} step={0.005} format={(v) => `${(v * 100).toFixed(1)}%`} onChange={(v) => setTwin({ ...twin, annual_return: v })} />
            <Slider label="Horizon (years)" value={twin.years} min={1} max={30} step={1} onChange={(v) => setTwin({ ...twin, years: v })} />
          </section>

          {scenarios.map((s, i) => (
            <section key={i} className="card card-hover space-y-5">
              <h3 className="text-lg font-semibold">{s.name}</h3>
              <Slider label="SIP change" value={s.sip_delta} min={-20000} max={100000} step={1000} format={inr} onChange={(v) => setS(i, { sip_delta: v })} />
              <Slider label="New loan EMI" value={s.new_loan_emi} min={0} max={100000} step={1000} format={inr} onChange={(v) => setS(i, { new_loan_emi: v })} />
              <Slider label="Loan tenure (months)" value={s.new_loan_months} min={0} max={240} step={6} onChange={(v) => setS(i, { new_loan_months: v })} />
              <Slider label="Lump sum" value={s.lump_sum} min={0} max={5000000} step={50000} format={inr} onChange={(v) => setS(i, { lump_sum: v })} />
            </section>
          ))}
        </div>

        <section className="card mt-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold">Wealth trajectory</h3>
            {loading && <span className="text-xs text-muted">Updating…</span>}
          </div>
          {error && <p role="alert" className="text-down">{error}</p>}
          {data && <WealthChart data={data} />}
          {data && (
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {finals.map((r) => (
                <div key={r.name} className="rounded-lg bg-soft p-4">
                  <div className="text-sm text-body">{r.name}</div>
                  <div className="num mt-1 text-2xl text-ink">{inr(r.final_corpus)}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card mt-6">
          <h3 className="text-lg font-semibold">Ask a what-if question</h3>
          <p className="mt-1 text-sm text-body">Describe a scenario in plain words. We compute the numbers, the AI only explains them.</p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()}
              placeholder="How does a ₹10L loan over 5 years affect my goals?" className="input flex-1" />
            <button onClick={ask} className="btn-primary">Ask</button>
          </div>
          {!user && <p className="mt-2 text-xs text-muted">Log in to use the AI assistant.</p>}
          {aiMsg && <p className="mt-4 whitespace-pre-wrap text-sm text-ink">{aiMsg}</p>}
          {aiNotes.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted">
              {aiNotes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          )}
        </section>
      </section>
    </main>
  );
}
