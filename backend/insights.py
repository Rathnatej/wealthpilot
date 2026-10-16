"""Deterministic spending analysis. The AI (if any) only narrates these facts."""
from collections import defaultdict
from datetime import date, datetime

FORMATS = ("%d/%m/%Y", "%d-%m-%Y", "%d/%m/%y", "%d-%m-%y", "%Y-%m-%d", "%d %b %Y", "%d-%b-%Y", "%d-%b-%y")


def parse_date(s: str) -> date | None:
    for f in FORMATS:
        try:
            return datetime.strptime(s.strip(), f).date()
        except ValueError:
            continue
    return None


def spending_facts(txns: list[dict]) -> dict:
    spend: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    income: dict[str, float] = defaultdict(float)
    skipped = 0
    for t in txns:
        d = parse_date(t["date"])
        if d is None:
            skipped += 1
            continue
        key = f"{d.year}-{d.month:02d}"
        if t["type"] == "debit":
            spend[key][t["category"]] += t["amount"]
        else:
            income[key] += t["amount"]
    months = sorted(set(spend) | set(income))
    if not months:
        return {"months": [], "skipped_rows": skipped}

    totals = {m: round(sum(spend[m].values()), 2) for m in months}
    overall: dict[str, float] = defaultdict(float)
    for m in months:
        for c, v in spend[m].items():
            overall[c] += v
    grand = sum(overall.values())
    top = [{"category": c, "total": round(v, 2), "share_pct": round(v / grand * 100, 1) if grand else 0.0}
           for c, v in sorted(overall.items(), key=lambda x: -x[1])[:5]]

    latest = months[-1]
    prev = months[-2] if len(months) > 1 else None
    changes = []
    if prev:
        for c in set(spend[latest]) | set(spend[prev]):
            a, b = round(spend[prev].get(c, 0.0), 2), round(spend[latest].get(c, 0.0), 2)
            if a == 0 and b == 0:
                continue
            changes.append({"category": c, "previous": a, "latest": b, "change": round(b - a, 2),
                            "change_pct": round((b - a) / a * 100, 1) if a > 0 else None})
        changes.sort(key=lambda x: -abs(x["change"]))
        changes = changes[:5]
    inc = income.get(latest, 0.0)
    return {
        "months": months, "latest_month": latest, "previous_month": prev,
        "spend_by_month": totals, "income_latest_month": round(inc, 2),
        "top_categories": top, "changes": changes,
        "savings_rate_latest_pct": round((inc - totals.get(latest, 0.0)) / inc * 100, 1) if inc > 0 else None,
        "skipped_rows": skipped,
    }
