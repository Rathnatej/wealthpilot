# WealthPilot

Deterministic finance engine + AI explanations. FastAPI backend (`backend/`), Next.js frontend (`frontend/`).
Local: `cd backend && ./venv/bin/uvicorn main:app --reload` and `cd frontend && npm run dev`.
Tests: `cd backend && ./venv/bin/python -m pytest -q`.

---

## Voice assistant ("Talk to your assistant")

A calm, real-time, speech-to-speech advisor built on the **Gemini Live API** (`gemini-3.8-live`, Google's
recommended default for low-latency voice). Route: `/voice`. History: `/voice/history`.

### How it works

```
Browser ──(1) POST /voice/session (JWT)──▶ Backend ──(2) auth_tokens.create──▶ Gemini
Browser ◀─(3) one-use ephemeral token + system prompt + tool list ── Backend
Browser ══(4) WebSocket audio, direct to Gemini, using the ephemeral token══ Gemini Live
Browser ──(5) tool call → POST /voice/tool (JWT) ──▶ Backend (data scoped to that user)
Browser ──(6) POST /voice/session/{id}/end ──▶ Backend (usage, optional encrypted transcript + summary)
```

* The real `GEMINI_API_KEY` never reaches the browser. The token is single-use, must be used within 1 minute,
  and expires after the session cap (+2 min). Reconnects reuse it via session resumption.
* Audio goes browser → Google directly (lowest latency). WealthPilot never receives or stores audio.
* Tool calls run on **our** backend with the user's JWT; the user id never comes from the model.

### Setup

1. Set `GEMINI_API_KEY` on the backend (the paid key). That is all that's required; everything else has defaults.
2. Deploy backend + frontend as usual (`cryptography` is in `requirements.txt`; `@google/genai` in the frontend).
3. Recommended: set `VOICE_ENCRYPTION_KEY` (see below) so transcripts survive a `JWT_SECRET` rotation.
4. Verify against the real API once: `cd backend && ./venv/bin/python scripts/voice_smoke.py`.
5. Go through [`docs/voice-test-checklist.md`](docs/voice-test-checklist.md) in each language.

### Environment variables (backend)

