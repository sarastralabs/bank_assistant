"""
backend/decision_router/router.py

Core routing logic for the Decision Router module.

Given an intent label from the NLU module, determines whether the query
is informational (answer from bank_info.json) or transactional (collect
entity fields, generate a form), and returns a structured result dict.

No ML, no external dependencies — pure Python dictionary lookups.

Known limitation
----------------
``account_info_query`` currently returns the ``"general"`` fallback text
from bank_info.json regardless of which specific account procedure the
user intended (name change, ATM block, PIN change, etc.).  Disambiguating
between specific procedures requires knowing which entities appear in the
user's query — for example, detecting "name" to route to name_change, or
"ATM" to route to atm_block.  Entity extraction is out of scope for this
module (it would be handled by a future spaCy-based NER module).  This is
a documented design decision, not a bug.  When entity extraction is added,
``_build_account_info_response()`` can be extended to accept an entity hint
and return the specific procedure text.
"""

from __future__ import annotations

import json
import os

from backend.decision_router.exceptions import RouterError

# ---------------------------------------------------------------------------
# Load bank_info.json once at import time
# ---------------------------------------------------------------------------
_PROJECT_ROOT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..")
)
_BANK_INFO_PATH = os.path.join(_PROJECT_ROOT, "data", "bank_info.json")

if not os.path.exists(_BANK_INFO_PATH):
    raise FileNotFoundError(
        f"bank_info.json not found at '{_BANK_INFO_PATH}'.\n"
        "Create data/bank_info.json before importing this module."
    )

with open(_BANK_INFO_PATH, encoding="utf-8") as _f:
    _BANK_INFO: dict = json.load(_f)

# ---------------------------------------------------------------------------
# Intent category constants — single source of truth
# ---------------------------------------------------------------------------
INFORMATIONAL_INTENTS: frozenset[str] = frozenset({
    "check_balance",
    "account_info_query",
    "interest_rate_query",
})

TRANSACTIONAL_INTENTS: frozenset[str] = frozenset({
    "open_account",
    "apply_loan",
    "deposit_money",
    "withdraw_money",
})

ALL_INTENTS: frozenset[str] = INFORMATIONAL_INTENTS | TRANSACTIONAL_INTENTS

# ---------------------------------------------------------------------------
# Required entity fields per transactional intent
# ---------------------------------------------------------------------------
# This is a static specification of what must be collected before a form
# can be generated.  Actual extraction of these entities from the user's
# speech is a future module responsibility.
REQUIRED_FIELDS: dict[str, list[str]] = {
    "open_account":  ["full_name", "date_of_birth", "address", "account_type"],
    "apply_loan":    ["full_name", "loan_type", "loan_amount", "income"],
    "deposit_money": ["account_number", "amount"],
    "withdraw_money":["account_number", "amount"],
}

# ---------------------------------------------------------------------------
# Response text builders (private)
# ---------------------------------------------------------------------------

def _build_interest_rate_response() -> str:
    """Format all interest rates from bank_info as a spoken-friendly string."""
    rates = _BANK_INFO["interest_rates"]
    loan_info = _BANK_INFO["loan_repayment"]["info"]

    lines = [
        "Here are our current interest rates.",
        f"Savings Account: {rates['savings_account']}.",
        f"Fixed Deposit for 1 year: {rates['fixed_deposit_1yr']}.",
        f"Fixed Deposit for 3 years: {rates['fixed_deposit_3yr']}.",
        f"Fixed Deposit for 5 years: {rates['fixed_deposit_5yr']}.",
        f"Home Loan: {rates['home_loan']}.",
        f"Personal Loan: {rates['personal_loan']}.",
        f"Education Loan: {rates['education_loan']}.",
        f"Car Loan: {rates['car_loan']}.",
        loan_info,
    ]
    return " ".join(lines)


def _build_account_info_response() -> str:
    """
    Return the general account procedures response.

    Currently always returns the ``"general"`` fallback because specific
    procedure selection requires entity extraction (out of scope).
    See module docstring for full explanation of this known limitation.
    """
    return _BANK_INFO["account_procedures"]["general"]


def _build_balance_response() -> str:
    """Return the demo placeholder for check_balance queries."""
    return _BANK_INFO["check_balance_note"]


def _build_transactional_response(intent: str, fields: list[str]) -> str:
    """
    Build a natural-language prompt listing what information will be collected.

    The text is spoken by TTS before the form-filling flow begins, so it
    must be concise and clear when read aloud.
    """
    intent_phrases = {
        "open_account":  "open a new bank account",
        "apply_loan":    "process your loan application",
        "deposit_money": "process your deposit",
        "withdraw_money":"process your withdrawal",
    }
    action = intent_phrases.get(intent, f"complete the {intent.replace('_', ' ')} request")

    # Format field names for speech: "full_name" → "full name"
    spoken_fields = ", ".join(f.replace("_", " ") for f in fields)

    return (
        f"To {action}, I will need to collect the following details: "
        f"{spoken_fields}. "
        f"Please have these ready."
    )


# ---------------------------------------------------------------------------
# Public routing function
# ---------------------------------------------------------------------------

def route(intent: str) -> dict:
    """
    Route an intent to its handling path and return a structured result.

    Parameters
    ----------
    intent:
        Intent label string from the NLU module.  Must be one of the 7
        known intents; see ``ALL_INTENTS``.

    Returns
    -------
    dict
        Always contains ``"route"``, ``"intent"``, and ``"response_text"``.
        Transactional results also contain ``"required_fields"``.

        Informational::

            {
                "route":         "informational",
                "intent":        "interest_rate_query",
                "response_text": "Here are our current interest rates. ...",
            }

        Transactional::

            {
                "route":           "transactional",
                "intent":          "open_account",
                "required_fields": ["full_name", "date_of_birth", ...],
                "response_text":   "To open a new bank account, I will need ...",
            }

    Raises
    ------
    RouterError
        If ``intent`` is not in ``ALL_INTENTS``.
    """
    if intent not in ALL_INTENTS:
        raise RouterError(
            f"Unknown intent '{intent}'. "
            f"Valid intents are: {sorted(ALL_INTENTS)}."
        )

    if intent in INFORMATIONAL_INTENTS:
        if intent == "interest_rate_query":
            response_text = _build_interest_rate_response()
        elif intent == "account_info_query":
            response_text = _build_account_info_response()
        else:  # check_balance
            response_text = _build_balance_response()

        return {
            "route":         "informational",
            "intent":        intent,
            "response_text": response_text,
        }

    # Transactional
    fields = REQUIRED_FIELDS[intent]
    return {
        "route":           "transactional",
        "intent":          intent,
        "required_fields": fields,
        "response_text":   _build_transactional_response(intent, fields),
    }
