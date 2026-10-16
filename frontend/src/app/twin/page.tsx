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

const field = "w-full rounded-lg bg-slate-800 px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500";
const label = "mb-1 block text-xs text-slate-400";

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

  if (loading) return <p className="p-6 text-slate-400">Loading your twin…</p>;

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">My financial twin</h1>
        <p className="text-sm text-slate-400">Every save creates a new snapshot, so you can track net worth over time.</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Total assets", inr(totalAssets), "text-blue-300"],
          ["Total liabilities", inr(totalLiabs), "text-red-300"],
          ["Net worth", inr(totalAssets - totalLiabs), "text-emerald-300"],
          ["Monthly surplus", `${surplus < 0 ? "-" : ""}${inr(Math.abs(surplus))}`, surplus < 0 ? "text-red-300" : "text-slate-100"],
        ].map(([k, v, c]) => (
          <div key={k} className="rounded-xl bg-slate-900 p-4">
            <div className="text-xs text-slate-400">{k}</div>
            <div className={`text-xl font-semibold ${c}`}>{v}</div>
          </div>
        ))}
      </div>

      <section className="grid gap-4 rounded-xl bg-slate-900 p-4 sm:grid-cols-4">
        <div><span className={label}>Monthly income (₹)</span><NumInput value={income} onChange={setIncome} /></div>
        <div><span className={label}>Monthly expenses (₹)</span><NumInput value={expenses} onChange={setExpenses} /></div>
        <div><span className={label}>Monthly SIP (₹)</span><NumInput value={sip} onChange={setSip} /></div>
        <div><span className={label}>Expected return (% / yr)</span><NumInput value={returnPct} onChange={setReturnPct} step="0.5" /></div>
      </section>

      <section className="space-y-3 rounded-xl bg-slate-900 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Assets</h2>
          <button onClick={() => setAssets([...assets, { kind: "cash", name: "", value: 0 }])}
            className="rounded-md bg-slate-800 px-3 py-1 text-sm hover:bg-slate-700">+ Add asset</button>
        </div>
        {assets.length === 0 && <p className="text-sm text-slate-500">No assets yet.</p>}
        {assets.map((a, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr_1fr_auto]">
            <select value={a.kind} onChange={(e) => setAsset(i, { kind: e.target.value as AssetKind })} className={field}>
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
            <input className={field} placeholder="Name (e.g. Nifty 50 index fund)" value={a.name} maxLength={200}
              onChange={(e) => setAsset(i, { name: e.target.value })} />
            <NumInput value={a.value} onChange={(v) => setAsset(i, { value: v })} placeholder="Value ₹" />
            <button aria-label="Remove asset" onClick={() => setAssets(assets.filter((_, j) => j !== i))}
              className="rounded-md px-3 text-slate-400 hover:text-red-400">✕</button>
          </div>
        ))}
      </section>

      <section className="space-y-3 rounded-xl bg-slate-900 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Liabilities</h2>
          <button onClick={() => setLiabs([...liabs, { name: "", principal: 0, interest_rate: 0.09, remaining_months: 12, monthly_emi: 0 }])}
            className="rounded-md bg-slate-800 px-3 py-1 text-sm hover:bg-slate-700">+ Add liability</button>
        </div>
        {liabs.length === 0 && <p className="text-sm text-slate-500">No liabilities.</p>}
        {liabs.map((l, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]">
            <input className={field} placeholder="Name (e.g. Car loan)" value={l.name} maxLength={200}
              onChange={(e) => setLiab(i, { name: e.target.value })} />
            <NumInput value={l.principal} onChange={(v) => setLiab(i, { principal: v })} placeholder="Outstanding ₹" />
            <NumInput value={Math.round(l.interest_rate * 1000) / 10} onChange={(v) => setLiab(i, { interest_rate: Math.min(v, 100) / 100 })} placeholder="Rate %" step="0.1" />
            <NumInput value={l.remaining_months} onChange={(v) => setLiab(i, { remaining_months: Math.min(Math.round(v), 600) })} placeholder="Months left" step="1" />
            <NumInput value={l.monthly_emi} onChange={(v) => setLiab(i, { monthly_emi: v })} placeholder="EMI ₹" />
            <button aria-label="Remove liability" onClick={() => setLiabs(liabs.filter((_, j) => j !== i))}
              className="rounded-md px-3 text-slate-400 hover:text-red-400">✕</button>
          </div>
        ))}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={save} disabled={saving}
          className="rounded-lg bg-emerald-500 px-5 py-2 font-medium text-slate-950 disabled:opacity-50">
          {saving ? "Saving…" : `Save snapshot (v${nextVersion})`}
        </button>
        {notice && <span className="text-sm text-emerald-300">{notice}</span>}
        {error && <span role="alert" className="text-sm text-red-400">{error}</span>}
      </div>

      <section className="rounded-xl bg-slate-900 p-4">
        <h2 className="mb-2 font-semibold">Net-worth timeline</h2>
        {history.length === 0 ? (
          <p className="text-sm text-slate-500">Save your first snapshot to start the timeline.</p>
        ) : (
          <>
            <NetWorthChart points={history} />
            <table className="mt-4 w-full text-sm">
              <thead className="text-left text-slate-400">
                <tr><th className="py-1">Version</th><th>Date</th><th className="text-right">Assets</th><th className="text-right">Liabilities</th><th className="text-right">Net worth</th></tr>
              </thead>
              <tbody>
                {[...history].reverse().map((p) => (
                  <tr key={p.version_id} className="border-t border-slate-800">
                    <td className="py-1">v{p.version_id}</td>
                    <td>{new Date(p.created_at).toLocaleDateString()}</td>
                    <td className="text-right">{inr(p.total_assets)}</td>
                    <td className="text-right">{inr(p.total_liabilities)}</td>
                    <td className="text-right font-medium">{inr(p.net_worth)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
