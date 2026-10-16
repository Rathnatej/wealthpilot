import csv
import io
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


def _num(s: str) -> float | None:
    s = (s or "").replace(",", "").strip()
    try:
        return float(s) if s else None
    except ValueError:
        return None


def parse_csv(text: str) -> list[dict]:
    """Parse a bank CSV export that has a header row (Date, Narration, Debit/Withdrawal, Credit/Deposit)."""
    rows = list(csv.reader(io.StringIO(text)))
    desc_pat = r"narration|description|particulars|details|remarks"
    head = next((i for i, r in enumerate(rows[:40])
                 if any("date" in c.lower() for c in r) and any(re.search(desc_pat, c, re.I) for c in r)), None)
    if head is None:
        return []
    hdr = [c.strip().lower() for c in rows[head]]

    def col(pattern: str, exclude: str | None = None):
        for i, c in enumerate(hdr):
            if re.search(pattern, c) and not (exclude and re.search(exclude, c)):
                return i
        return None

    di, ni = col(r"date", r"value"), col(desc_pat)
    dr, cr = col(r"debit|withdrawal|^dr$"), col(r"credit|deposit|^cr$")
    am = col(r"^amount")
    out = []
    for r in rows[head + 1:]:
        if di is None or ni is None or len(r) <= max(di, ni):
            continue
        get = lambda i: r[i] if i is not None and i < len(r) else ""  # noqa: E731
        d_amt, c_amt, a_amt = _num(get(dr)), _num(get(cr)), _num(get(am))
        if d_amt:
            amount, typ = d_amt, "debit"
        elif c_amt:
            amount, typ = c_amt, "credit"
        elif a_amt:
            amount, typ = abs(a_amt), ("debit" if a_amt < 0 else "credit")
        else:
            continue
        date_s, desc = get(di).strip(), get(ni).strip()
        if not date_s:
            continue
        out.append({"date": date_s, "description": desc, "amount": amount, "type": typ,
                    "category": categorize(desc)})
    return out


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
