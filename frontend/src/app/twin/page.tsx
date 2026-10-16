"use client";
import { useCallback, useEffect, useState } from "react";
import { NetWorthChart } from "@/components/NetWorthChart";
import { NumInput } from "@/components/NumInput";
import { RequireAuth } from "@/components/RequireAuth";
import { inr } from "@/components/WealthChart";
import {
  Asset, AssetKind, Liability, TwinPoint, errMsg, latestTwin, saveTwin, twinHistory,
} from "@/services/api";

const KINDS: { value: AssetKind; label: string }[] = [
  { value: "cash", label: "Cash / savings" },
  { value: "epf", label: "EPF" },
  { value: "ppf", label: "PPF" },
  { value: "equity_mf", label: "Equity mutual funds" },
  { value: "gold", label: "Gold" },
  { value: "real_estate", label: "Real estate" },
  { value: "other", label: "Other" },
];

function TwinEditor() {
  const [income, setIncome] = useState(0);
  const [expenses, setExpenses] = useState(0);
  const [sip, setSip] = useState(0);
  const [returnPct, setReturnPct] = useState(12);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [liabs, setLiabs] = useState<Liability[]>([]);
  const [history, setHistory] = useState<TwinPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refreshHistory = useCallback(async () => setHistory(await twinHistory()), []);

  useEffect(() => {
    (async () => {
      try {
        const [t] = await Promise.all([latestTwin(), refreshHistory()]);
        if (t) {
          setIncome(t.monthly_income);
          setExpenses(t.monthly_expenses);
          setSip(t.monthly_sip);
          setReturnPct(Math.round(t.annual_return * 1000) / 10);
          setAssets(t.assets);
          setLiabs(t.liabilities);
        }
      } catch (e) {
        setError(errMsg(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshHistory]);

  const totalAssets = assets.reduce((s, a) => s + a.value, 0);
  const totalLiabs = liabs.reduce((s, l) => s + l.principal, 0);
  const emis = liabs.reduce((s, l) => s + l.monthly_emi, 0);
  const surplus = income - expenses - sip - emis;
  const nextVersion = (history.at(-1)?.version_id ?? 0) + 1;

  const setAsset = (i: number, p: Partial<Asset>) => setAssets((a) => a.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const setLiab = (i: number, p: Partial<Liability>) => setLiabs((a) => a.map((x, j) => (j === i ? { ...x, ...p } : x)));

  async function save() {
    setError("");
    setNotice("");
    if (assets.some((a) => !a.name.trim()) || liabs.some((l) => !l.name.trim())) {
      setError("Give every asset and liability a name.");
      return;
    }
    setSaving(true);
    try {
      const saved = await saveTwin({
        monthly_income: income, monthly_expenses: expenses, monthly_sip: sip,
        annual_return: returnPct / 100,
        assets: assets.map((a) => ({ ...a, name: a.name.trim() })),
        liabilities: liabs.map((l) => ({ ...l, name: l.name.trim() })),
      });
      await refreshHistory();
      setNotice(`Saved as version ${saved.version_id}. Net worth ${inr(saved.net_worth)}.`);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="container-page py-16 text-body">Loading your twin…</p>;

  const stats: [string, string, string][] = [
    ["Total assets", inr(totalAssets), "text-ink"],
    ["Total liabilities", inr(totalLiabs), "text-ink"],
    ["Net worth", inr(totalAssets - totalLiabs), "text-ink"],
    ["Monthly surplus", `${surplus < 0 ? "−" : ""}${inr(Math.abs(surplus))}`, surplus < 0 ? "down" : "up"],
  ];

  return (
    <main className="container-page py-12 sm:py-16">
      <header>
        <h1 className="display text-4xl sm:text-5xl">My financial twin</h1>
        <p className="mt-3 max-w-2xl text-body">Every save creates a new snapshot, so you can track net worth over time.</p>
      </header>

      {/* Stat tiles: dark first tile as the hero number */}
      <div className="mt-10 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map(([k, v, c], i) => (
          <div key={k} className={i === 2 ? "card-dark" : "card !p-5"}>
            <div className={`text-sm ${i === 2 ? "text-white/60" : "text-body"}`}>{k}</div>
            <div className={`num mt-1 text-xl sm:text-2xl ${i === 2 ? "!text-white" : c}`}>{v}</div>
          </div>
        ))}
      </div>

      <section className="card mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div><label className="label">Monthly income (₹)</label><NumInput value={income} onChange={setIncome} /></div>
        <div><label className="label">Monthly expenses (₹)</label><NumInput value={expenses} onChange={setExpenses} /></div>
        <div><label className="label">Monthly SIP (₹)</label><NumInput value={sip} onChange={setSip} /></div>
        <div><label className="label">Expected return (% / yr)</label><NumInput value={returnPct} onChange={setReturnPct} step="0.5" /></div>
      </section>

      <section className="card mt-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Assets</h2>
          <button onClick={() => setAssets([...assets, { kind: "cash", name: "", value: 0 }])} className="btn-secondary btn-sm">+ Add asset</button>
        </div>
        {assets.length === 0 && <p className="text-sm text-muted">No assets yet.</p>}
        {assets.map((a, i) => (
          <div key={i} className="grid items-center gap-3 border-t border-hairline pt-4 sm:grid-cols-[1fr_2fr_1fr_auto]">
            <select value={a.kind} onChange={(e) => setAsset(i, { kind: e.target.value as AssetKind })} className="input">
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
            <input className="input" placeholder="Name (e.g. Nifty 50 index fund)" value={a.name} maxLength={200}
              onChange={(e) => setAsset(i, { name: e.target.value })} />
            <NumInput value={a.value} onChange={(v) => setAsset(i, { value: v })} placeholder="Value ₹" />
            <button aria-label="Remove asset" onClick={() => setAssets(assets.filter((_, j) => j !== i))}
              className="flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-strong hover:text-down">✕</button>
          </div>
        ))}
      </section>

      <section className="card mt-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Liabilities</h2>
          <button onClick={() => setLiabs([...liabs, { name: "", principal: 0, interest_rate: 0.09, remaining_months: 12, monthly_emi: 0 }])}
            className="btn-secondary btn-sm">+ Add liability</button>
        </div>
        {liabs.length === 0 && <p className="text-sm text-muted">No liabilities.</p>}
        {liabs.map((l, i) => (
          <div key={i} className="grid items-center gap-3 border-t border-hairline pt-4 sm:grid-cols-3 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]">
            <input className="input" placeholder="Name (e.g. Car loan)" value={l.name} maxLength={200}
              onChange={(e) => setLiab(i, { name: e.target.value })} />
            <NumInput value={l.principal} onChange={(v) => setLiab(i, { principal: v })} placeholder="Outstanding ₹" />
            <NumInput value={Math.round(l.interest_rate * 1000) / 10} onChange={(v) => setLiab(i, { interest_rate: Math.min(v, 100) / 100 })} placeholder="Rate %" step="0.1" />
            <NumInput value={l.remaining_months} onChange={(v) => setLiab(i, { remaining_months: Math.min(Math.round(v), 600) })} placeholder="Months left" step="1" />
            <NumInput value={l.monthly_emi} onChange={(v) => setLiab(i, { monthly_emi: v })} placeholder="EMI ₹" />
            <button aria-label="Remove liability" onClick={() => setLiabs(liabs.filter((_, j) => j !== i))}
              className="flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-strong hover:text-down">✕</button>
          </div>
        ))}
      </section>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button onClick={save} disabled={saving} className="btn-primary btn-lg">
          {saving ? "Saving…" : `Save snapshot (v${nextVersion})`}
        </button>
        {notice && <span className="text-sm font-medium up">{notice}</span>}
        {error && <span role="alert" className="text-sm font-medium text-down">{error}</span>}
      </div>

      <section className="card mt-10">
        <h2 className="mb-4 text-lg font-semibold">Net-worth timeline</h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted">Save your first snapshot to start the timeline.</p>
        ) : (
          <>
            <NetWorthChart points={history} />
            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <thead className="text-left text-muted">
                  <tr>
                    <th className="py-2 font-medium">Version</th><th className="font-medium">Date</th>
                    <th className="text-right font-medium">Assets</th><th className="text-right font-medium">Liabilities</th>
                    <th className="text-right font-medium">Net worth</th>
                  </tr>
                </thead>
                <tbody>
                  {[...history].reverse().map((p) => (
                    <tr key={p.version_id} className="border-t border-hairline">
                      <td className="num py-3 text-ink">v{p.version_id}</td>
                      <td>{new Date(p.created_at).toLocaleDateString()}</td>
                      <td className="num text-right">{inr(p.total_assets)}</td>
                      <td className="num text-right">{inr(p.total_liabilities)}</td>
                      <td className="num text-right text-ink">{inr(p.net_worth)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

export default function TwinPage() {
  return (
    <RequireAuth>
      <TwinEditor />
    </RequireAuth>
  );
}
