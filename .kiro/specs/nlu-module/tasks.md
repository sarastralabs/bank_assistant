# Implementation Plan: NLU Module

## Overview

Nine tasks, ordered by dependency. Tasks 2 and 3 can be done in parallel after Task 1. Training (Task 6) depends on Tasks 1–5 being complete. Evaluation (Task 7) depends on both training and the baseline (Task 5).

## Tasks

- [ ] 1. Scaffolding, dependency audit, and training data creation
- [ ] 2. Intent registry and exceptions
- [ ] 3. Dataset loading, validation, and stratified split
- [ ] 4. Keyword baseline classifier
- [ ] 5. DistilBERT inference wrapper
- [ ] 6. Fine-tuning training script
- [ ] 7. Evaluation and comparison script
- [ ] 8. Public API with singleton cache
- [ ] 9. End-to-end smoke test and README

## Task Dependency Graph

```
Task 1 (scaffolding + data)
    ├── Task 2 (intents + exceptions)  ──────────────────────┐
    │       └── Task 3 (dataset)                             │
    │               ├── Task 4 (keyword baseline)            │
    │               ├── Task 5 (DistilBERT wrapper)          │
    │               └── Task 6 (training) ───────────────────┤
    │                       └── Task 7 (evaluation) ─────────┤
    │                                                         │
    └─────────────────────────────────────── Task 8 (public API) ──► Task 9 (smoke test)
```

Tasks 2 and 3 unblock Tasks 4, 5, and 6. Task 7 needs both Task 5 (for inference) and Task 6 (for the trained checkpoint). Task 9 is the final integration test.

## Notes

- `data/nlu_training_data.json` does not exist yet — Task 1 creates it. This is the **most important single deliverable** in the module: quality of training data directly determines fine-tuned model accuracy.
- Training runs on GPU (dev machine). The saved checkpoint is then used for CPU inference on the client machine.
- The keyword baseline requires no model download — it can be evaluated immediately after Task 4.
- Both classifiers must be evaluated on the **same** test split (guaranteed by `seed=42` in `split_dataset()`).
- `seaborn` is the only new dependency — all others are already installed.

---

### Task 1 — Scaffolding, Dependency Audit, and Training Data Creation

**Goal:** Create the directory structure, add missing dependencies to `requirements.txt`, and — most critically — create the 300-sentence labeled training dataset.

- [ ] Create `backend/nlu/` directory with placeholder `__init__.py`
- [ ] Add to `requirements.txt`:
  - `seaborn>=0.13` (only new package needed; scikit-learn, matplotlib already installed)
- [ ] Create `data/nlu_training_data.json` with **300 labeled sentences** across 7 intents (~42–43 per intent):

  ```json
  [
    {"text": "What is my account balance?", "intent": "check_balance"},
    {"text": "I want to apply for a home loan", "intent": "apply_loan"},
    ...
  ]
  ```

  **Per-intent sentence guidelines:**

  - `open_account` (~43): "I want to open an account", "How do I start a new account", "Open a savings account for me", "I need to create a bank account", variations with "new account", "savings account", "current account", "joint account"
  - `check_balance` (~43): "What is my balance", "How much money do I have", "Check my account balance", "Tell me my current balance", "What are my available funds", "Show me my balance", variants with "account balance", "how much is left"
  - `apply_loan` (~43): "I want a loan", "Apply for home loan", "How do I get a loan", "I need to borrow money", "Personal loan application", "Car loan", "Education loan", "How to apply for a loan"
  - `deposit_money` (~43): "I want to deposit cash", "How do I put money in", "Deposit five thousand rupees", "Add money to account", "Credit my account", "I want to add funds"
  - `withdraw_money` (~43): "I want to withdraw money", "Take out cash", "Withdraw five hundred", "I need to take money out", "Cash withdrawal", "Debit from account"
  - `account_info_query` (~43): "I need a mini statement", "Block my ATM card", "Change my PIN", "Update my mobile number", "I need a cheque book", "Activate internet banking", "Change my name", "What is my account number", "Where is the nearest branch", "IFSC code query", "Passbook update"
  - `interest_rate_query` (~43): "What is the interest rate", "How much is the loan repayment", "What is the FD rate", "Fixed deposit interest", "What is the EMI", "Loan interest rate query", "How much interest will I pay"

  **Important for quality:** Include translation-artifact phrasings that IndicTrans2 would realistically produce (slightly formal/passive, e.g. "Balance in my account is to be checked", "Loan application how to be done") alongside natural English phrasings. The model will see real IndicTrans2 output at runtime, so training data should represent both styles.

- [ ] Validate the file: run a quick Python check that all 300 entries have valid `text` and `intent` fields, no intent outside the 7 defined, and count per-intent is roughly balanced

**Deliverables:** `backend/nlu/__init__.py` (placeholder), `data/nlu_training_data.json` (300 entries), updated `requirements.txt`

---

### Task 2 — Intent Registry and Exceptions

**Goal:** Implement `intents.py` and `exceptions.py` — no dependencies, can be done in parallel with Task 3.

