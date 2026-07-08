# NLU Module — Design

## Overview

The NLU module is a self-contained Python package at `backend/nlu/`. It has four concerns:

1. **Dataset** — 300-sentence labeled JSON file + train/val/test split utilities
2. **Baseline classifier** — keyword-matching rule engine, no model download required
3. **Fine-tuned classifier** — DistilBERT sequence classification, trained and saved locally
4. **Evaluation & comparison** — accuracy/F1/confusion matrix for both classifiers on the same test split

The module follows the same patterns as STT and Translation: device auto-detection, singleton-cached public API, standalone scripts for training and evaluation.

---

## Architecture

```
backend/
└── nlu/
    ├── __init__.py            # Public API: classify()
    ├── intents.py             # INTENTS constant, label↔id maps
    ├── dataset.py             # Load JSON, stratified split, torch Dataset
    ├── keyword_classifier.py  # Rule-based baseline (no model)
    ├── distilbert_classifier.py  # DistilBERT wrapper (inference only)
    ├── train.py               # Fine-tuning script (run once, GPU)
    ├── evaluate.py            # Eval both models, emit comparison CSV + PNGs
    └── exceptions.py          # NLUInputError

data/
└── nlu_training_data.json     # 300 labeled sentences

models/
└── nlu-distilbert/            # Saved fine-tuned checkpoint (gitignored)
    ├── config.json
    ├── model.safetensors
    └── tokenizer/
```

---

## Components and Interfaces

### `intents.py` — Intent Registry

Single source of truth for all intent labels. Every other file imports from here — no hardcoded strings elsewhere.

```python
INTENTS = [
    "open_account",
    "check_balance",
    "apply_loan",
    "deposit_money",
    "withdraw_money",
    "account_info_query",
    "interest_rate_query",
]

LABEL2ID = {label: i for i, label in enumerate(INTENTS)}
ID2LABEL = {i: label for i, label in enumerate(INTENTS)}
NUM_CLASSES = len(INTENTS)
```

---

### `exceptions.py`

```python
class NLUInputError(Exception):
    """Raised when input to the NLU module is invalid (non-string, etc.)."""
    pass
```

---

### `dataset.py` — Data Loading and Splitting

**`load_dataset(path: str) -> list[dict]`**
- Load `data/nlu_training_data.json`
- Validate all entries have `"text"` and `"intent"` keys
- Validate all intent values are in `INTENTS`
- Return list of `{"text": str, "intent": str}` dicts

**`split_dataset(data, train_ratio=0.70, val_ratio=0.15, test_ratio=0.15, seed=42) -> tuple[list, list, list]`**
- Stratified split using `sklearn.model_selection.train_test_split`
- First split: train vs (val+test), stratified by intent
- Second split: val vs test from the remainder, stratified
- Returns `(train_data, val_data, test_data)`
- Prints split sizes and per-intent counts as a sanity check

**`BankingIntentDataset(torch.utils.data.Dataset)`**
- Wraps a list of `{"text", "intent"}` dicts
- `__getitem__` returns tokenized input_ids, attention_mask, and label id
- Used by the `DataLoader` in `train.py`

---

### `keyword_classifier.py` — Baseline Classifier

A deterministic rule engine. No model, no download, no training. Classifies by checking for the presence of domain keywords in the lowercased input.

**Keyword map** (designed to be non-overlapping within the 7-intent domain):

```python
KEYWORD_MAP = {
    "open_account":       ["open account", "new account", "create account", "start account"],
    "check_balance":      ["balance", "how much", "account balance", "funds"],
    "apply_loan":         ["loan", "apply loan", "loan application", "borrow"],
    "deposit_money":      ["deposit", "put money", "add money", "credit"],
    "withdraw_money":     ["withdraw", "take out", "cash out", "debit"],
    "account_info_query": ["statement", "atm", "card", "pin", "mobile number",
                           "cheque", "checkbook", "internet banking", "name",
                           "account number", "branch", "ifsc"],
    "interest_rate_query":["interest", "rate", "repayment", "emi", "fixed deposit",
                           "fd rate", "loan rate"],
}
```

**`KeywordClassifier.classify(text: str) -> tuple[str, float]`**

1. Lowercase the input
2. Count keyword matches per intent
3. Return the intent with the most matches and `confidence = matches / total_keywords_in_winner`
4. If no keywords match, return `("check_balance", 0.0)` — the most common intent is a safe default

**Why `check_balance` as fallback?** It's the most frequent banking query type and the least consequential to misclassify (informational, not transactional). Returning a low-confidence result rather than `None` satisfies AC-1.2 without crashing downstream.

---

### `distilbert_classifier.py` — Fine-Tuned Inference Wrapper

Wraps the saved DistilBERT checkpoint for inference. Separate from `train.py` so the production path never imports training dependencies.

