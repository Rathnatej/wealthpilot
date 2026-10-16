"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Explain } from "@/components/Explain";
import { RequireAuth } from "@/components/RequireAuth";
import { WealthChart, inr } from "@/components/WealthChart";
import { CopilotResult, copilot, errMsg } from "@/services/api";

type Msg =
  | { role: "user"; text: string }
  | { role: "bot"; text: string; result?: CopilotResult; error?: boolean };

const SUGGESTIONS = [
  "What if I take a ₹10 lakh loan for 5 years at 10%?",
  "What if I increase my SIP by ₹5,000?",
  "What if I invest a lump sum of ₹2 lakh today?",
  "What if I add a ₹15,000 EMI for 4 years?",
];

function ChatView() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, busy]);

  async function send(text: string) {
    const t = text.trim();
    if (t.length < 3 || busy) return;
    setQ("");
    setMsgs((m) => [...m, { role: "user", text: t }]);
    setBusy(true);
    try {
      const r = await copilot(t);
      if (r.refused || !r.scenario) {
        setMsgs((m) => [...m, { role: "bot", text: r.message || "I can only help with educational what-if scenarios." }]);
      } else {
        setMsgs((m) => [...m, { role: "bot", text: r.explanation, result: r }]);
      }
    } catch (e) {
      setMsgs((m) => [...m, { role: "bot", text: errMsg(e, "The assistant is unavailable right now."), error: true }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container-page flex min-h-[calc(100vh-64px)] flex-col py-8 sm:py-12">
      <header className="max-w-2xl">
        <span className="badge">Copilot</span>
        <h1 className="display mt-4 text-4xl sm:text-5xl">Ask a what-if.</h1>
        <p className="mt-3 text-body">
          Describe a money decision in plain words. The numbers come from the calculation engine using your saved twin
          (<Link href="/twin" className="btn-text">set it up</Link>). I won&apos;t tell you what to buy or sell.
        </p>
      </header>

      <div className="mt-8 flex-1 space-y-6">
        {msgs.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => send(s)} className="btn-secondary btn-sm !h-auto !whitespace-normal py-2 text-left">{s}</button>
            ))}
          </div>
        )}

        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[85%] rounded-xl rounded-br-sm bg-primary px-4 py-3 text-white dark:text-dark">{m.text}</p>
            </div>
          ) : (
            <div key={i} className="max-w-3xl space-y-4">
              {m.result?.simulation ? (
                <>
                  <Explain text={m.text} source={m.result.source} title="Here's what changes" />
                  <div className="card !p-4 sm:!p-6">
                    <WealthChart data={m.result.simulation} />
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {[m.result.simulation.baseline, ...m.result.simulation.scenarios].map((r) => (
                        <div key={r.name} className="rounded-lg bg-soft p-4">
                          <div className="text-sm text-body">{r.name}</div>
                          <div className="num mt-1 text-xl text-ink">{inr(r.final_corpus)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {m.result.assumptions.length > 0 && (
                    <div className="text-xs text-muted">
                      <p className="font-semibold text-body">Assumptions used</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5">{m.result.assumptions.map((a, j) => <li key={j}>{a}</li>)}</ul>
                    </div>
                  )}
                </>
              ) : (
                <p className={`rounded-xl rounded-bl-sm bg-soft px-4 py-3 ${m.error ? "text-down" : "text-ink"}`}>{m.text}</p>
              )}
            </div>
          ),
        )}
        {busy && <p className="text-sm text-muted">Working it out…</p>}
        <div ref={end} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); send(q); }}
        className="sticky bottom-0 mt-6 flex gap-3 bg-canvas/90 py-3 backdrop-blur">
        <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} aria-label="Your question"
          placeholder="e.g. What if I take a ₹8 lakh loan for 3 years?" className="input flex-1" />
        <button disabled={busy || q.trim().length < 3} className="btn-primary">Ask</button>
      </form>
    </main>
  );
}

export default function ChatPage() {
  return <RequireAuth><ChatView /></RequireAuth>;
}