- [ ] Implement `backend/nlu/intents.py`:
  - `INTENTS` list (7 labels, ordered consistently)
  - `LABEL2ID` and `ID2LABEL` dicts
  - `NUM_CLASSES = 7`

- [ ] Implement `backend/nlu/exceptions.py`:
  - `NLUInputError(Exception)` with docstring

- [ ] Verify: `from backend.nlu.intents import INTENTS, LABEL2ID, ID2LABEL` works without error

**Deliverables:** `backend/nlu/intents.py`, `backend/nlu/exceptions.py`

---

### Task 3 — Dataset Loading, Validation, and Stratified Split

**Goal:** Implement `dataset.py` — the data pipeline used by training, evaluation, and sanity checks.

**Prerequisite:** Task 1 (training data file must exist)

- [ ] Implement `backend/nlu/dataset.py`:
  - `load_dataset(path: str) -> list[dict]`
    - Load JSON, validate fields, raise `ValueError` on bad entries
    - Print intent distribution as a sanity check
  - `split_dataset(data, train_ratio=0.70, val_ratio=0.15, test_ratio=0.15, seed=42) -> tuple`
    - Use `sklearn.model_selection.train_test_split` with `stratify=` parameter
    - Assert resulting split sizes are approximately 210/45/45
    - Assert all 7 intents appear in every split
    - Print final split stats
  - `BankingIntentDataset(torch.utils.data.Dataset)`
    - `__init__(data: list[dict], tokenizer, max_length=128)`
    - `__len__` returns number of examples
    - `__getitem__` tokenizes text and returns `{input_ids, attention_mask, labels}`

- [ ] Smoke test: load `nlu_training_data.json`, split, verify sizes match 210/45/45

**Deliverables:** `backend/nlu/dataset.py`

---

### Task 4 — Keyword Baseline Classifier

**Goal:** Implement `keyword_classifier.py` — the zero-training baseline.

**Prerequisite:** Task 2 (imports from `intents.py`)

- [ ] Implement `backend/nlu/keyword_classifier.py`:
  - `KEYWORD_MAP` dict mapping each intent to its keyword list (as per design.md)
  - `KeywordClassifier` class:
    - `classify(text: str) -> tuple[str, float]`
      - Lowercase text, count matches per intent using `in` substring matching
      - Resolve ties by picking the first match in `INTENTS` order
      - Return `("check_balance", 0.0)` if no matches
      - Confidence = `match_count / len(KEYWORD_MAP[winner])` (fraction of keywords matched)
    - No `__init__` needed — pure stateless computation

- [ ] Manual test: classify 7 obvious test sentences (one per intent) and verify all return the correct intent

**Deliverables:** `backend/nlu/keyword_classifier.py`

---

### Task 5 — DistilBERT Inference Wrapper

**Goal:** Implement `distilbert_classifier.py` — the inference-only wrapper for the saved checkpoint.

**Prerequisite:** Task 2 (imports from `intents.py`)

Note: This can be code-reviewed before the checkpoint exists. The real model is needed only for Task 9 (smoke test).

- [ ] Implement `backend/nlu/distilbert_classifier.py`:
  - `DistilBERTClassifier.__init__(model_dir: str, device: str | None = None)`
    - Auto-detect device: `"cuda" if torch.cuda.is_available() else "cpu"`
    - Load `AutoTokenizer.from_pretrained(model_dir)`
    - Load `AutoModelForSequenceClassification.from_pretrained(model_dir).to(device).eval()`
    - Raise `FileNotFoundError` with message pointing to `train.py` if `model_dir` not found
  - `DistilBERTClassifier.classify(text: str) -> tuple[str, float]`
    - Tokenize with `max_length=128, truncation=True, padding="max_length", return_tensors="pt"`
    - Forward pass under `torch.inference_mode()`
    - Softmax → argmax → return `(ID2LABEL[pred], float(confidence))`
  - `DistilBERTClassifier.classify_batch(texts: list[str]) -> list[tuple[str, float]]`
    - Batch tokenize, single forward pass, return list of `(label, confidence)` tuples

- [ ] Verify with mock: patch `AutoModelForSequenceClassification` and confirm the class is importable and interface is correct without loading real weights

**Deliverables:** `backend/nlu/distilbert_classifier.py`

---

### Task 6 — Fine-Tuning Training Script

**Goal:** Fine-tune `distilbert-base-uncased` on the 300-sentence banking dataset using a plain PyTorch training loop.

**Prerequisites:** Tasks 3, 5 complete. GPU recommended (will also run on CPU, slower).

