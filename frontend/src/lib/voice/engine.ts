/** Real-time voice session against the Gemini Live API using a server-minted ephemeral token. */
import type { LiveConnectConfig, LiveServerMessage, Session } from "@google/genai";
import type { VoiceSessionStart } from "@/services/voiceApi";
import { AudioIO, b64ToBytes, bytesToB64 } from "./audio";

export type VoiceState = "connecting" | "listening" | "thinking" | "speaking" | "reconnecting" | "ended";
export interface Turn { role: "user" | "assistant"; text: string }
export type EndReason = "user_ended" | "idle" | "max_length" | "connection_lost" | "mic_lost" | "error";

export interface EngineEvents {
  onState(s: VoiceState): void;
  onCaptions(turns: Turn[]): void;
  onNotice(msg: string | null): void;
  onCrisis(): void;
  onEnd(reason: EndReason, errorCode: string | null): void;
}

const SPEECH_RMS = 0.012;          // mic energy that counts as "the user is talking"
const NUDGE_AFTER_MS = 25_000;     // quiet this long -> one soft "I'm here"
const MAX_NUDGES = 2;
const BACKOFF_MS = [500, 1000, 2000, 4000, 6000];
const NUDGE_TEXT =
  "(System note, never mention it: the person has been quiet for a while. Say ONE very short, gentle line in their " +
  "language, like 'Take your time, I'm here.' Do not ask a new question.)";
const GREET_TEXT = "(System note, never mention it: the person just opened the voice chat. Greet them as instructed.)";

const CRISIS_RE = new RegExp(
  [
    "kill myself", "suicid", "end my life", "want to die", "wanna die", "self[- ]?harm", "hurt myself", "no reason to live",
    "आत्महत्या", "मरना चाहता", "मरना चाहती", "जान दे", "ఆత్మహత్య", "చనిపోవాలి", "చచ్చిపోవాలి",
  ].join("|"), "i");

const SCRIPTS: [RegExp, string][] = [
  [/[\u0900-\u097F]/g, "hi"], [/[\u0C00-\u0C7F]/g, "te"], [/[\u0B80-\u0BFF]/g, "ta"], [/[\u0C80-\u0CFF]/g, "kn"],
  [/[\u0D00-\u0D7F]/g, "ml"], [/[\u0980-\u09FF]/g, "bn"], [/[\u0A80-\u0AFF]/g, "gu"], [/[\u0A00-\u0A7F]/g, "pa"],
  [/[A-Za-z]/g, "en"],
];
/** Script-based guess (Latin script counts as "en", so romanised Hindi shows as English; display only). */
export function detectLanguage(text: string): string | null {
  let best: [number, string] = [0, ""];
  for (const [re, code] of SCRIPTS) {
    const n = (text.match(re) ?? []).length;
    if (n > best[0]) best = [n, code];
  }
  return best[0] >= 2 ? best[1] : null;
}

export class VoiceEngine {
  private session: Session | null = null;
  private handle: string | null = null;
  private greeted = false;
  private closing = false;
  private ended = false;
  private connected = false;
  private muted = false;
  private state: VoiceState = "connecting";
  private turns: Turn[] = [];
  private startedAt = Date.now();
  private lastActivity = Date.now();
  private lastUserVoice = 0;
  private pendingReply = false;
  private nudges = 0;
  private warnedLength = false;
  private crisisFired = false;
  private tick: ReturnType<typeof setInterval> | null = null;
  language: string | null = null;
  reconnects = 0;

  constructor(
    private cfg: VoiceSessionStart,
    private audio: AudioIO,
    private callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>,
    private ev: EngineEvents,
  ) {}

  get transcript(): Turn[] { return this.turns; }

  async start(): Promise<void> {
    await this.connect();
    this.audio.onMic = (pcm, rms) => this.onMic(pcm, rms);
    this.audio.onMicLost(() => this.end("mic_lost"));
    this.audio.onPlaybackEnd = () => { this.lastActivity = Date.now(); };
    this.startedAt = Date.now();
    this.tick = setInterval(() => this.onTick(), 150);
  }

