"use client";
import { useState } from "react";

export const DISCLAIMER = "This is AI-powered guidance, not professional financial advice.";

/** Shown once before the first session. Nothing is sent to the AI provider until the user accepts. */
export function ConsentCard({ busy, onAccept }: { busy: boolean; onAccept: (saveHistory: boolean) => void }) {
  const [save, setSave] = useState(false);
  return (
    <div className="mx-auto w-full max-w-lg rounded-3xl bg-white/5 p-6 text-left ring-1 ring-white/10 sm:p-8">
      <h2 className="text-2xl font-semibold text-white">Before we talk</h2>
      <ul className="mt-4 space-y-3 text-sm leading-relaxed text-white/80">
        <li><strong className="text-white">Your voice goes to Google.</strong> While we talk, your audio is streamed to Google&apos;s
          Gemini AI so it can listen and reply. WealthPilot does not record or store audio.</li>
        <li><strong className="text-white">What we keep.</strong> Only call length, language and counts (to run free limits).
          If you opt in below, we also keep an encrypted transcript and short summary of each chat.</li>
        <li><strong className="text-white">You&apos;re in control.</strong> Delete any conversation, or everything, from
          Past conversations at any time. That also withdraws this consent.</li>
        <li><strong className="text-white">Please don&apos;t say</strong> passwords, card numbers, OTPs or PINs.</li>
        <li>{DISCLAIMER} For big decisions about tax, loans or investments, please speak to a qualified professional.</li>
      </ul>
      <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl bg-white/5 p-4 text-sm text-white/90">
        <input type="checkbox" className="mt-0.5 h-5 w-5 accent-[#5b8def]" checked={save} onChange={(e) => setSave(e.target.checked)} />
        <span><strong>Remember our conversations</strong> (optional). Saves encrypted transcripts and summaries so I can say
          &ldquo;last time we talked about your emergency fund&hellip;&rdquo;.</span>
      </label>
      <button disabled={busy} onClick={() => onAccept(save)}
        className="mt-6 h-12 w-full rounded-full bg-white font-semibold text-[#0b1220] transition hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-60">
        {busy ? "Saving…" : "I understand, continue"}
      </button>
    </div>
  );
}
