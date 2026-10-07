"""Kannada keyword hints: repayment questions must not route to apply_loan."""
from __future__ import annotations

import os

import pytest

os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

from backend.nlu.kannada_keywords import match_kannada_intent  # noqa: E402


@pytest.mark.parametrize(
    ("kannada", "english"),
    [
        ("ಸಾಲದ ಮರುಪಾವತಿ ಮೊತ್ತ ಎಷ್ಟು?", "How much is the loan repayment amount?"),
        # Real STT output for clip_014 (trailing word half-heard)
        ("ಲೋನ್ ಮರುಪಾವತಿ ಎಸ್", "Loan repayment S"),
        ("", "How do I repay my home loan"),
    ],
)
def test_repayment_routes_to_interest_rate_query(kannada: str, english: str) -> None:
    hit = match_kannada_intent(kannada, english)
    assert hit is not None
    assert hit[0] == "interest_rate_query"


@pytest.mark.parametrize(
    ("kannada", "english"),
    [
        ("ಸಾಲ ಬೇಕು", "I want a loan"),
        ("ಸಾಲ ಅರ್ಜಿ ಹೇಗೆ ಮಾಡಬೇಕು", "How to apply for a loan"),
        ("", "I want a home loan"),
    ],
)
def test_loan_requests_still_route_to_apply_loan(kannada: str, english: str) -> None:
    hit = match_kannada_intent(kannada, english)
    assert hit is not None
    assert hit[0] == "apply_loan"


def test_repayment_answer_is_repayment_info_not_full_rate_list() -> None:
    from backend.decision_router import route

    out = route(
        "interest_rate_query",
        "Loan repayment S",
        kannada_text="ಲೋನ್ ಮರುಪಾವತಿ ಎಸ್",
    )
    assert out["route"] == "informational"
    assert out["response_text"].startswith("Loan repayment amount")
    assert "ಮರುಪಾವತಿ" in out["response_text_kn"]

    # Plain rate question still gets the full list.
    rates = route("interest_rate_query", "What are your interest rates?")
    assert rates["response_text"].startswith("Here are our current interest rates")