  // ------------------------------------------------------------------ connection
  private async connect(): Promise<void> {
    const { GoogleGenAI, Modality, EndSensitivity } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: this.cfg.token });
    const config: LiveConnectConfig = {
      responseModalities: [Modality.AUDIO],
      systemInstruction: this.cfg.system_instruction,
      tools: this.cfg.tools as LiveConnectConfig["tools"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.cfg.voice } } },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      sessionResumption: this.handle ? { handle: this.handle } : {},
      contextWindowCompression: { slidingWindow: {} },
      realtimeInputConfig: {
        // Give people room to think: wait ~0.9s of silence before treating a turn as finished.
        automaticActivityDetection: {
          endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW, prefixPaddingMs: 200, silenceDurationMs: 900,
        },
      },
    };
    this.session = await ai.live.connect({
      model: this.cfg.model,
      config,
      callbacks: {
        onopen: () => undefined,
        onmessage: (m: LiveServerMessage) => { void this.onMessage(m); },
        onerror: () => undefined, // onclose follows; we handle recovery there
        onclose: () => { this.connected = false; if (!this.closing) void this.reconnect(); },
      },
    });
    this.connected = true;
    if (!this.greeted) {
      this.greeted = true;
      this.safeSend(() => this.session?.sendRealtimeInput({ text: GREET_TEXT }));
    }
  }

  private async reconnect(): Promise<void> {
    if (this.ended || this.state === "reconnecting") return;
    this.audio.stopPlayback();
    this.setState("reconnecting");
    this.ev.onNotice("Connection dropped for a moment. Reconnecting, no need to do anything.");
    for (const wait of BACKOFF_MS) {
      await new Promise((r) => setTimeout(r, wait));
      if (this.ended) return;
      try {
        await this.connect();
        this.reconnects++;
        this.lastActivity = Date.now();
        this.ev.onNotice(null);
        this.setState("listening");
        return;
      } catch { /* try again */ }
    }
    this.end("connection_lost", "reconnect_failed");
  }

  private safeSend(fn: () => void) {
    try { fn(); } catch { /* socket closing: onclose will reconnect */ }
  }

  // ------------------------------------------------------------------ incoming
  private async onMessage(m: LiveServerMessage) {
    const upd = m.sessionResumptionUpdate;
    if (upd?.resumable && upd.newHandle) this.handle = upd.newHandle;
    if (m.goAway && !this.closing) {
      // Server will drop us soon (15-minute audio limit): hop to a fresh connection with our handle.
      this.safeSend(() => this.session?.close());
    }

    const sc = m.serverContent;
    if (sc) {
      if (sc.interrupted) {            // barge-in: stop talking immediately
        this.audio.stopPlayback();
        this.pendingReply = false;
      }
      if (sc.inputTranscription?.text) this.addText("user", sc.inputTranscription.text);
      if (sc.outputTranscription?.text) this.addText("assistant", sc.outputTranscription.text);
      for (const part of sc.modelTurn?.parts ?? []) {
        const data = part.inlineData?.data;
        if (data) {
          this.pendingReply = false;
          this.lastActivity = Date.now();
          this.audio.play(b64ToBytes(data));
        }
      }
      if (sc.turnComplete) this.pendingReply = false;
    }

    if (m.toolCall?.functionCalls?.length) {
      const calls = m.toolCall.functionCalls;
      const responses = await Promise.all(calls.map(async (c) => {
        let result: unknown;
        try { result = await this.callTool(c.name ?? "", (c.args ?? {}) as Record<string, unknown>); }
        catch { result = { error: "tool_failed", note: "Could not fetch that right now." }; }
        return { id: c.id, name: c.name, response: result as Record<string, unknown> };
      }));
      this.safeSend(() => this.session?.sendToolResponse({ functionResponses: responses }));
    }
  }

  private addText(role: Turn["role"], text: string) {
    this.lastActivity = Date.now();
    const last = this.turns[this.turns.length - 1];
    if (last && last.role === role) last.text += text;
    else this.turns.push({ role, text });
    if (role === "user") {
      const lang = detectLanguage(text);
      if (lang) this.language = lang;
      const cur = this.turns[this.turns.length - 1].text;
      if (!this.crisisFired && CRISIS_RE.test(cur)) { this.crisisFired = true; this.ev.onCrisis(); }
    }
    this.ev.onCaptions(this.turns.map((t) => ({ ...t })));
  }

  // ------------------------------------------------------------------ mic
  private onMic(pcm: ArrayBuffer, rms: number) {
    if (this.muted || !this.connected || this.ended) return;
    // Ignore energy while the assistant is talking so its own voice (echo) isn't mistaken for the user.
    if (!this.audio.playing && rms > SPEECH_RMS) {
      this.lastUserVoice = Date.now();
      this.lastActivity = this.lastUserVoice;
      this.pendingReply = true;
      this.nudges = 0;
    }
    this.safeSend(() => this.session?.sendRealtimeInput({
      audio: { data: bytesToB64(pcm), mimeType: "audio/pcm;rate=16000" },
    }));
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (m) this.safeSend(() => this.session?.sendRealtimeInput({ audioStreamEnd: true }));
  }

  // ------------------------------------------------------------------ timers / state
  private setState(s: VoiceState) {
    if (s !== this.state) { this.state = s; this.ev.onState(s); }
  }

  private onTick() {
    if (this.ended || this.state === "reconnecting") return;
    const now = Date.now();
    if (this.pendingReply && now - this.lastUserVoice > 20_000) this.pendingReply = false;

    if (this.audio.playing) this.setState("speaking");
    else if (!this.muted && now - this.lastUserVoice < 500) this.setState("listening");
    else if (this.pendingReply && now - this.lastUserVoice > 700) this.setState("thinking");
    else this.setState("listening");

    const elapsed = now - this.startedAt;
    const maxMs = this.cfg.max_session_seconds * 1000;
    if (!this.warnedLength && elapsed > maxMs - 60_000) {
      this.warnedLength = true;
      this.ev.onNotice("We're almost at the time limit for this session. You can start a new one anytime.");
    }
    if (elapsed > maxMs) return this.end("max_length");

    const idle = now - this.lastActivity;
    if (idle > this.cfg.idle_timeout_seconds * 1000) return this.end("idle");
    if (this.state === "listening" && !this.muted && idle > NUDGE_AFTER_MS && this.nudges < MAX_NUDGES) {
      this.nudges++;
      this.lastActivity = now;
      this.safeSend(() => this.session?.sendRealtimeInput({ text: NUDGE_TEXT }));
    }
  }

  // ------------------------------------------------------------------ teardown
  end(reason: EndReason, errorCode: string | null = null) {
    if (this.ended) return;
    this.ended = true;
    this.closing = true;
    if (this.tick) clearInterval(this.tick);
    try { this.session?.close(); } catch { /* ignore */ }
    void this.audio.close();
    this.setState("ended");
    this.ev.onEnd(reason, errorCode);
  }
}
