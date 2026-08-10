"""
Typed field extractors for English text (after IndicTrans2 Kn→En).

No API keys — pure rules on translated English so form boxes get clean values.
"""

from __future__ import annotations

import re
from datetime import datetime

# Spoken English number words → digits (IndicTrans2 often outputs English words)
_ONES = {
    "zero": 0, "oh": 0, "o": 0,
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9,
    "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
    "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19,
}
_TENS = {
    "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
    "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
}
_SCALES = {
    "hundred": 100,
    "thousand": 1000,
    "lakh": 100_000,
    "lakhs": 100_000,
    "crore": 10_000_000,
    "crores": 10_000_000,
}

_NAME_PREFIXES = re.compile(
    r"^(?:my\s+name\s+is|i\s+am|i'm|name\s+is|it\s+is|this\s+is)\s+",
    re.IGNORECASE,
)
_AMOUNT_PREFIXES = re.compile(
    r"^(?:the\s+)?(?:amount\s+is|i\s+(?:want|need|wish)\s+(?:to\s+)?"
    r"(?:withdraw|deposit|apply\s+for)?\s*|rupees?|rs\.?|inr)\s*",
    re.IGNORECASE,
)
_ACCOUNT_PREFIXES = re.compile(
    r"^(?:my\s+)?(?:account\s+(?:number|no\.?)\s*(?:is)?|a/?c\s*(?:no\.?)?\s*(?:is)?)\s*",
    re.IGNORECASE,
)

_ACCOUNT_TYPES = {
    "savings": "Savings",
    "saving": "Savings",
    "current": "Current",
    "salary": "Salary",
    "fixed deposit": "Fixed Deposit",
    "fd": "Fixed Deposit",
}
_LOAN_TYPES = {
    "home": "Home Loan",
    "housing": "Home Loan",
    "personal": "Personal Loan",
    "education": "Education Loan",
    "educational": "Education Loan",
    "car": "Car Loan",
    "vehicle": "Car Loan",
    "auto": "Car Loan",
    "gold": "Gold Loan",
}
_DEPOSIT_MODES = {
    "cash": "Cash",
    "cheque": "Cheque",
    "check": "Cheque",
    "dd": "Demand Draft",
    "demand draft": "Demand Draft",
}
_CHEQUE_LEAVES = {
    "10": "10",
    "ten": "10",
    "25": "25",
    "twenty five": "25",
    "twentyfive": "25",
    "50": "50",
    "fifty": "50",
    "100": "100",
    "hundred": "100",
}
_CARD_TYPES = {
    "atm": "ATM / Debit Card",
    "debit": "ATM / Debit Card",
    "credit": "Credit Card",
}
_FD_TENURE = {
    "1 year": "1 year",
    "one year": "1 year",
    "2 year": "2 years",
    "two year": "2 years",
    "3 year": "3 years",
    "three year": "3 years",
    "5 year": "5 years",
    "five year": "5 years",
    "6 month": "6 months",
    "six month": "6 months",
    "12 month": "12 months",
}
_INTEREST_PAYOUT = {
    "monthly": "Monthly",
    "quarterly": "Quarterly",
    "on maturity": "On maturity",
    "maturity": "On maturity",
    "cumulative": "Cumulative / On maturity",
}

_IFSC_RE = re.compile(r"\b([A-Z]{4}0[A-Z0-9]{6})\b", re.I)
_PAN_RE = re.compile(r"\b([A-Z]{5}\d{4}[A-Z])\b", re.I)
_MOBILE_RE = re.compile(r"\b([6-9]\d{9})\b")


def _tokenize(text: str) -> list[str]:
    return re.findall(r"[a-zA-Z]+|\d+", text.lower())


