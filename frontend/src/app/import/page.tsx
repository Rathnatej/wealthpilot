"use client";
import Link from "next/link";
import { useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { inr } from "@/components/WealthChart";
import { CasHolding, HoldingIn, errMsg, importHoldings, parseCas } from "@/services/api";

interface Row extends CasHolding { name: string; skip: boolean }
const ISIN_OK = /^INF[A-Z0-9]{9}$/;

function ImportView() {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ imported: number; net_worth: number } | null>(null);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setError("Choose your CAS PDF first.");
    setBusy(true); setError(""); setDone(null);
    try {
      const h = await parseCas(file, password || undefined);
      setRows(h.map((x) => ({ ...x, name: "", skip: false })));
      if (!h.length) setError("No mutual fund holdings were found in this file.");
    } catch (err) { setError(errMsg(err)); setRows([]); } finally { setBusy(false); }
  }

  const upd = (i: number, p: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const usable = (r: Row) => !r.skip && ISIN_OK.test(r.isin) && ((r.units && r.nav) || r.cost);
  const count = rows.filter(usable).length;
  const review = rows.filter((r) => r.needs_review && !r.skip).length;

  async function confirm() {
    setBusy(true); setError("");
    const payload: HoldingIn[] = rows.filter(usable).map((r) => ({
      isin: r.isin, folio: r.folio, name: r.name || null, units: r.units, nav: r.nav, cost: r.cost,
    }));
    try { setDone(await importHoldings(payload)); setRows([]); } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }

  const cell = "num h-9 w-24 rounded-md border border-hairline bg-canvas px-2 text-right text-sm text-ink";

  return (
    <main className="container-page py-12 sm:py-16">
      <header className="max-w-2xl">
        <span className="badge">Import</span>
        <h1 className="display mt-4 text-4xl sm:text-5xl">Bring in your mutual funds.</h1>
        <p className="mt-3 text-body">
          Upload your CAS PDF. Parsing can miss things, so you review every row before anything is saved.
          Importing replaces your previously imported funds, and your other assets stay untouched.
        </p>
      </header>

      <form onSubmit={upload} className="card mt-10 grid gap-4 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
        <div>
          <label className="label" htmlFor="cas">CAS PDF</label>
          <input id="cas" type="file" accept=".pdf,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-body file:mr-4 file:h-11 file:cursor-pointer file:rounded-pill file:border-0 file:bg-strong file:px-5 file:font-semibold file:text-ink" />
        </div>
        <div>
          <label className="label" htmlFor="caspw">PDF password</label>
          <input id="caspw" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
        </div>
        <button disabled={busy} className="btn-primary">{busy && !rows.length ? "Reading…" : "Read file"}</button>
        {error && <p role="alert" className="text-sm font-medium text-down sm:col-span-3">{error}</p>}
      </form>

      {done && (
        <div className="card mt-8 border-up/40">
          <h2 className="text-lg font-semibold up">Imported {done.imported} holdings</h2>
          <p className="mt-1 text-body">Your net worth is now <span className="num text-ink">{inr(done.net_worth)}</span>.</p>
          <Link href="/twin" className="btn-primary mt-4">View my twin</Link>
        </div>
      )}

      {rows.length > 0 && (
        <section className="card mt-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Review {rows.length} holdings</h2>
              <p className="text-sm text-body">
                {review > 0 ? <><span className="num text-warn">{review}</span> rows are highlighted because the parser was unsure. Fix the values or skip them.</> : "All rows look confident, but a quick check is still worthwhile."}
              </p>
            </div>
            <button onClick={confirm} disabled={busy || count === 0} className="btn-primary">{busy ? "Saving…" : `Import ${count} holdings`}</button>
          </div>

          <div className="mt-4 overflow-x-auto rounded-lg border border-hairline">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-soft text-left text-muted">
                <tr><th className="p-3">Skip</th><th>ISIN</th><th>Name (optional)</th><th>Units</th><th>NAV</th><th>Cost</th><th className="p-3 text-right">Value</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={`border-t border-hairline ${r.needs_review ? "bg-warn/10" : ""} ${r.skip ? "opacity-50" : ""}`}>
                    <td className="p-3"><input type="checkbox" aria-label="Skip row" className="h-4 w-4 accent-primary" checked={r.skip} onChange={(e) => upd(i, { skip: e.target.checked })} /></td>
                    <td className={`num ${ISIN_OK.test(r.isin) ? "text-ink" : "down"}`}>{r.isin}</td>
                    <td><input className="h-9 w-40 rounded-md border border-hairline bg-canvas px-2 text-sm text-ink" value={r.name} placeholder="Fund name" onChange={(e) => upd(i, { name: e.target.value })} /></td>
                    <td><input className={cell} inputMode="decimal" value={r.units ?? ""} onChange={(e) => upd(i, { units: num(e.target.value) })} /></td>
                    <td><input className={cell} inputMode="decimal" value={r.nav ?? ""} onChange={(e) => upd(i, { nav: num(e.target.value) })} /></td>
                    <td><input className={cell} inputMode="decimal" value={r.cost ?? ""} onChange={(e) => upd(i, { cost: num(e.target.value) })} /></td>
                    <td className="num p-3 text-right text-ink">{r.units && r.nav ? inr(r.units * r.nav) : r.cost ? `${inr(r.cost)} (cost)` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}

export default function ImportPage() {
  return <RequireAuth><ImportView /></RequireAuth>;
}
