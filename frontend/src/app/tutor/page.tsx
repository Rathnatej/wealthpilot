"use client";
import { useState } from "react";
import { Explain } from "@/components/Explain";
import { RequireAuth } from "@/components/RequireAuth";
import { TutorTerm, errMsg, tutor } from "@/services/api";

const TERMS: { id: TutorTerm; title: string; blurb: string }[] = [
  { id: "compounding", title: "Compounding", blurb: "Why time matters more than amount." },
  { id: "sip_step_up", title: "Step-up SIP", blurb: "Raising your SIP as your income grows." },
  { id: "inflation", title: "Inflation", blurb: "What your money buys, later." },
  { id: "emergency_fund", title: "Emergency fund", blurb: "How much cash is enough." },
  { id: "expense_ratio", title: "Expense ratio", blurb: "The fee fund houses charge." },
  { id: "xirr", title: "XIRR", blurb: "Your real return on irregular investments." },
];

type Lesson = { definition: string; explanation: string; source: "ai" | "template" };

function TutorView() {
  const [active, setActive] = useState<TutorTerm | null>(null);
  const [lessons, setLessons] = useState<Partial<Record<TutorTerm, Lesson>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function open(t: TutorTerm) {
    setActive(t); setError("");
    if (lessons[t]) return;
    setBusy(true);
    try {
      const r = await tutor(t);
      setLessons((p) => ({ ...p, [t]: { definition: r.definition, explanation: r.explanation, source: r.source } }));
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  const lesson = active ? lessons[active] : undefined;
  const term = TERMS.find((t) => t.id === active);

  return (
    <main className="container-page py-12 sm:py-16">
      <header className="max-w-2xl">
        <span className="badge">Learn</span>
        <h1 className="display mt-4 text-4xl sm:text-5xl">Money terms, with your own numbers.</h1>
        <p className="mt-3 text-body">Short lessons that use your saved twin, so the examples are about you. If you haven&apos;t saved one, sample numbers are used and the lesson says so.</p>
      </header>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TERMS.map((t) => (
          <button key={t.id} onClick={() => open(t.id)} aria-pressed={active === t.id}
            className={`card card-hover text-left !p-6 ${active === t.id ? "!border-primary" : ""}`}>
            <div className="font-semibold text-ink">{t.title}</div>
            <div className="mt-1 text-sm text-body">{t.blurb}</div>
          </button>
        ))}
      </div>

      {active && (
        <section className="card mt-8">
          <h2 className="display text-2xl sm:text-3xl">{term?.title}</h2>
          {busy && <p className="mt-4 text-body">Preparing your lesson…</p>}
          {error && <p role="alert" className="mt-4 text-down">{error}</p>}
          {lesson && (
            <div className="mt-4 space-y-4">
              <p className="text-ink">{lesson.definition}</p>
              <Explain text={lesson.explanation} source={lesson.source} title="With your numbers" />
            </div>
          )}
        </section>
      )}
    </main>
  );
}

export default function TutorPage() {
  return <RequireAuth><TutorView /></RequireAuth>;
}
