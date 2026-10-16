"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { ConsentCard, DISCLAIMER } from "@/components/voice/ConsentCard";
import { Orb } from "@/components/voice/Orb";
import { UpgradePrompt } from "@/components/voice/UpgradePrompt";
import { AudioIO, MicFailure, voiceSupported } from "@/lib/voice/audio";
import { EndReason, Turn, VoiceEngine, VoiceState } from "@/lib/voice/engine";
import { getToken } from "@/services/api";
import {
  VoiceApiError, VoiceConfig, VoiceSessionStart, VoiceSummary, voiceConfig, voiceConsent, voiceEnd,
  voiceEndBeacon, voiceStart, voiceTool,
} from "@/services/voiceApi";

type Phase = "loading" | "blocked" | "consent" | "ready" | "live" | "done";

const STATUS: Record<VoiceState, string> = {
  connecting: "Connecting…", listening: "I'm listening", thinking: "Thinking…", speaking: "Speaking",
  reconnecting: "Reconnecting…", ended: "Ended",
};
const END_MESSAGE: Record<EndReason, string> = {
  user_ended: "Thank you for talking with me.",
  idle: "We paused after a quiet while. I'm here whenever you want to continue.",
  max_length: "We reached the time limit for this session. You can start a new one any time.",
  connection_lost: "I couldn't reconnect. Your connection may be unstable. Please try again in a moment.",
  mic_lost: "I lost your microphone. Please check it's connected and allowed, then try again.",
  error: "Something interrupted our conversation. Please try again in a moment.",
};
const MIC_HELP: Record<string, string> = {
  denied: "Microphone access is blocked. Click the lock icon in your browser's address bar, allow the microphone, then try again.",
  no_device: "I couldn't find a microphone. Plug one in (or check your system settings) and try again.",
  unsupported: "This browser can't do live voice. Chrome, Edge or Safari 14.1+ work best.",
  failed: "I couldn't start your microphone. Please try again.",
};

const CRISIS_TEXT = (
  <>
    If you&apos;re thinking about harming yourself or you feel unsafe, please reach out right now to someone you trust.
    In India, <strong>Tele-MANAS 14416</strong> (free, 24x7) can talk with you, and <strong>112</strong> is the emergency number.
    Elsewhere, please contact your local emergency number or helpline. You&apos;re not alone.
  </>
);

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const ICON = {
  mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM19 11a7 7 0 0 1-14 0M12 18v3",
  micOff: "M3 3l18 18M9 9v3a3 3 0 0 0 5 2.2M15 9.3V6a3 3 0 0 0-5.9-.8M19 11a7 7 0 0 1-1 3.6M5 11a7 7 0 0 0 10 6.3M12 18v3",
  cc: "M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM10 10.5a2 2 0 1 0 0 3M17 10.5a2 2 0 1 0 0 3",
  end: "M18 6L6 18M6 6l12 12",
};

const roundBtn =
  "flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