def _words_to_number(tokens: list[str]) -> int | None:
    """Parse a sequence of English number words into an integer."""
    if not tokens:
        return None
    if len(tokens) == 1 and tokens[0].isdigit():
        return int(tokens[0])

    total = 0
    current = 0
    seen = False
    for tok in tokens:
        if tok.isdigit():
            current += int(tok)
            seen = True
        elif tok in _ONES:
            current += _ONES[tok]
            seen = True
        elif tok in _TENS:
            current += _TENS[tok]
            seen = True
        elif tok in _SCALES:
            scale = _SCALES[tok]
            if current == 0:
                current = 1
            current *= scale
            if scale >= 1000:
                total += current
                current = 0
            seen = True
        elif tok in {"and", "rupee", "rupees", "only", "rs", "inr"}:
            continue
        else:
            if seen:
                break
            return None
    result = total + current
    return result if seen else None


def _extract_digits(text: str) -> str:
    """Prefer Arabic digits already present; else digit-by-digit spoken words."""
    digits = re.sub(r"\D", "", text)
    if len(digits) >= 4:
        return digits

    tokens = _tokenize(text)
    if tokens and all(t in _ONES or t.isdigit() for t in tokens if t not in {"and"}):
        out = []
        for t in tokens:
            if t in {"and"}:
                continue
            if t.isdigit():
                out.append(t)
            elif t in _ONES and _ONES[t] < 10:
                out.append(str(_ONES[t]))
        if out:
            return "".join(out)

    n = _words_to_number(tokens)
    return str(n) if n is not None else digits


def _extract_amount(text: str) -> str:
    cleaned = _AMOUNT_PREFIXES.sub("", text.strip())
    m = re.search(r"(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d+)?", cleaned.replace(" ", ""))
    if m:
        return m.group(1).replace(",", "")
    m2 = re.search(r"(\d{1,3}(?:,\d{2,3})+|\d+)", cleaned)
    if m2:
        return m2.group(1).replace(",", "")

    n = _words_to_number(_tokenize(cleaned))
    return str(n) if n is not None else cleaned.strip()


def _extract_name(text: str) -> str:
    cleaned = _NAME_PREFIXES.sub("", text.strip())
    cleaned = re.sub(r"[.؟!]+$", "", cleaned).strip()
    cleaned = re.sub(r"\b(?:please|sir|madam)\b\.?$", "", cleaned, flags=re.I).strip()
    if not cleaned:
        return text.strip()
    return " ".join(w.capitalize() for w in cleaned.split())


def _extract_date(text: str) -> str:
    t = text.strip()
    for fmt, out_fmt in (
        (r"(\d{1,2})[/-](\d{1,2})[/-](\d{4})", "%d/%m/%Y"),
        (r"(\d{1,2})[/-](\d{1,2})[/-](\d{2})", "%d/%m/%y"),
    ):
        m = re.search(fmt, t)
        if m:
            try:
                if out_fmt.endswith("%y"):
                    dt = datetime.strptime(
                        f"{m.group(1)}/{m.group(2)}/{m.group(3)}", "%d/%m/%y"
                    )
                else:
                    dt = datetime.strptime(
                        f"{m.group(1)}/{m.group(2)}/{m.group(3)}", "%d/%m/%Y"
                    )
                return dt.strftime("%d/%m/%Y")
            except ValueError:
                pass
    if re.search(r"\btoday\b", t, re.I):
        return datetime.now().strftime("%d/%m/%Y")
    return t


def _match_choice(text: str, mapping: dict[str, str]) -> str | None:
    lower = text.lower()
    for key in sorted(mapping.keys(), key=len, reverse=True):
        if key in lower:
            return mapping[key]
    return None


def _extract_address(text: str) -> str:
    cleaned = re.sub(
        r"^(?:my\s+)?(?:address\s+is|i\s+live\s+at|i\s+stay\s+at)\s+",
        "",
        text.strip(),
        flags=re.I,
    )
    return cleaned.strip() or text.strip()