```
DistilBERTClassifier
├── __init__(model_dir, device=None)
├── classify(text: str) -> tuple[str, float]
└── classify_batch(texts: list[str]) -> list[tuple[str, float]]
```

**`__init__`:**
- Auto-detect device: `"cuda" if torch.cuda.is_available() else "cpu"` — same pattern as STT and Translation
- Load `AutoTokenizer.from_pretrained(model_dir)`
- Load `AutoModelForSequenceClassification.from_pretrained(model_dir)`, move to device, set `.eval()`
- Raise `FileNotFoundError` with message pointing to `train.py` if `model_dir` doesn't exist

**`classify(text: str) -> tuple[str, float]`:**
1. Tokenize: `max_length=128, truncation=True, padding="max_length"`
2. Forward pass under `torch.inference_mode()`
3. Softmax over logits → probabilities
4. Return `(ID2LABEL[argmax], float(max_prob))`

**`classify_batch`:** same as above but batched, used by `evaluate.py`.

**`max_length=128`** — DistilBERT's max is 512, but banking queries are <30 words. 128 gives comfortable headroom while keeping inference fast.

---

### `train.py` — Fine-Tuning Script

Standalone script run **once** on the GPU dev machine. Not imported at inference time.

**Training configuration:**

| Hyperparameter | Value | Rationale |
|---|---|---|
| Base model | `distilbert-base-uncased` | 66M params, 6 layers — fast to fine-tune on 300 samples |
| Epochs | 10 (max), early stopping at 3 | Small dataset overfits quickly; early stopping prevents this |
| Batch size | 16 | Fits easily in 8 GB GPU |
| Learning rate | 2e-5 | Standard BERT fine-tuning range |
| Warmup steps | 10% of total steps | Prevents early divergence |
| Optimizer | AdamW | Canonical for transformer fine-tuning |
| Scheduler | Linear with warmup | Standard |
| Max sequence length | 128 | Sufficient for banking queries |
| Early stopping patience | 3 epochs on val accuracy | |

**Training loop (plain PyTorch, no Trainer API):**

Using the HuggingFace `Trainer` API adds complexity and obscures what's happening for a college report. Plain PyTorch is clearer and more demonstrable. The loop is:

```
for epoch in range(max_epochs):
    model.train()
    for batch in train_loader:
        optimizer.zero_grad()
        outputs = model(**batch)
        loss = outputs.loss
        loss.backward()
        optimizer.step()
        scheduler.step()

    # Validation
    model.eval()
    val_acc = evaluate_accuracy(model, val_loader)
    if val_acc > best_val_acc:
        best_val_acc = val_acc
        save_checkpoint(model, tokenizer, output_dir)
        patience_counter = 0
    else:
        patience_counter += 1
        if patience_counter >= PATIENCE:
            print("Early stopping triggered")
            break
```

**Output:** saved to `models/nlu-distilbert/` via `model.save_pretrained()` + `tokenizer.save_pretrained()`.

**CLI usage:**
```bash
python backend/nlu/train.py
python backend/nlu/train.py --data data/nlu_training_data.json --output models/nlu-distilbert --epochs 10
```

---

### `evaluate.py` — Comparison Script

Runs both classifiers on the **identical held-out test split**, ensuring fair comparison.

**To guarantee same test split:** `dataset.py`'s `split_dataset()` is seeded (`seed=42`). Both the training script and evaluation script call `split_dataset()` with the same seed, so the test set is always identical regardless of when evaluation runs.

**Functions:**

`evaluate_model(classifier, test_data) -> dict`
- Calls `classify()` on each test sample
- Collects `(true_label, predicted_label)` pairs
- Returns `{accuracy, per_class_report (dict), confusion_matrix (ndarray)}`

`compute_summary_metrics(true_labels, pred_labels) -> dict`
- Uses `sklearn.metrics.classification_report` with `output_dict=True`
- Extracts: accuracy, macro-avg F1, weighted-avg F1

`save_confusion_matrix(cm, labels, title, output_path)`
- Uses `seaborn.heatmap` with annotation
- Saves PNG to `output_path`
- Color scale: sequential blue (matches report aesthetic)

`save_comparison_csv(baseline_metrics, finetuned_metrics, output_path)`
- Writes CSV: `model, accuracy, macro_f1, weighted_f1`

`main()` with argparse:
- `--output-dir` (default: `models/nlu-distilbert/`)

---

### `__init__.py` — Public API

```python
from backend.nlu import classify

label, confidence = classify("What is my account balance?")
# ("check_balance", 0.97)
```

**`classify(text: str, model: str = "finetuned") -> tuple[str, float]`**

| `model` value | Classifier used |
|---|---|
| `"finetuned"` (default) | `DistilBERTClassifier` — loaded from `models/nlu-distilbert/` |
| `"baseline"` | `KeywordClassifier` — no model, instant |