| Variable | Default | Meaning |
|---|---|---|
| `GEMINI_API_KEY` | (required) | Server-side key. Never exposed. |
| `VOICE_ENABLED` | `true` | Master feature flag. `false` hides/blocks voice for everyone. |
| `VOICE_PAID_ONLY` | `false` | `true` = only "pro" users may use voice (see paid gate). |
| `VOICE_MODEL` | `gemini-3.8-live` | Live model id. Google also lists an "Extended Thinking" Live variant (deeper reasoning, more latency); check the model page for its id before using it. |
| `VOICE_DEFAULT` | `Sulafat` | Default voice (must be in the list in `entitlements.VOICES`). |
| `VOICE_FREE_DAILY_MINUTES` | `15` | Free daily cap per user. |
| `VOICE_FREE_MONTHLY_MINUTES` | `120` | Free monthly cap per user. |
| `VOICE_MAX_SESSION_SECONDS` | `1200` | Hard cap on one session (also limits the token's life). |
| `VOICE_IDLE_TIMEOUT_SECONDS` | `120` | Auto-end after this much silence (the assistant nudges gently at 25 s). |
| `VOICE_TOKEN_RATE_LIMIT` / `_WINDOW_SECONDS` | `6` / `600` | Max sessions started per user per window. |
| `VOICE_PRO_EMAILS` | empty | Placeholder plan list: these emails are "pro" (unlimited). |
| `VOICE_ENCRYPTION_KEY` | derived from `JWT_SECRET` | Fernet key for stored transcripts/summaries. |

### Changing the voice

* Default: `VOICE_DEFAULT=Vindemiatrix`. Users can also pick one on the start screen (saved per user).
* Curated calm voices live in `backend/entitlements.py` → `VOICES` (Sulafat *warm*, Vindemiatrix *gentle*,
  Achernar *soft*, Gacrux *mature*, Despina *smooth*, Achird *friendly*, Schedar *even*). Add any prebuilt voice name
  from Google's voice list. Audition them in Google AI Studio → Stream.
* Speaking pace/tone are controlled by the system prompt in `backend/voice_prompt.py` (the Live API has no speed knob).

### Languages

The model detects the language the person speaks and answers in it; it follows mid-conversation switches
(instructions in `voice_prompt.py`). English, Hindi and Telugu are all in Google's supported-language list for the
Live API and for the TTS models. Telugu and Hindi are official languages for this model; **quality is not something
I could judge by ear while building this, so rate each one yourself with the checklist.** Expectations from how
these models usually behave, not measured results:

* **Likely strongest:** English (Indian accent understanding is good), Hindi.
* **Supported, check carefully:** Telugu, Tamil, Kannada, Malayalam, Bengali, Marathi, Gujarati. Watch pronunciation
  of numbers, "lakh/crore", and English loanwords inside the language.
* **Riskiest:** heavy code-mixing (Hinglish/Tenglish) and noisy rooms; transcripts (captions) can be rougher than the audio.

The UI itself is English-only for now.

### Paid gate (how to flip voice to a paid feature)

The only gate is `entitlements.can_use_voice(user)`, used by every endpoint.

1. Set `VOICE_PAID_ONLY=true` on the backend. Free users now get `402 upgrade_required` and the frontend automatically
   shows `<UpgradePrompt/>` (`frontend/src/components/voice/UpgradePrompt.tsx`; it is hidden until then). Set its `href` to your pricing page.
2. Replace `entitlements.plan_for(user)` (currently "email in `VOICE_PRO_EMAILS`") with a real subscription lookup
   (Stripe etc.). Return `"pro"` for paying users. Pro users are not subject to the free minute caps.
3. Free-tier caps (`VOICE_FREE_*`) can stay as a trial allowance while `VOICE_PAID_ONLY=false`.

### Privacy & safety summary

* Consent screen before first use (`POST /voice/consent`); nothing is streamed until accepted.
* No audio stored. Transcripts + summaries stored **only if the user opts in**, Fernet-encrypted at rest.
* Users can delete one conversation, or everything (which also withdraws consent), in `/voice/history`.
* Logs contain counts/durations/language/errors only, never transcript text.
* Crisis handling: the system prompt switches to compassionate support + helplines instead of financial tips;
  the UI also shows a helpline banner when the user's words match a small multi-language keyword list.
* The assistant is instructed never to ask for passwords/OTPs/card numbers, never to promise returns, and to refer
  tax/loan/large-investment decisions to a qualified professional. Disclaimer is on every voice screen.

### Known limitations / next steps

* **Not yet verified against live audio.** Unit tests cover the backend; the browser audio path, Safari behaviour and
  language quality need a real device pass (checklist). Run `scripts/voice_smoke.py` with the real key first.
* Speech pace can't be set via API; "slightly slower, with pauses" is prompt-driven and varies by language.
* No warm/pre-opened sessions: tokens are single-use with a 1-minute start window and a started session bills, so we
  preconnect and preload the SDK instead. Expect roughly 1 s to first greeting, depending on network.
* Rate limiting is in-memory per process; use Redis if you run more than one backend instance.
* Browser crisis detection is a keyword list (English/Hindi/Telugu); the prompt is the main safeguard.
* Language detection for history labels is script-based, so romanised Hindi shows as "English".
* Echo: we rely on browser echo cancellation. Speaker + loud volume on some laptops can still self-interrupt; headphones fix it.
* Safari: needs 14.1+ (AudioWorklet). Unsupported browsers fall back to the text chat.
* Billing/subscriptions, per-language UI, push-to-talk mode, and a server-side moderation pass are good next steps.
