"use client";

/** Shows the plain-language explanation under a result, labelled by how it was written. */
export function Explain({ text, source, title = "In plain words" }: {
  text: string; source?: "ai" | "template"; title?: string;
}) {
  if (!text) return null;
  return (
    <div className="rounded-lg bg-soft p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-ink">{title}</h4>
        {source && (
          <span className="badge normal-case" title={source === "ai"
            ? "Wording by AI. Every number in it is checked against the engine's output."
            : "Written from a fixed template using the engine's numbers."}>
            {source === "ai" ? "AI wording" : "Calculated"}
          </span>
        )}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-body">{text}</p>
      <p className="mt-2 text-xs text-muted">All figures come from the calculation engine. Educational only, not advice.</p>
    </div>
  );
}

export function Stat({ label, value, tone, sub }: { label: string; value: string; tone?: "up" | "down"; sub?: string }) {
  return (
    <div className="rounded-lg bg-soft p-4">
      <div className="text-sm text-body">{label}</div>
      <div className={`num mt-1 text-2xl ${tone ?? "text-ink"}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}