- [ ] Implement `backend/nlu/train.py`:
  - Load dataset, split with `seed=42`
  - Instantiate `AutoTokenizer.from_pretrained("distilbert-base-uncased")`
  - Instantiate `AutoModelForSequenceClassification.from_pretrained("distilbert-base-uncased", num_labels=7, id2label=ID2LABEL, label2id=LABEL2ID)`
  - Create `BankingIntentDataset` for train and val splits
  - Create `DataLoader` with `batch_size=16, shuffle=True` for train; `shuffle=False` for val
  - Training loop (plain PyTorch):
    - Optimizer: `AdamW(model.parameters(), lr=2e-5, weight_decay=0.01)`
    - Scheduler: `get_linear_schedule_with_warmup` (10% warmup steps)
    - Max epochs: 10, early stopping patience: 3 on val accuracy
    - Log loss and val accuracy each epoch
    - Save best checkpoint via `model.save_pretrained()` + `tokenizer.save_pretrained()`
  - After training: print final val accuracy and location of saved checkpoint
  - `argparse` CLI: `--data`, `--output` (default: `models/nlu-distilbert`), `--epochs`, `--batch-size`, `--lr`

- [ ] Expected training time: <5 minutes on an 8 GB GPU for 10 epochs on 210 training sentences

**Deliverables:** `backend/nlu/train.py`

---

### Task 7 — Evaluation and Comparison Script

**Goal:** Evaluate both classifiers on the identical test split and emit the comparison table + confusion matrix PNGs.

**Prerequisites:** Task 4 (keyword baseline), Task 5 (DistilBERT wrapper), Task 6 (trained checkpoint)

- [ ] Implement `backend/nlu/evaluate.py`:
  - `evaluate_model(classifier, test_data) -> dict`
    - Loop test samples, call `classifier.classify(text)`
    - Collect true/predicted labels
    - Compute with `sklearn.metrics.classification_report(output_dict=True)`:
      - accuracy, macro-avg F1, weighted-avg F1, per-class precision/recall/F1
    - Return metrics dict
  - `save_confusion_matrix(true_labels, pred_labels, model_name, output_dir)`
    - Build confusion matrix with `sklearn.metrics.confusion_matrix`
    - Plot with `seaborn.heatmap(annot=True, fmt="d", cmap="Blues")`
    - Save as `{output_dir}/{model_name}_confusion_matrix.png`
    - Use `INTENTS` as tick labels on both axes
  - `save_comparison_csv(baseline_metrics, finetuned_metrics, output_path)`
    - Write CSV: `model, accuracy, macro_f1, weighted_f1`
    - Also print formatted table via `tabulate`
  - `main()` with argparse:
    - `--output-dir` (default: `models/nlu-distilbert/`)
    - `--data` (default: `data/nlu_training_data.json`)

- [ ] Expected output files:
  - `models/nlu-distilbert/baseline_confusion_matrix.png`
  - `models/nlu-distilbert/finetuned_confusion_matrix.png`
  - `models/nlu-distilbert/nlu_comparison_results.csv`

**Deliverables:** `backend/nlu/evaluate.py`

---

### Task 8 — Public API with Singleton Cache

**Goal:** Expose a clean `classify()` function matching the pattern of STT and Translation modules.

- [ ] Implement `backend/nlu/__init__.py`:
  - Singleton: `_classifier_cache: dict[str, Any]`
  - `MODEL_DIR = os.path.join(_PROJECT_ROOT, "models", "nlu-distilbert")`
  - `classify(text: str, model: str = "finetuned") -> tuple[str, float]`
    - Return `("", 0.0)` for empty/whitespace (no model load, no exception)
    - Raise `NLUInputError` for non-string
    - Raise `ValueError` for unknown `model` argument
    - Lazy-load: for `"baseline"` instantiate `KeywordClassifier` (stateless, cached);
      for `"finetuned"` instantiate `DistilBERTClassifier(MODEL_DIR)` (heavy, definitely cache)
    - Delegate to cached classifier's `.classify(text)`
  - `__all__ = ["classify", "NLUInputError", "INTENTS"]`

**Deliverables:** `backend/nlu/__init__.py` (complete)

---

### Task 9 — End-to-End Smoke Test and README

**Goal:** Verify the full NLU module works with the trained checkpoint, and document it.

**Prerequisite:** All Tasks 1–8 complete, model trained.

- [ ] Run end-to-end smoke test:
  ```python
  from backend.nlu import classify

  # Finetuned model
  label, conf = classify("What is my account balance?")
  assert label == "check_balance", f"Got {label}"
  assert conf > 0.8

  # Baseline
  label, conf = classify("I want to apply for a loan", model="baseline")
  assert label == "apply_loan"

  # Empty input
  label, conf = classify("")
  assert label == "" and conf == 0.0
  ```
- [ ] Run `python -m backend.nlu.evaluate` — confirm CSV and 2 PNG files are created
- [ ] Verify confusion matrices look reasonable (diagonal should dominate for fine-tuned model)
- [ ] Write `backend/nlu/README.md` covering:
  - Training data format and how to create it
  - How to train: `python backend/nlu/train.py`
  - How to evaluate: `python backend/nlu/evaluate.py`
  - Expected accuracy ranges (baseline vs fine-tuned)
  - API usage with examples

**Deliverables:** Passing smoke test, `nlu_comparison_results.csv`, 2 PNG confusion matrices, `backend/nlu/README.md`