def _extract_ifsc(text: str) -> str:
    m = _IFSC_RE.search(text.replace(" ", ""))
    if m:
        return m.group(1).upper()
    compact = re.sub(r"[^A-Za-z0-9]", "", text.upper())
    m2 = _IFSC_RE.search(compact)
    if m2:
        return m2.group(1).upper()
    return text.strip().upper()


def _extract_pan(text: str) -> str:
    m = _PAN_RE.search(text.replace(" ", "").upper())
    if m:
        return m.group(1).upper()
    compact = re.sub(r"[^A-Za-z0-9]", "", text.upper())
    m2 = _PAN_RE.search(compact)
    return m2.group(1).upper() if m2 else text.strip().upper()


def _extract_mobile(text: str) -> str:
    m = _MOBILE_RE.search(re.sub(r"\s+", "", text))
    if m:
        return m.group(1)
    digits = _extract_digits(text)
    if len(digits) >= 10:
        return digits[-10:]
    return digits or text.strip()


def extract_field_value(
    english_text: str,
    field_type: str = "text",
    field_id: str = "",
) -> str:
    """
    Turn IndicTrans2 English output into a clean form-box value.

    Parameters
    ----------
    english_text:
        English string from translate_kn_to_en().
    field_type:
        One of text | digits | amount | date | choice.
    field_id:
        Field id for specialized maps (account_type, loan_type, ifsc, …).
    """
    text = (english_text or "").strip()
    if not text:
        return ""

    fid = (field_id or "").lower()
    ftype = (field_type or "text").lower()

    if fid == "deposit_mode":
        return _match_choice(text, _DEPOSIT_MODES) or text.strip().title()

    if fid == "account_type":
        return _match_choice(text, _ACCOUNT_TYPES) or text.strip().title()

    if fid == "loan_type":
        return _match_choice(text, _LOAN_TYPES) or text.strip().title()

    if fid in {"card_type", "atm_card_type"}:
        return _match_choice(text, _CARD_TYPES) or "ATM / Debit Card"

    if fid in {"number_of_leaves", "cheque_leaves"}:
        hit = _match_choice(text, _CHEQUE_LEAVES)
        if hit:
            return hit
        digits = _extract_digits(text)
        return digits or text.strip()

    if fid in {"tenure", "fd_tenure", "deposit_tenure"}:
        return _match_choice(text, _FD_TENURE) or text.strip()

    if fid in {"interest_payout", "interest_payment"}:
        return _match_choice(text, _INTEREST_PAYOUT) or text.strip().title()

    if fid in {"ifsc", "ifsc_code", "beneficiary_ifsc"}:
        return _extract_ifsc(text)

    if fid in {"pan", "pan_number"}:
        return _extract_pan(text)

    if fid in {
        "full_name", "name", "applicant_name", "beneficiary_name",
        "remitter_name", "nominee_name",
    }:
        return _extract_name(text)

    if fid == "address" or fid.endswith("_address"):
        return _extract_address(text)

    if fid in {
        "mobile", "mobile_number", "phone", "new_mobile", "old_mobile",
        "registered_mobile",
    }:
        return _extract_mobile(text)

    if ftype == "digits" or fid in {
        "account_number", "beneficiary_account", "remitter_account",
        "cheque_number", "from_cheque", "to_cheque",
    }:
        cleaned = _ACCOUNT_PREFIXES.sub("", text)
        return _extract_digits(cleaned)

    if ftype == "amount" or fid in {
        "amount", "loan_amount", "income", "fd_amount", "deposit_amount",
    }:
        return _extract_amount(text)

    if ftype == "date" or "date" in fid or fid == "date_of_birth":
        return _extract_date(text)

    if fid in {"purpose", "remarks", "reason"}:
        return text.strip().capitalize()

    cleaned = _NAME_PREFIXES.sub("", text)
    if len(cleaned.split()) <= 6:
        return " ".join(w.capitalize() for w in cleaned.split())
    return cleaned.strip()