- Returns `("", 0.0)` for empty/whitespace input (matches pattern of STT and Translation modules)
- Raises `NLUInputError` for non-string input
- Raises `FileNotFoundError` if `model="finetuned"` is requested but checkpoint doesn't exist yet
- Singleton cache: one `DistilBERTClassifier` instance per process

---

## Data Models

### `data/nlu_training_data.json`

```json
[
  {"text": "What is my account balance?", "intent": "check_balance"},
  {"text": "I want to apply for a home loan", "intent": "apply_loan"},
  ...
]
```

300 entries total, ~42–43 per intent. Must cover:
- Direct phrasings: "What is my balance?"
- Indirect phrasings: "Can you tell me how much I have?"
- Short forms: "Balance check"
- Banking jargon: "mini statement", "passbook", "FD"
- Realistic translation artifacts: slightly awkward English that IndicTrans2 would produce

---

## Correctness Properties

| ID | Property |
|----|----------|
| CP-1 | `classify("", ...)` returns `("", 0.0)` without exception |
| CP-2 | `classify("hello", model="baseline")` returns a valid intent label |
| CP-3 | `classify("What is my balance?")` with finetuned model returns `"check_balance"` with high confidence |
| CP-4 | Train/val/test split sizes are 210/45/45 (70/15/15 of 300), verified by assertion |
| CP-5 | All 7 intents appear in every split (stratification check) |
| CP-6 | Evaluation of both models uses the same test split (deterministic seed) |

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Non-string input | `NLUInputError("classify() expects str, got <type>")` |
| Empty/whitespace input | Returns `("", 0.0)` — no exception |
| `model="finetuned"` but checkpoint missing | `FileNotFoundError` with message: "Run `python backend/nlu/train.py` first" |
| Unknown `model` argument | `ValueError("Unknown model '...' — use 'baseline' or 'finetuned'")` |
| All-zero logits from model | Falls back to index 0 (`open_account`) with confidence 0.0 |

---

## Data Flow Diagram

```
[English text from translate_kn_to_en()]
           │
           ▼
    NLUInputError ◄── non-string or invalid input
           │ valid string
           ▼
    is empty? ──yes──► return ("", 0.0)
           │ no
           ▼
   model="baseline"?           model="finetuned"?
           │                          │
           ▼                          ▼
   KeywordClassifier         DistilBERTClassifier
   .classify(text)           .classify(text)
           │                          │
           ▼                          ▼
   (intent_label, confidence)  (intent_label, confidence)
           │                          │
           └──────────┬───────────────┘
                      ▼
            return (label, confidence)
                      │
                      ▼
            Decision Router (Module 4)
```

---

## Dependencies

New packages to add to `requirements.txt`:

| Package | Role |
|---------|------|
| `scikit-learn>=1.3` | Stratified split, classification metrics, confusion matrix |
| `seaborn>=0.13` | Confusion matrix heatmap PNG output |
| `matplotlib>=3.7` | Already installed — figure saving |

Already installed and compatible:
- `torch>=2.5.0` — training and inference
- `transformers>=4.51.0` — DistilBERT model + tokenizer
- `datasets>=2.0` — already installed (optional, used for dataset inspection)
- `accelerate>=0.20` — already installed (used internally by some transformers operations)

---

## Key Design Decisions

**Why keyword matching as baseline, not BART-large-mnli?**  
BART-large-mnli (1.6 GB, 400M params) requires 50+ GB RAM for CPU inference and takes minutes per sentence — completely incompatible with the 1-second latency target on 16 GB client hardware. Keyword matching is a standard and honest baseline in low-resource NLP: it shows what's achievable with zero training data on a domain-specific task.

**Why plain PyTorch training loop, not HuggingFace Trainer?**  
This is a college project where understanding the training loop matters. Plain PyTorch makes every step explicit and examinable. The Trainer API adds a large surface of arguments and behaviors that obscure the actual ML happening. The loop is ~60 lines of clear, readable code.

**Why `distilbert-base-uncased` and not `bert-base-uncased`?**  
DistilBERT is 40% smaller (66M vs 110M params), 60% faster at inference, and retains 97% of BERT's accuracy on GLUE. For a 300-sentence domain-specific dataset, the difference in capacity is irrelevant — DistilBERT will reach near-100% accuracy on this task. The speed advantage is real and matters for the 1-second CPU inference target.

**Why `max_length=128` for tokenization?**  
Banking queries translated from Kannada are short — typically 4–10 words in English. The 11 test phrases average 6 words. 128 tokens provides ample headroom while avoiding the quadratic attention cost of padding to 512.

**Why seed=42 for the split?**  
The same seed is used in both `train.py` and `evaluate.py`. This guarantees that when an examiner re-runs evaluation after training, they use the exact same 45 test sentences that training never saw. Reproducibility is essential for a fair comparison.

**Why save confusion matrix as PNG?**  
The PNG is the report-ready figure. Examiners expect to see it. seaborn's heatmap with annotation is the standard visualization for this task and takes 5 lines of code.
