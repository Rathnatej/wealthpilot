"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { DISCLAIMER } from "@/components/voice/ConsentCard";
import {
  VoiceHistoryItem, voiceDeleteAll, voiceDeleteSession, voiceSessionDetail, voiceSessions,
} from "@/services/voiceApi";

const LANG: Record<string, string> = { en: "English", hi: "Hindi", te: "Telugu", ta: "Tamil", kn: "Kannada", ml: "Malayalam", bn: "Bengali", gu: "Gujarati", pa: "Punjabi" };
const mins = (s: number) => (s < 60 ? `${s}s` : `${Math.round(s / 60)} min`);

function HistoryView() {
  const [items, setItems] = useState<VoiceHistoryItem[] | null>(null);
  const [open, setOpen] = useState<VoiceHistoryItem | null>(null);
  const [error, setError] = useState("");

  const load = () => voiceSessions().then(setItems).catch(() => setError("We couldn't load your conversations. Please try again."));
  useEffect(() => { void load(); }, []);

  async function show(id: number) {
    if (open?.id === id) return setOpen(null);
    try { setOpen(await voiceSessionDetail(id)); } catch { setError("We couldn't open that conversation."); }
  }
  async function remove(id: number) {
    if (!window.confirm("Delete this conversation permanently?")) return;
    try { await voiceDeleteSession(id); setOpen(null); await load(); } catch { setError("We couldn't delete that. Please try again."); }
  }
  async function removeAll() {
    if (!window.confirm("Delete ALL voice conversations and withdraw your voice consent? This can't be undone.")) return;
    try { await voiceDeleteAll(); setOpen(null); await load(); } catch { setError("We couldn't delete your data. Please try again."); }
  }

  return (
    <main className="container-page py-12 sm:py-16">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <span className="badge">Voice assistant</span>
          <h1 className="display mt-4 text-4xl sm:text-5xl">Past conversations</h1>
          <p className="mt-3 text-body">Only chats saved with your permission appear here, stored encrypted. You can delete any of them, or everything, at any time.</p>
        </div>
        <Link href="/voice" className="btn-primary">New conversation</Link>
      </header>

      {error && <p role="alert" className="mt-6 text-sm font-medium text-down">{error}</p>}
      {items === null && !error && <p className="mt-10 text-body">Loading…</p>}
      {items?.length === 0 && (
        <div className="card mt-10 text-body">
          Nothing saved yet. Turn on &ldquo;Remember our conversations&rdquo; before your next voice chat and a summary will show up here.
        </div>
      )}

      <ul className="mt-8 space-y-4">
        {items?.map((it) => (
          <li key={it.id} className="card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm text-muted">
                  {new Date(it.started_at + "Z").toLocaleString()} · {mins(it.duration_seconds)}
                  {it.language && ` · ${LANG[it.language] ?? it.language}`}
                </p>
                <p className="mt-2 text-ink">{it.summary?.summary || (it.has_transcript ? "Conversation saved." : "This conversation wasn't saved.")}</p>
              </div>
              <div className="flex gap-2">
                {it.has_transcript && <button className="btn-outline btn-sm" onClick={() => show(it.id)} aria-expanded={open?.id === it.id}>{open?.id === it.id ? "Hide" : "View"}</button>}
                <button className="btn-outline btn-sm" onClick={() => remove(it.id)} aria-label="Delete conversation">Delete</button>
              </div>
            </div>
            {it.summary && (it.summary.key_advice.length > 0 || it.summary.action_items.length > 0) && (
              <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
                {it.summary.key_advice.length > 0 && <div><p className="label">Key advice</p><ul className="list-disc space-y-1 pl-5 text-body">{it.summary.key_advice.map((a, i) => <li key={i}>{a}</li>)}</ul></div>}
                {it.summary.action_items.length > 0 && <div><p className="label">Next steps</p><ul className="list-disc space-y-1 pl-5 text-body">{it.summary.action_items.map((a, i) => <li key={i}>{a}</li>)}</ul></div>}
              </div>
            )}
            {open?.id === it.id && (
              <div className="mt-4 max-h-80 space-y-2 overflow-y-auto rounded-lg bg-soft p-4 text-sm">
                {(open.transcript ?? []).map((t, i) => (
                  <p key={i} className={t.role === "user" ? "text-body" : "text-ink"}><strong>{t.role === "user" ? "You" : "Assistant"}:</strong> {t.text}</p>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-hairline pt-6">
        <p className="text-xs text-muted">{DISCLAIMER}</p>
        <button onClick={removeAll} className="btn-outline btn-sm">Delete all voice data</button>
      </div>
    </main>
  );
}

export default function HistoryPage() {
  return <RequireAuth><HistoryView /></RequireAuth>;
}
