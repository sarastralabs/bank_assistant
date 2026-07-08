# Implementation Plan: Decision Router

## Overview

Four tasks. No ML, no external dependencies. This is the simplest module in the pipeline — deterministic Python logic over a JSON file and two dictionaries.

## Tasks

- [ ] 1. Create bank_info.json and scaffolding
- [ ] 2. RouterError exception and routing constants
- [ ] 3. router.py — route() function and response builders
- [ ] 4. Public API, smoke test, and end-to-end pipeline test

## Task Dependency Graph

```
Task 1 (bank_info.json + scaffolding)
    └── Task 2 (RouterError + constants)
            └── Task 3 (router.py)
                    └── Task 4 (public API + tests)
```

Strictly sequential — each task builds on the previous.

## Notes

- No new pip dependencies needed. Pure Python stdlib + existing project packages.
- `bank_info.json` is the only data file this module needs. It must exist before Task 3 runs.
- The `response_text` field in every routing result is what the TTS module will speak — keep it natural and concise (1–3 sentences max).
- `REQUIRED_FIELDS` in `router.py` intentionally does NOT do entity extraction — it just specifies what fields are needed. Actual extraction is a future module.

---

### Task 1 — Create bank_info.json and Scaffolding

**Goal:** Create the banking content data file and the package directory structure.

- [ ] Create `backend/decision_router/` directory with placeholder `__init__.py`
- [ ] Create `data/bank_info.json` with the schema defined in design.md:
  - `interest_rates` — savings account, FD (1yr/3yr/5yr), home/personal/education/car loan rates
  - `loan_repayment.info` — EMI explanation text
  - `account_procedures` — name_change, mobile_update, atm_block, pin_change, cheque_book, internet_banking, mini_statement, branch_locator, nominee_update, general
  - `check_balance_note` — demo placeholder text
- [ ] Verify: `python -c "import json; d=json.load(open('data/bank_info.json')); print(list(d.keys()))"`
  should print `['interest_rates', 'loan_repayment', 'account_procedures', 'check_balance_note']`

**Deliverables:** `data/bank_info.json`, `backend/decision_router/__init__.py` (placeholder)

---

### Task 2 — RouterError and Routing Constants

**Goal:** Implement `exceptions.py` — minimal, same pattern as other modules.

- [ ] Implement `backend/decision_router/exceptions.py`:
  - `RouterError(Exception)` with docstring

- [ ] Verify: `from backend.decision_router.exceptions import RouterError` works

**Deliverables:** `backend/decision_router/exceptions.py`

---

### Task 3 — Core router.py

**Goal:** Implement the main routing logic.

- [ ] Implement `backend/decision_router/router.py`:

  - Module-level constants:
    - `INFORMATIONAL_INTENTS: frozenset`
    - `TRANSACTIONAL_INTENTS: frozenset`
    - `ALL_INTENTS: frozenset`
    - `REQUIRED_FIELDS: dict[str, list[str]]`

  - Module-level `_BANK_INFO: dict` — loaded from `data/bank_info.json` at import time
    - Raise `FileNotFoundError` with clear message if file missing

  - Private response builders:
    - `_build_interest_rate_response() -> str`
    - `_build_account_info_response(intent_context: str = "general") -> str`
      - Returns `general` procedures note; can be extended later with entity context
    - `_build_balance_response() -> str`
    - `_build_transactional_response(intent: str, fields: list[str]) -> str`

  - `route(intent: str) -> dict`:
    1. Validate `intent in ALL_INTENTS` → raise `RouterError` if not
    2. Route to informational or transactional path
    3. Return result dict with `route`, `intent`, `response_text` (always present)
       plus `required_fields` for transactional

- [ ] Manual check: call `route("interest_rate_query")` and `route("open_account")` from a Python prompt, verify dict structure

**Deliverables:** `backend/decision_router/router.py`

---

### Task 4 — Public API, Smoke Test, and Pipeline Integration

**Goal:** Wire up `__init__.py`, verify all 7 intents route correctly, and run a quick end-to-end pipeline test.

- [ ] Implement `backend/decision_router/__init__.py`:
  - Import and re-export `route` and `RouterError`
  - `__all__ = ["route", "RouterError"]`

- [ ] Smoke test — all 7 intents:
  ```python
  from backend.decision_router import route, RouterError

  # Informational
  assert route("check_balance")["route"]         == "informational"
  assert route("account_info_query")["route"]    == "informational"
  assert route("interest_rate_query")["route"]   == "informational"

  # Transactional
  assert route("open_account")["route"]          == "transactional"
  assert route("apply_loan")["route"]            == "transactional"
  assert route("deposit_money")["route"]         == "transactional"
  assert route("withdraw_money")["route"]        == "transactional"

  # Required fields present on transactional
  assert "required_fields" in route("open_account")
  assert "full_name" in route("open_account")["required_fields"]

  # response_text always present
  for intent in ["check_balance","account_info_query","interest_rate_query",
                 "open_account","apply_loan","deposit_money","withdraw_money"]:
      assert route(intent)["response_text"], f"empty response_text for {intent}"

  # Unknown intent raises RouterError
  try:
      route("transfer_money")
      assert False, "should have raised"
  except RouterError:
      pass
  ```

- [ ] End-to-end pipeline snippet (optional, confirms modules connect):
  ```python
  from backend.nlu import classify
  from backend.decision_router import route

  label, conf = classify("What is the interest rate on fixed deposit?")
  result = route(label)
  print(result["route"])         # informational
  print(result["response_text"]) # rates from bank_info.json
  ```

**Deliverables:** `backend/decision_router/__init__.py` (complete), all assertions passing
