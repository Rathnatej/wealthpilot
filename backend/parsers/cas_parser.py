import io
import re
import pdfplumber

ISIN_RE = re.compile(r"\b(INF[A-Z0-9]{9})\b")
FOLIO_RE = re.compile(r"Folio\s*No[:.\s]*([0-9A-Za-z/ ]+?)(?:\s{2,}|\n|$)", re.I)
UNITS_RE = re.compile(r"(?:Closing\s+Unit\s+Balance|Units?)[:\s]*([\d,]+\.\d+)", re.I)
COST_RE = re.compile(r"(?:Total\s+Cost\s+Value|Cost\s+Value)[:\s₹INR]*([\d,]+\.\d+)", re.I)
NAV_RE = re.compile(r"NAV(?:\s+on\s+[\d\-A-Za-z]+)?[:\s₹INR]*([\d,]+\.\d+)", re.I)
THRESHOLD = 0.9


def _num(s):
    return float(s.replace(",", "")) if s else None


def parse_text(text: str) -> list[dict]:
    holdings = []
    # split into blocks starting at each folio line
    blocks = re.split(r"(?=Folio\s*No)", text, flags=re.I)
    for block in blocks:
        isin = ISIN_RE.search(block)
        if not isin:
            continue
        folio = FOLIO_RE.search(block)
        fields = {
            "isin": isin.group(1),
            "folio": folio.group(1).strip() if folio else None,
            "units": _num(m.group(1)) if (m := UNITS_RE.search(block)) else None,
            "cost": _num(m.group(1)) if (m := COST_RE.search(block)) else None,
            "nav": _num(m.group(1)) if (m := NAV_RE.search(block)) else None,
        }
        confidence = sum(v is not None for v in fields.values()) / len(fields)
        fields["confidence"] = round(confidence, 2)
        fields["needs_review"] = confidence < THRESHOLD
        holdings.append(fields)
    return holdings


def extract_text(pdf_bytes: bytes, password: str | None = None) -> str:
    with pdfplumber.open(io.BytesIO(pdf_bytes), password=password) as pdf:
        return "\n".join(page.extract_text() or "" for page in pdf.pages)


def parse_cas(pdf_bytes: bytes, password: str | None = None) -> list[dict]:
    return parse_text(extract_text(pdf_bytes, password))
