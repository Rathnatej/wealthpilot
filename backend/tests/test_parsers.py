from parsers.bank_statement import categorize, parse_statement
from parsers.cas_parser import parse_text

CAS = """Folio No: 12345/67
ISIN: INF123456789 Closing Unit Balance: 1,000.500
Total Cost Value: 50,000.00 NAV on 01-Jan-2025: 75.25
Folio No: 999
ISIN: INF987654321
"""


def test_cas_complete_and_incomplete_blocks():
    h = parse_text(CAS)
    assert len(h) == 2
    assert h[0]["isin"] == "INF123456789" and h[0]["units"] == 1000.5
    assert h[0]["needs_review"] is False
    assert h[1]["needs_review"] is True


def test_bank_categorisation():
    assert categorize("SWIGGY ORDER") == "food"
    t = parse_statement("01/02/2025 SALARY ACME 50,000.00 Cr")
    assert t[0]["type"] == "credit" and t[0]["category"] == "salary"
