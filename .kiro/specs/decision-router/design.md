# Decision Router — Design

## Overview

The Decision Router is a stateless Python package at `backend/decision_router/`. It has no ML dependencies and no mutable state. All logic is deterministic dictionary lookups and a single JSON file load at startup.

---

## Architecture

```
backend/
└── decision_router/
    ├── __init__.py       # Public API: route()
    ├── router.py         # Core routing logic and constants
    └── exceptions.py     # RouterError

data/
└── bank_info.json        # Banking FAQ and rates content (created in Task 1)
```

---

## Components and Interfaces

### `exceptions.py`

```python
class RouterError(Exception):
    """Raised when an unrecognised intent is passed to the router."""
    pass
```

---

### `bank_info.json` — Content Schema

This file is the single source of banking content for informational responses. It is loaded once at module import time and cached as a module-level dict. Structure:

```json
{
  "interest_rates": {
    "savings_account":     "3.5% per annum",
    "fixed_deposit_1yr":   "6.5% per annum",
    "fixed_deposit_3yr":   "7.0% per annum",
    "fixed_deposit_5yr":   "7.25% per annum",
    "home_loan":           "8.5% per annum (floating)",
    "personal_loan":       "11.0% per annum",
    "education_loan":      "9.0% per annum",
    "car_loan":            "9.5% per annum"
  },
  "loan_repayment": {
    "info": "Loan repayment EMI depends on principal, interest rate, and tenure. Visit the nearest branch or use our EMI calculator at the branch kiosk."
  },
  "account_procedures": {
    "name_change":         "To change your name, submit a written request with a gazette notification or marriage certificate at your home branch.",
    "mobile_update":       "Visit any branch with your Aadhaar card to update your registered mobile number.",
    "atm_block":           "To block your ATM card immediately, call our 24/7 helpline: 1800-XXX-XXXX.",
    "pin_change":          "Change your ATM PIN at any branch ATM using your current PIN and registered mobile OTP.",
    "cheque_book":         "Submit a cheque book request at the branch or via net banking. Allow 5-7 working days.",
    "internet_banking":    "To activate internet banking, visit the branch with a photo ID and fill in the activation form.",
    "mini_statement":      "Get your last 5 transactions via ATM, SMS banking (SMS BAL to XXXXX), or branch visit.",
    "branch_locator":      "Use the Branch Locator on our website or ask at any branch for the nearest location.",
    "nominee_update":      "To update nominee details, fill in Form DA-1 at your home branch with a witness.",
    "general":             "For account-related queries not listed here, please visit your nearest branch with a valid photo ID."
  },
  "check_balance_note":   "Real-time balance lookup is not available in this demo. In production, this would connect to the core banking system. Please visit a branch or ATM for your current balance."
}
```

---

### `router.py` — Core Routing Logic

All routing constants and the `route()` function live here.

**Constants (single source of truth — never hardcode intent strings elsewhere):**

```python
INFORMATIONAL_INTENTS = frozenset({
    "check_balance",
    "account_info_query",
    "interest_rate_query",
})

TRANSACTIONAL_INTENTS = frozenset({
    "open_account",
    "apply_loan",
    "deposit_money",
    "withdraw_money",
})

ALL_INTENTS = INFORMATIONAL_INTENTS | TRANSACTIONAL_INTENTS

REQUIRED_FIELDS = {
    "open_account":   ["full_name", "date_of_birth", "address", "account_type"],
    "apply_loan":     ["full_name", "loan_type", "loan_amount", "income"],
    "deposit_money":  ["account_number", "amount"],
    "withdraw_money": ["account_number", "amount"],
}
```

**`route(intent: str) -> dict`**

Returns a routing result dict. Schema varies by route type:

*Informational result:*
```python
{
    "route":         "informational",
    "intent":        "interest_rate_query",
    "response_text": "Savings Account: 3.5% per annum\nFixed Deposit (1yr): 6.5% per annum\n...",
}
```

*Transactional result:*
```python
{
    "route":            "transactional",
    "intent":           "open_account",
    "required_fields":  ["full_name", "date_of_birth", "address", "account_type"],
    "response_text":    "To open an account, I will need to collect the following details: full name, date of birth, address, account type.",
}
```

**Logic:**

```
1. Validate intent is in ALL_INTENTS → raise RouterError if not
2. If intent in INFORMATIONAL_INTENTS:
   a. Build response_text from _BANK_INFO (loaded from bank_info.json)
   b. Return {"route": "informational", "intent": ..., "response_text": ...}
3. If intent in TRANSACTIONAL_INTENTS:
   a. Look up REQUIRED_FIELDS[intent]
   b. Build human-readable response_text listing the required fields
   c. Return {"route": "transactional", "intent": ..., "required_fields": [...], "response_text": ...}
```

**Response text builders (private helpers):**

- `_build_interest_rate_response(bank_info) -> str` — formats all rates as a readable string
- `_build_account_info_response(bank_info) -> str` — returns the general procedures note
- `_build_balance_response(bank_info) -> str` — returns the demo placeholder
- `_build_transactional_response(intent, fields) -> str` — "To [action], I need: [fields]"

---

### `__init__.py` — Public API

```python
from backend.decision_router import route

result = route("interest_rate_query")
# {
#   "route": "informational",
#   "intent": "interest_rate_query",
#   "response_text": "Savings Account: 3.5% per annum\n..."
# }

result = route("open_account")
# {
#   "route": "transactional",
#   "intent": "open_account",
#   "required_fields": ["full_name", "date_of_birth", "address", "account_type"],
#   "response_text": "To open an account, I will need: full name, date of birth, ..."
# }
```

Thin wrapper — just imports and re-exports `route` from `router.py`.

---

## Data Flow

```
NLU output: intent = "interest_rate_query"
                │
                ▼
        route(intent)
                │
                ├── intent not in ALL_INTENTS? → RouterError
                │
                ├── INFORMATIONAL?
                │       └── lookup bank_info.json → build response_text
                │               └── return {route, intent, response_text}
                │
                └── TRANSACTIONAL?
                        └── lookup REQUIRED_FIELDS
                                └── return {route, intent, required_fields, response_text}
```

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Unknown intent string | `RouterError("Unknown intent '...' — valid intents: [...]")` |
| `bank_info.json` missing at startup | `FileNotFoundError` at module import time with message pointing to the data file |
| Empty intent string | `RouterError` (caught by the unknown-intent check) |

---

## Key Design Decisions

**Why load `bank_info.json` at module import time, not per-call?**
The file is tiny (<2 KB), never changes at runtime, and loading it per-call would add an unnecessary file I/O on every query. Module-level loading means it's read once and cached for the process lifetime — consistent with how other modules cache their models.

**Why include `response_text` in both informational and transactional results?**
The downstream TTS module needs a text string to speak regardless of route type. For informational queries it's the answer; for transactional queries it's a prompt listing what information will be collected. Including it in the routing result means the TTS module never needs to know the route type — it just reads `result["response_text"]`.

**Why frozensets for intent categories?**
`frozenset` membership testing is O(1) and communicates immutability at the type level. The intent category lists must never be modified at runtime — a frozenset enforces this.
