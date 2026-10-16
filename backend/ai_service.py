import os
from google import genai
from google.genai import types

from schemas import IntentResponse

MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

GUARDRAILS = """You are WealthPilot's educational assistant. Compliance rules (SEBI Level 1-2 only):
- Provide only educational concepts and scenario analysis.
- NEVER generate financial figures, projections or returns yourself; all numbers come from the deterministic engine.
- NEVER recommend specific stocks, funds or tickers, and never give personalised buy/sell/execution advice.
- If asked for such advice, set refused=true and explain you can only help with education and what-if scenarios.
For what-if questions, extract ONLY the user-stated parameters into `scenario`
(amounts in INR: 1 lakh = 100000; loan EMI in new_loan_emi and tenure in new_loan_months; SIP change in sip_delta).
Do not invent values the user did not state."""


def _client():
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("GEMINI_API_KEY not set")
    return genai.Client(api_key=key)


def parse_intent(query: str) -> IntentResponse:
    resp = _client().models.generate_content(
        model=MODEL,
        contents=query,
        config=types.GenerateContentConfig(
            system_instruction=GUARDRAILS,
            response_mime_type="application/json",
            response_schema=IntentResponse,
            temperature=0,
        ),
    )
    return IntentResponse.model_validate_json(resp.text)


def explain(context: str) -> str:
    resp = _client().models.generate_content(
        model=MODEL,
        contents="Explain these simulation results in plain language, educationally. "
                 "Only reference numbers given here; add no new numbers or advice.\n" + context,
        config=types.GenerateContentConfig(system_instruction=GUARDRAILS, temperature=0.3),
    )
    return resp.text
