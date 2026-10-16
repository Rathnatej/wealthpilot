import os

from google import genai
from google.genai import types

from feature_schemas import LLMIntent

MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

INTENT_SYSTEM = """You extract what-if parameters for WealthPilot (SEBI Level 1-2: education and scenario analysis only).
- Fill `params` ONLY with values the user explicitly stated. Amounts are in INR (1 lakh = 100000, 1 crore = 10000000).
- loan_amount = loan principal; loan_months = tenure in months (convert years); loan_rate_pct = yearly interest if stated;
  loan_emi = only if the user gave an EMI amount; sip_change = change in monthly SIP (negative to reduce); lump_sum = one-time amount invested.
- NEVER compute an EMI, return or projection yourself, and never invent values the user did not state.
- If the user asks which stock/fund to buy or sell, or for personalised advice, set refused=true and explain that you
  only provide education and what-if scenarios.
- If there is no scenario in the message, leave params null and put a short hint in `message`."""


def configured() -> bool:
    return bool(os.getenv("GEMINI_API_KEY"))


def _client():
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("GEMINI_API_KEY not set")
    return genai.Client(api_key=key)


def parse_intent_llm(query: str) -> LLMIntent:
    resp = _client().models.generate_content(
        model=MODEL,
        contents=query,
        config=types.GenerateContentConfig(
            system_instruction=INTENT_SYSTEM,
            response_mime_type="application/json",
            response_schema=LLMIntent,
            temperature=0,
        ),
    )
    return LLMIntent.model_validate_json(resp.text)


def generate(system: str, prompt: str, temperature: float = 0.2) -> str:
    resp = _client().models.generate_content(
        model=MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(system_instruction=system, temperature=temperature),
    )
    return resp.text or ""


def explain(context: str) -> str:
    """Legacy free-text explainer (kept for /ai/explain)."""
    return generate(
        "You are WealthPilot's educational assistant (SEBI Level 1-2). Never invent numbers, never give advice.",
        "Explain these simulation results in plain language, educationally. Only reference numbers given here; "
        "add no new numbers or advice.\n" + context,
        0.3,
    )
