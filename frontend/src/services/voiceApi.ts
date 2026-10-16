import axios from "axios";
import { api } from "@/services/api";

export interface VoiceConfig {
  enabled: boolean;
  allowed: boolean;
  reason: "disabled" | "upgrade_required" | null;
  plan: "free" | "pro";
  voices: Record<string, string>;
  default_voice: string;
  voice: string;
  consented: boolean;
  save_history: boolean;
  available: boolean;
  limits: { daily_minutes: number; monthly_minutes: number; max_session_seconds: number; idle_timeout_seconds: number };
  usage: { used: { today: number; month: number }; unlimited: boolean; daily_left: number | null; monthly_left: number | null };
}

export interface VoiceSessionStart {
  session_id: number;
  token: string;
  model: string;
  voice: string;
  system_instruction: string;
  tools: unknown[];
  max_session_seconds: number;
  idle_timeout_seconds: number;
  save_history: boolean;
}

export interface VoiceSummary { summary: string; key_advice: string[]; action_items: string[] }
export interface VoiceHistoryItem {
  id: number; started_at: string; duration_seconds: number; language: string | null; voice: string;
  summary: VoiceSummary | null; has_transcript: boolean; transcript?: { role: "user" | "assistant"; text: string }[];
}

export type VoiceErrorCode =
  | "disabled" | "upgrade_required" | "consent_required" | "rate_limited" | "limit_reached" | "unavailable" | "unknown";

/** Calm, user-facing error with a machine code the UI can branch on. */
export class VoiceApiError extends Error {
  constructor(public code: VoiceErrorCode, message: string) { super(message); }
}

export function toVoiceError(e: unknown): VoiceApiError {
  if (axios.isAxiosError(e) && e.response) {
    const d = e.response.data?.detail;
    if (d && typeof d === "object" && d.code) return new VoiceApiError(d.code as VoiceErrorCode, d.message ?? "Voice isn't available right now.");
  }
  return new VoiceApiError("unknown", "We couldn't reach the voice service. Please try again in a moment.");
}

export const voiceConfig = () => api.get<VoiceConfig>("/voice/config").then((r) => r.data);
export const voiceConsent = (save_history: boolean, voice?: string) =>
  api.post("/voice/consent", { save_history, voice }).then((r) => r.data);
export const voiceStart = (voice?: string) =>
  api.post<VoiceSessionStart>("/voice/session", { voice }).then((r) => r.data).catch((e) => { throw toVoiceError(e); });
export const voiceTool = (session_id: number, name: string, args: Record<string, unknown>) =>
  api.post<{ result: unknown }>("/voice/tool", { session_id, name, args }).then((r) => r.data.result);

export interface EndPayload {
  language?: string | null; end_reason: string; error_code?: string | null; reconnects: number;
  transcript: { role: "user" | "assistant"; text: string }[];
}
export const voiceEnd = (id: number, p: EndPayload) =>
  api.post<{ duration_seconds: number; summary: VoiceSummary | null }>(`/voice/session/${id}/end`, p).then((r) => r.data);

/** Best-effort end when the tab is closing: fetch with keepalive so the Authorization header is kept. */
export function voiceEndBeacon(id: number, p: EndPayload, token: string | null) {
  try {
    const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
    void fetch(`${base}/voice/session/${id}/end`, {
      method: "POST", keepalive: true,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ ...p, transcript: p.transcript.slice(-60) }),
    });
  } catch { /* nothing more we can do */ }
}

export const voiceSessions = () => api.get<VoiceHistoryItem[]>("/voice/sessions").then((r) => r.data);
export const voiceSessionDetail = (id: number) => api.get<VoiceHistoryItem>(`/voice/sessions/${id}`).then((r) => r.data);
export const voiceDeleteSession = (id: number) => api.delete(`/voice/sessions/${id}`);
export const voiceDeleteAll = () => api.delete("/voice/data");