function VoiceView() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [cfg, setCfg] = useState<VoiceConfig | null>(null);
  const [blocked, setBlocked] = useState<{ kind: "upgrade" | "msg"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [voice, setVoice] = useState("");
  const [vstate, setVstate] = useState<VoiceState | "idle">("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [muted, setMuted] = useState(false);
  const [captions, setCaptions] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [crisis, setCrisis] = useState(false);
  const [result, setResult] = useState<{ reason: EndReason; summary: VoiceSummary | null; saved: boolean } | null>(null);

  const engineRef = useRef<VoiceEngine | null>(null);
  const audioRef = useRef<AudioIO | null>(null);
  const sessRef = useRef<VoiceSessionStart | null>(null);
  const finishedRef = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);

  const getLevels = useCallback(() => audioRef.current?.levels() ?? { mic: 0, out: 0 }, []);

  // Load config; warm up the SDK so the first connect is quick.
  useEffect(() => {
    setCaptions(window.localStorage.getItem("wp_voice_captions") === "1");
    if (!voiceSupported()) {
      setBlocked({ kind: "msg", text: MIC_HELP.unsupported });
      setPhase("blocked");
      return;
    }
    void import("@google/genai");
    voiceConfig().then((c) => {
      setCfg(c);
      setVoice(c.voice);
      if (c.reason === "upgrade_required") { setBlocked({ kind: "upgrade", text: "" }); setPhase("blocked"); }
      else if (!c.allowed) { setBlocked({ kind: "msg", text: "The voice assistant is switched off right now." }); setPhase("blocked"); }
      else if (!c.available) { setBlocked({ kind: "msg", text: "Voice is temporarily unavailable. The text chat still works." }); setPhase("blocked"); }
      else setPhase(c.consented ? "ready" : "consent");
    }).catch(() => { setBlocked({ kind: "msg", text: "We couldn't load the voice assistant. Please try again in a moment." }); setPhase("blocked"); });
  }, []);

  // Leave cleanly if the page is closed or navigated away mid-call.
  useEffect(() => {
    const onHide = () => {
      const e = engineRef.current, s = sessRef.current;
      if (e && s && !finishedRef.current) {
        finishedRef.current = true;
        voiceEndBeacon(s.session_id, { language: e.language, end_reason: "user_ended", reconnects: e.reconnects, transcript: e.transcript }, getToken());
      }
    };
    window.addEventListener("pagehide", onHide);
    return () => { window.removeEventListener("pagehide", onHide); engineRef.current?.end("user_ended"); };
  }, []);

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" }); }, [turns]);

  async function finish(reason: EndReason, code: string | null) {
    const e = engineRef.current, s = sessRef.current;
    if (!e || !s || finishedRef.current) return;
    finishedRef.current = true;
    setPhase("done");
    setNotice(null);
    let summary: VoiceSummary | null = null;
    try {
      const r = await voiceEnd(s.session_id, {
        language: e.language, end_reason: reason, error_code: code, reconnects: e.reconnects, transcript: e.transcript,
      });
      summary = r.summary;
    } catch { /* the session still ends locally; the server will close it out */ }
    setResult({ reason, summary, saved: s.save_history });
    voiceConfig().then(setCfg).catch(() => undefined);
  }

  async function accept(save: boolean) {
    setBusy(true);
    try { await voiceConsent(save, voice || undefined); setCfg((c) => (c ? { ...c, consented: true, save_history: save } : c)); setPhase("ready"); }
    catch { setStartError("We couldn't save that just now. Please try again."); }
    setBusy(false);
  }

  async function begin() {
    if (busy) return;
    setBusy(true); setMicError(null); setStartError(null);
    let audio: AudioIO | null = null;
    try {
      audio = new AudioIO();           // created inside the click so iOS allows audio
      await audio.startMic();          // the browser's microphone prompt appears here
    } catch (e) {
      void audio?.close();
      setMicError(MIC_HELP[e instanceof MicFailure ? e.kind : "failed"]);
      setBusy(false);
      return;
    }
    let s: VoiceSessionStart | null = null;
    try {
      s = await voiceStart(voice || undefined);
      sessRef.current = s; audioRef.current = audio; finishedRef.current = false;
      setTurns([]); setMuted(false); setCrisis(false); setNotice(null); setResult(null); setVstate("connecting");
      const engine = new VoiceEngine(s, audio, (n, a) => voiceTool(s!.session_id, n, a), {
        onState: setVstate, onCaptions: setTurns, onNotice: setNotice, onCrisis: () => setCrisis(true),
        onEnd: (r, c) => { void finish(r, c); },
      });
      engineRef.current = engine;
      setPhase("live");
      await engine.start();
    } catch (e) {
      void audio.close();
      engineRef.current = null;
      if (s) {  // we got a session but couldn't connect: close it out so no minutes are held
        finishedRef.current = true;
        void voiceEnd(s.session_id, { end_reason: "error", error_code: "connect_failed", reconnects: 0, transcript: [] }).catch(() => undefined);
      }
      setPhase(cfg?.consented ? "ready" : "consent");
      if (e instanceof VoiceApiError) {
        if (e.code === "upgrade_required") { setBlocked({ kind: "upgrade", text: "" }); setPhase("blocked"); }
        else if (e.code === "consent_required") setPhase("consent");
        else setStartError(e.message);
      } else setStartError("I couldn't connect just now. Please try again in a moment.");
    }
    setBusy(false);
  }

  const toggleMute = () => { const m = !muted; setMuted(m); engineRef.current?.setMuted(m); };
  const toggleCaptions = () => {
    const c = !captions; setCaptions(c); window.localStorage.setItem("wp_voice_captions", c ? "1" : "0");
  };
  const dailyLeft = cfg?.usage.daily_left;
  const noMinutes = !!cfg && !cfg.usage.unlimited && ((dailyLeft ?? 0) < 1 || (cfg.usage.monthly_left ?? 0) < 1);

  return (
    <main className="relative min-h-[calc(100vh-4rem)] bg-gradient-to-b from-[#0b1220] via-[#101a33] to-[#0b1220] text-white">
      <link rel="preconnect" href="https://generativelanguage.googleapis.com" />
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-3xl flex-col items-center px-4 py-8 sm:py-12">

        {crisis && (
          <div role="alert" className="mb-4 w-full rounded-2xl bg-[#3b2a1a] p-4 text-sm leading-relaxed text-[#ffe3c2] ring-1 ring-[#f4b000]/40">
            {CRISIS_TEXT}
          </div>
        )}

        {phase === "loading" && <p className="my-auto text-white/70" role="status">Getting things ready…</p>}

        {phase === "blocked" && (
          <div className="my-auto w-full text-center">
            {blocked?.kind === "upgrade" ? <UpgradePrompt /> : (
              <div className="mx-auto max-w-md rounded-3xl bg-white/5 p-8 ring-1 ring-white/10">
                <p className="text-lg text-white/90">{blocked?.text}</p>
                <Link href="/chat" className="mt-6 inline-flex h-12 items-center rounded-full bg-white px-8 font-semibold text-[#0b1220]">Use the text chat instead</Link>
              </div>
            )}
          </div>
        )}

        {phase === "consent" && <div className="my-auto w-full"><ConsentCard busy={busy} onAccept={accept} />
          {startError && <p role="alert" className="mt-4 text-center text-sm text-[#ffb4a8]">{startError}</p>}</div>}

        {phase === "ready" && cfg && (
          <div className="my-auto flex w-full flex-col items-center text-center">
            <Orb state="idle" getLevels={getLevels} />
            <h1 className="mt-4 text-3xl font-light tracking-tight sm:text-4xl">Talk to your assistant</h1>
            <p className="mt-3 max-w-md text-white/70">A calm, private space to talk through your money, in your own language.
              Just start speaking when you&apos;re ready.</p>

            {noMinutes ? (
              <p role="status" className="mt-6 max-w-md rounded-2xl bg-white/5 p-4 text-white/85">
                You&apos;ve used your free voice minutes for now. They refresh tomorrow. The text chat is always available.
              </p>
            ) : (
              <>
                <button onClick={begin} disabled={busy}
                  className="mt-8 h-14 rounded-full bg-white px-10 text-lg font-semibold text-[#0b1220] shadow-lg transition hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white disabled:opacity-60">
                  {busy ? "Starting…" : "Start talking"}
                </button>
                <p className="mt-3 max-w-sm text-xs text-white/60">Your browser will ask to use your microphone. I only listen while
                  this screen is open.</p>
              </>
            )}

            <div className="mt-8 flex flex-wrap items-center justify-center gap-4 text-sm text-white/80">
              <label className="flex items-center gap-2">Voice
                <select value={voice} onChange={(e) => { setVoice(e.target.value); void voiceConsent(cfg.save_history, e.target.value); }}
                  className="h-9 rounded-full border-0 bg-white/10 px-3 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
                  {Object.entries(cfg.voices).map(([k, d]) => <option key={k} value={k} className="text-black">{k} · {d}</option>)}
                </select>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" className="h-4 w-4 accent-[#5b8def]" checked={cfg.save_history}
                  onChange={(e) => { void voiceConsent(e.target.checked, voice).then(() => setCfg({ ...cfg, save_history: e.target.checked })); }} />
                Remember our conversations
              </label>
            </div>
            {!cfg.usage.unlimited && <p className="mt-3 text-xs text-white/55">{Math.floor(dailyLeft ?? 0)} of {cfg.limits.daily_minutes} free minutes left today</p>}

            {(micError || startError) && <p role="alert" className="mt-5 max-w-md rounded-2xl bg-[#3a1d1d] p-4 text-sm text-[#ffd0c8]">{micError ?? startError}</p>}
            {micError && <Link href="/chat" className="mt-3 text-sm text-white/80 underline">Use the text chat instead</Link>}
            <nav className="mt-8 flex gap-6 text-sm text-white/70">
              <Link href="/voice/history" className="underline">Past conversations</Link>
              <Link href="/chat" className="underline">Prefer typing?</Link>
            </nav>
          </div>
        )}

        {phase === "live" && (
          <div className="flex w-full flex-1 flex-col items-center">
            <div className="flex flex-1 flex-col items-center justify-center">
              <Orb state={vstate} getLevels={getLevels} />
              <p role="status" aria-live="polite" className="mt-2 text-lg font-light tracking-wide text-white/90">
                {muted && vstate === "listening" ? "Muted" : vstate === "idle" ? "" : STATUS[vstate]}
              </p>
              {notice && <p role="status" className="mt-3 max-w-sm rounded-full bg-white/10 px-4 py-2 text-center text-sm text-white/85">{notice}</p>}
            </div>

            {captions && (
              <div ref={logRef} role="log" aria-label="Live captions" aria-live="off" tabIndex={0}
                className="mb-4 max-h-40 w-full max-w-xl space-y-2 overflow-y-auto rounded-2xl bg-black/25 p-4 text-left text-sm leading-relaxed focus-visible:outline focus-visible:outline-2 focus-visible:outline-white sm:max-h-52 sm:text-base">
                {turns.length === 0 && <p className="text-white/50">Captions will appear here.</p>}
                {turns.slice(-8).map((t, i) => (
                  <p key={i} className={t.role === "user" ? "text-white/60" : "text-white"}>
                    <span className="sr-only">{t.role === "user" ? "You: " : "Assistant: "}</span>{t.text}
                  </p>
                ))}
              </div>
            )}

            <div className="flex items-center gap-5 pb-2">
              <button onClick={toggleMute} aria-pressed={muted} aria-label={muted ? "Unmute microphone" : "Mute microphone"} className={roundBtn + (muted ? " !bg-white !text-[#0b1220]" : "")}>
                <Icon d={muted ? ICON.micOff : ICON.mic} />
              </button>
              <button onClick={toggleCaptions} aria-pressed={captions} aria-label={captions ? "Hide live captions" : "Show live captions"} className={roundBtn + (captions ? " !bg-white !text-[#0b1220]" : "")}>
                <Icon d={ICON.cc} />
              </button>
              <button onClick={() => engineRef.current?.end("user_ended")} aria-label="End conversation" className="flex h-14 w-14 items-center justify-center rounded-full bg-[#d94b4b] text-white transition hover:bg-[#e25d5d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                <Icon d={ICON.end} />
              </button>
            </div>
          </div>
        )}

        {phase === "done" && (
          <div className="my-auto w-full max-w-lg text-center">
            <Orb state="ended" getLevels={getLevels} />
            <p className="mt-2 text-xl font-light">{result ? END_MESSAGE[result.reason] : "Wrapping up…"}</p>
            {result?.summary?.summary && (
              <div className="mt-6 rounded-3xl bg-white/5 p-5 text-left ring-1 ring-white/10">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-white/60">Summary</h2>
                <p className="mt-2 text-white/90">{result.summary.summary}</p>
                {result.summary.action_items.length > 0 && (
                  <>
                    <h3 className="mt-4 text-sm font-semibold uppercase tracking-wide text-white/60">Small next steps</h3>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-white/90">{result.summary.action_items.map((a, i) => <li key={i}>{a}</li>)}</ul>
                  </>
                )}
              </div>
            )}
            {result && !result.saved && <p className="mt-4 text-xs text-white/55">This conversation wasn&apos;t saved. You can turn on history before your next chat.</p>}
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <button onClick={() => { setPhase("ready"); setVstate("idle"); }} className="h-12 rounded-full bg-white px-8 font-semibold text-[#0b1220] hover:bg-white/90">Talk again</button>
              <Link href="/voice/history" className="inline-flex h-12 items-center rounded-full bg-white/10 px-8 font-semibold hover:bg-white/20">Past conversations</Link>
            </div>
          </div>
        )}

        <p className="mt-8 text-center text-xs text-white/50">{DISCLAIMER}</p>
      </div>
    </main>
  );
}

export default function VoicePage() {
  return <RequireAuth><VoiceView /></RequireAuth>;
}
