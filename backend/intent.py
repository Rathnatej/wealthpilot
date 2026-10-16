"""Turns a natural-language what-if into scenario parameters. Rules-based fallback needs no AI key."""
import re

from feature_schemas import IntentParams, LLMIntent
from planners import emi, fmt_inr
from schemas import ScenarioDelta

REFUSAL = ("I can only explain concepts and run what-if scenarios. I can't recommend specific stocks or "
           "funds, or tell you what to buy or sell.")
HINT = ("I couldn't find a scenario in that. Try: \"What if I take a ₹10L loan for 5 years?\" "
        "or \"What if I raise my SIP by ₹10,000?\"")
DEFAULT_RATE = 9.5
DEFAULT_MONTHS = 60

# Deterministic guardrail: runs before any AI call.
ADVICE_RE = re.compile(
    r"\b(which|what)\s+(stocks?|shares?|funds?|mutual funds?|etfs?|crypto\w*)\b"
    r"|\bshould i (buy|sell|invest in|put)\b"
    r"|\bbest (stocks?|funds?|mutual funds?|shares?|etfs?)\b"
    r"|\btop \d*\s*(stocks?|funds?)\b|\bticker\b|\bstock tips?\b|\bmulti-?bagger\b",
    re.I)

UNIT = {"cr": 1e7, "crore": 1e7, "crores": 1e7, "lakh": 1e5, "lakhs": 1e5, "lac": 1e5, "lacs": 1e5,
        "l": 1e5, "k": 1e3, "thousand": 1e3}
AMT_RE = re.compile(
    r"(?:₹|rs\.?|inr)?\s*(\d+(?:,\d{2,3})*(?:\.\d+)?)\s*(crores?|cr|lakhs?|lacs?|l|k|thousand)?\b"
    r"(?!\s*(?:years?|yrs?|months?|mos?|%|percent))", re.I)
TENURE_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(years?|yrs?|months?|mos?)\b", re.I)
RATE_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:%|percent)", re.I)


def parse_rules(q: str) -> LLMIntent:
    if ADVICE_RE.search(q):
        return LLMIntent(refused=True, message=REFUSAL)
    low = q.lower()
    amounts: list[float] = []
    for m in AMT_RE.finditer(q):
        num = float(m.group(1).replace(",", ""))
        unit = (m.group(2) or "").lower()
        if not unit and num < 1000:
            continue
        amounts.append(num * UNIT.get(unit, 1))
    if not amounts:
        return LLMIntent(message=HINT)

    p = IntentParams()
    has_loan = bool(re.search(r"\b(loan|emi|borrow|mortgage)\b", low))
    has_sip = "sip" in low
    idx = 0
    if has_loan:
        if re.search(r"\bemi\b", low):
            p.loan_emi = amounts[0]
        else:
            p.loan_amount = amounts[0]
        idx = 1
        if t := TENURE_RE.search(q):
            n = float(t.group(1))
            p.loan_months = round(n * 12) if t.group(2).lower().startswith(("y",)) else round(n)
        if r := RATE_RE.search(q):
            p.loan_rate_pct = float(r.group(1))
    if has_sip:
        amt = amounts[idx] if idx < len(amounts) else amounts[0]
        cut = re.search(r"\b(reduce|decrease|cut|lower|drop|less)\b", low)
        p.sip_change = -amt if cut else amt
    if not has_loan and not has_sip and re.search(r"lump|bonus|windfall|inherit|one[- ]time|invest", low):
        p.lump_sum = amounts[0]
    if not any(v is not None for v in p.model_dump().values()):
        return LLMIntent(message=HINT)
    return LLMIntent(params=p)


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def scenario_from_params(p: IntentParams) -> tuple[ScenarioDelta | None, list[str]]:
    """The AI only supplies what the user said; every number below is computed here."""
    notes: list[str] = []
    emi_amt, months, parts = 0.0, 0, []
    if p.loan_amount and p.loan_amount > 0:
        principal = _clamp(p.loan_amount, 1, 1e10)
        rate = _clamp(p.loan_rate_pct if p.loan_rate_pct is not None else DEFAULT_RATE, 0, 40)
        if p.loan_rate_pct is None:
            notes.append(f"Assumed a loan interest rate of {DEFAULT_RATE}% a year.")
        months = int(_clamp(p.loan_months or DEFAULT_MONTHS, 1, 600))
        if not p.loan_months:
            notes.append(f"Assumed a {DEFAULT_MONTHS}-month loan tenure.")
        emi_amt = round(emi(principal, rate / 100, months), 2)
        notes.append(f"A loan of {fmt_inr(principal)} at {rate}% over {months} months has an EMI of "
                     f"{fmt_inr(emi_amt)}. The simulator takes the EMI out of your monthly investing and "
                     f"assumes the loan proceeds are spent, not invested.")
        parts.append(f"{fmt_inr(principal)} loan")
    elif p.loan_emi and p.loan_emi > 0:
        emi_amt = _clamp(p.loan_emi, 1, 1e9)
        months = int(_clamp(p.loan_months or DEFAULT_MONTHS, 1, 600))
        if not p.loan_months:
            notes.append(f"Assumed the EMI runs for {DEFAULT_MONTHS} months.")
        notes.append("The EMI is taken out of your monthly investing.")
        parts.append(f"{fmt_inr(emi_amt)} EMI")
    sip = _clamp(p.sip_change or 0.0, -1e9, 1e9)
    lump = _clamp(p.lump_sum or 0.0, -1e11, 1e11)
    if sip:
        parts.append("SIP change")
    if lump:
        parts.append("lump sum")
    if emi_amt == 0 and sip == 0 and lump == 0:
        return None, notes
    return ScenarioDelta(name=" + ".join(parts), sip_delta=sip, new_loan_emi=emi_amt,
                         new_loan_months=months if emi_amt else 0, lump_sum=lump), notes
