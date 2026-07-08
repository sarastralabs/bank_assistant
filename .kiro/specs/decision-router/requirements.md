# Decision Router — Requirements

## Overview

Given an intent label (from the NLU module) the Decision Router determines:
1. Whether the query is **informational** (answer from `bank_info.json`) or **transactional** (collect details, generate a form)
2. For informational intents: what the answer is
3. For transactional intents: what entity fields must be collected before the form can be generated

This is pure Python logic — no ML models, no external API calls, no ML dependencies. It is the glue between the NLU output and the response/form generation stages.

Pipeline position:
```
NLU (intent) → [DECISION ROUTER] → informational answer  → Translation → TTS
                                  → transactional spec    → Form Generator
```

---

## Intent Categories

| Category | Intents |
|----------|---------|
| **INFORMATIONAL** | `check_balance`, `account_info_query`, `interest_rate_query` |
| **TRANSACTIONAL** | `open_account`, `apply_loan`, `deposit_money`, `withdraw_money` |

---

## Functional Requirements

### US-1: Route Based on Intent

**As the** pipeline orchestrator,
**I want** each classified intent routed to the correct handling path,
**so that** the system knows whether to answer a question or start a form-filling flow.

| ID | Condition | System Behaviour |
|----|-----------|-----------------|
| AC-1.1 | WHEN an intent from the informational set is provided | THE SYSTEM SHALL return `route="informational"` |
| AC-1.2 | WHEN an intent from the transactional set is provided | THE SYSTEM SHALL return `route="transactional"` |
| AC-1.3 | WHEN an unrecognised intent string is provided | THE SYSTEM SHALL raise `RouterError` with a descriptive message — never silently default |

---

### US-2: Fetch Informational Responses

**As a** user asking a question,
**I want** a relevant answer pulled from the bank's published info,
**so that** I get useful information without unnecessary data collection.

| ID | Condition | System Behaviour |
|----|-----------|-----------------|
| AC-2.1 | WHEN `intent="interest_rate_query"` | THE SYSTEM SHALL return the relevant rate(s) from `data/bank_info.json` as a human-readable string |
| AC-2.2 | WHEN `intent="account_info_query"` | THE SYSTEM SHALL return the relevant FAQ/process information from `bank_info.json` |
| AC-2.3 | WHEN `intent="check_balance"` | THE SYSTEM SHALL return a documented placeholder response — real-time balance lookup is explicitly out of scope for this demo |

---

### US-3: Required Entity Fields for Transactional Flows

**As the** form-filling stage,
**I want** to know which fields are required for a given transactional intent,
**so that** the system knows what to ask the user.

| ID | Condition | System Behaviour |
|----|-----------|-----------------|
| AC-3.1 | WHEN `intent="open_account"` | THE SYSTEM SHALL return `required_fields=["full_name", "date_of_birth", "address", "account_type"]` |
| AC-3.2 | WHEN `intent="apply_loan"` | THE SYSTEM SHALL return `required_fields=["full_name", "loan_type", "loan_amount", "income"]` |
| AC-3.3 | WHEN `intent="deposit_money"` | THE SYSTEM SHALL return `required_fields=["account_number", "amount"]` |
| AC-3.4 | WHEN `intent="withdraw_money"` | THE SYSTEM SHALL return `required_fields=["account_number", "amount"]` |
| AC-3.5 | WHEN route="transactional" | THE SYSTEM SHALL return the required fields list as part of the routing result, not as a separate call |

---

## Out of Scope

- Actual entity extraction (spaCy-based NER — future module)
- Multi-turn conversation state management
- Real banking system integration (explicitly a demo limitation)
- Dynamic routing based on user context or history

---

## Test Data

- `data/bank_info.json` — created in Task 1 of this module (does not exist yet)
- All 7 intents tested: correct `route`, correct `response_text` or `required_fields`

---

## Constraints

| Constraint | Detail |
|------------|--------|
| No ML | Pure Python — dicts and functions only |
| No new dependencies | Only stdlib + existing project packages |
| Latency | Effectively instant — dictionary lookups only |
