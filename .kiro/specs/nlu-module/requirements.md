# NLU Module — Requirements

## Overview

Build an intent classification module that takes English text (output of the Translation module) and classifies it into one of 7 banking intents. The module implements **two approaches** for a controlled baseline-vs-fine-tuned comparison: (1) a keyword-matching baseline requiring no model download, and (2) a DistilBERT model fine-tuned on a labeled dataset of 300 banking sentences. This comparison is the core ML contribution and evidence for the project report.

This is Module 3 in the pipeline:

```
Kannada audio → STT → Translation → [NLU] → intent label → Decision Router
```

---

## Intents (7 classes)

| Intent label | Meaning |
|---|---|
| `open_account` | User wants to open a new bank account |
| `check_balance` | User wants to know account balance |
| `apply_loan` | User wants to apply for a loan |
| `deposit_money` | User wants to deposit money |
| `withdraw_money` | User wants to withdraw money |
| `account_info_query` | User asking about account details (name, number, statement, card, PIN, mobile number) |
| `interest_rate_query` | User asking about interest rates, loan repayment, FD rates |

---

## Functional Requirements

### US-1: Classify Intent from English Text

**As a** developer building the decision router,  
**I want** English banking queries classified into one of 7 intents,  
**so that** downstream logic can decide informational vs transactional handling.

#### Acceptance Criteria

| ID | Condition | System Behaviour |
|----|-----------|-----------------|
| AC-1.1 | WHEN an English text string is provided | THE SYSTEM SHALL return one of the 7 defined intent labels plus a confidence score (0–1) |
| AC-1.2 | WHEN the text doesn't clearly match any intent | THE SYSTEM SHALL still return its best-guess label with a low confidence score — no crash, no `None` |
| AC-1.3 | WHEN classification runs on CPU-only hardware | THE SYSTEM SHALL return a result within **1 second** per query |

---

### US-2: Keyword-Matching Baseline Classifier

**As a** project evaluator,  
**I want** to see how a rule-based baseline performs with zero ML training,  
**so that** the value of fine-tuning DistilBERT is demonstrable by comparison.

#### Acceptance Criteria

| ID | Condition | System Behaviour |
|----|-----------|-----------------|
| AC-2.1 | WHEN the keyword baseline is evaluated on the held-out test split | THE SYSTEM SHALL report accuracy and per-class F1 |
| AC-2.2 | WHEN no keyword matches | THE SYSTEM SHALL return a fallback label (`check_balance`) with confidence `0.0` |

**Why keyword matching, not BART-large-mnli:**  
`facebook/bart-large-mnli` (1.6 GB, 400M parameters) is the canonical zero-shot NLI classifier but requires >50 GB RAM for CPU inference and takes minutes per sentence — incompatible with both the latency target (AC-1.3) and the 16 GB client hardware. A keyword-matching baseline is a legitimate and commonly-used comparison approach in low-resource NLP papers, and it is the honest baseline for a 300-sentence domain-specific dataset: it demonstrates what is achievable with zero training data.

---

### US-3: Fine-Tuned DistilBERT Classifier

**As the** ML contribution of this project,  
**I want** a DistilBERT model fine-tuned on the labeled banking dataset,  
**so that** classification accuracy measurably exceeds the keyword baseline.

#### Acceptance Criteria

| ID | Condition | System Behaviour |
|----|-----------|-----------------|
| AC-3.1 | WHEN training begins | THE SYSTEM SHALL load `data/nlu_training_data.json` (300 labeled sentences, 7 intents) |
| AC-3.2 | WHEN splitting data | THE SYSTEM SHALL split 70/15/15 (train/val/test) with **stratified sampling** so each split has proportional representation of all 7 intents |
| AC-3.3 | WHEN training on GPU | THE SYSTEM SHALL fine-tune `distilbert-base-uncased` with a sequence classification head, using the val split for early stopping |
| AC-3.4 | WHEN training completes | THE SYSTEM SHALL save the best checkpoint (by val accuracy) to `models/nlu-distilbert/` |
| AC-3.5 | WHEN evaluated on the held-out test split | THE SYSTEM SHALL report accuracy, per-class precision/recall/F1, and save a confusion matrix PNG |
| AC-3.6 | WHEN loaded for inference on CPU-only hardware | THE SYSTEM SHALL load the saved checkpoint and classify within 1 second |

---

### US-4: Baseline vs Fine-Tuned Comparison Report

**As a** project evaluator,  
**I want** a clear side-by-side comparison table,  
**so that** the improvement from fine-tuning is quantifiable for the report.

#### Acceptance Criteria

| ID | Condition | System Behaviour |
|----|-----------|-----------------|
| AC-4.1 | WHEN both models have been evaluated on the **same test split** | THE SYSTEM SHALL output a comparison CSV with columns: `model, accuracy, macro_f1, weighted_f1` |
| AC-4.2 | WHEN evaluation completes | THE SYSTEM SHALL save both confusion matrices as PNG images in `models/nlu-distilbert/` |
| AC-4.3 | WHEN the comparison script runs | THE SYSTEM SHALL print a formatted table to stdout |

---

## Training Data

- File: `data/nlu_training_data.json`
- Format: list of `{"text": "...", "intent": "..."}` objects
- Size: 300 sentences, 7 intents (~42–43 per intent)
- Must be created before training (Task 1 of implementation)

---

## Out of Scope

- Entity/slot extraction (separate, smaller deliverable — spaCy-based)
- Multi-label classification (each query has exactly one intent)
- Online/continuous learning after deployment
- Fine-tuning any model larger than DistilBERT on this hardware
- Any paid API or cloud service

---

## Constraints

| Constraint | Detail |
|------------|--------|
| Hardware (training) | 8 GB GPU (CUDA), 24 GB RAM |
| Hardware (inference) | 8-core CPU, 16 GB RAM, no GPU |
| Training time | Must complete in <30 minutes on 8 GB GPU |
| Inference latency | ≤ 1 second on CPU (AC-1.3) |
| Dataset size | 300 sentences — no external datasets |
| Libraries | scikit-learn, transformers, torch, matplotlib, seaborn |

---

## Dependencies on Other Modules

| Module | Relationship |
|--------|-------------|
| Translation (Module 2) | Provides English text as input via `translate_kn_to_en()` |
| Decision Router (Module 4) | Consumes intent label output |
