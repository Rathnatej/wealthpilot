import re

CATEGORIES = {
    "emi": ["emi", "loan", "nach"],
    "investment": ["sip", "mutual fund", "zerodha", "groww", "ppf"],
    "food": ["swiggy", "zomato", "restaurant"],
    "utilities": ["electricity", "bescom", "airtel", "jio", "recharge"],
    "rent": ["rent"],
    "salary": ["salary", "payroll"],
}
LINE_RE = re.compile(r"(\d{2}[/-]\d{2}[/-]\d{2,4})\s+(.+?)\s+([\d,]+\.\d{2})\s*(Dr|Cr)?", re.I)


def categorize(desc: str) -> str:
    d = desc.lower()
    for cat, words in CATEGORIES.items():
        if any(w in d for w in words):
            return cat
    return "other"


def parse_statement(text: str) -> list[dict]:
    out = []
    for m in LINE_RE.finditer(text):
        date_s, desc, amt, drcr = m.groups()
        out.append({
            "date": date_s, "description": desc.strip(),
            "amount": float(amt.replace(",", "")),
            "type": "credit" if (drcr or "").lower() == "cr" else "debit",
            "category": categorize(desc),
        })
    return out
