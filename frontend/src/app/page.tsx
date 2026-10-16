"use client";
import { useEffect, useState } from "react";
import { Slider } from "@/components/Slider";
import { WealthChart, inr } from "@/components/WealthChart";
import { explain, parseIntent, simulate, Scenario, SimResponse, Twin } from "@/services/api";

const blank = (name: string): Scenario => ({
  name, sip_delta: 0, new_loan_emi: 0, new_loan_months: 0, lump_sum: 0, return_delta: 0,
});

export default function Home() {
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

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true); setError("");
      try { setData(await simulate(twin, scenarios)); }
      catch { setError("Cannot reach the API. Is the backend running?"); }
      finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [twin, scenarios]);

  const setS = (i: number, patch: Partial<Scenario>) =>
    setScenarios((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function ask() {
    setAiMsg("Thinking…");
    try {
      const r = await parseIntent(query);
      if (r.refused || !r.scenario) { setAiMsg(r.message || "I can only help with educational what-if scenarios."); return; }
      setScenarios((s) => [{ ...r.scenario!, name: "AI Scenario" }, ...s.slice(1)]);
      setAiMsg("Scenario A replaced with your AI-parsed scenario.");
      if (data) setAiMsg(await explain(`Query: ${query}\nBaseline final: ${data.baseline.final_corpus}`));
    } catch { setAiMsg("AI service unavailable (check GEMINI_API_KEY)."); }
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header>
        <h1 className="text-3xl font-bold">WealthPilot</h1>
        <p className="text-sm text-slate-400">Financial twin &amp; scenario simulator. Educational only — not investment advice.</p>
      </header>

      <div className="grid gap-6 md:grid-cols-3">
        <section className="space-y-4 rounded-xl bg-slate-900 p-4">
          <h2 className="font-semibold">Your twin</h2>
          <Slider label="Current corpus" value={twin.current_corpus} min={0} max={20000000} step={100000} format={inr} onChange={(v) => setTwin({ ...twin, current_corpus: v })} />
          <Slider label="Monthly SIP" value={twin.monthly_sip} min={0} max={200000} step={1000} format={inr} onChange={(v) => setTwin({ ...twin, monthly_sip: v })} />
          <Slider label="Expected return" value={twin.annual_return} min={0.02} max={0.2} step={0.005} format={(v) => `${(v * 100).toFixed(1)}%`} onChange={(v) => setTwin({ ...twin, annual_return: v })} />
          <Slider label="Horizon (years)" value={twin.years} min={1} max={30} step={1} onChange={(v) => setTwin({ ...twin, years: v })} />
        </section>

        {scenarios.map((s, i) => (
          <section key={i} className="space-y-4 rounded-xl bg-slate-900 p-4">
            <h2 className="font-semibold">{s.name}</h2>
            <Slider label="SIP change" value={s.sip_delta} min={-20000} max={100000} step={1000} format={inr} onChange={(v) => setS(i, { sip_delta: v })} />
            <Slider label="New loan EMI" value={s.new_loan_emi} min={0} max={100000} step={1000} format={inr} onChange={(v) => setS(i, { new_loan_emi: v })} />
            <Slider label="Loan tenure (months)" value={s.new_loan_months} min={0} max={240} step={6} onChange={(v) => setS(i, { new_loan_months: v })} />
            <Slider label="Lump sum" value={s.lump_sum} min={0} max={5000000} step={50000} format={inr} onChange={(v) => setS(i, { lump_sum: v })} />
          </section>
        ))}
      </div>

      <section className="rounded-xl bg-slate-900 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">Wealth trajectory</h2>
          {loading && <span className="text-xs text-slate-400">Updating…</span>}
        </div>
        {error && <p className="text-red-400">{error}</p>}
        {data && <WealthChart data={data} />}
        {data && (
          <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
            {[data.baseline, ...data.scenarios].map((r) => (
              <div key={r.name} className="rounded-lg bg-slate-800 p-3">
                <div className="text-slate-400">{r.name}</div>
                <div className="text-lg font-semibold">{inr(r.final_corpus)}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2 rounded-xl bg-slate-900 p-4">
        <h2 className="font-semibold">Ask a what-if question</h2>
        <div className="flex gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="How does a ₹10L loan over 5 years affect my goals?"
            className="flex-1 rounded-lg bg-slate-800 px-3 py-2 outline-none" />
          <button onClick={ask} className="rounded-lg bg-emerald-500 px-4 py-2 font-medium text-slate-950">Ask</button>
        </div>
        {aiMsg && <p className="whitespace-pre-wrap text-sm text-slate-300">{aiMsg}</p>}
      </section>
    </main>
  );
}
