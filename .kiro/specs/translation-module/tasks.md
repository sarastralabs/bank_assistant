# Implementation Plan: Translation Module

## Overview

Eight tasks, ordered by dependency. Each task touches one or two files and is independently reviewable. Tasks 2 and 5 can be done in parallel after Task 1 completes.

## Tasks

- [ ] 1. Dependency audit and scaffolding
- [ ] 2. Exceptions and utilities
- [ ] 3. Core translator class
- [ ] 4. Public API with singleton cache
- [ ] 5. Reference translation test data
- [ ] 6. Unit tests
- [ ] 7. Benchmark script
- [ ] 8. End-to-end smoke test and README

## Task Dependency Graph

```
Task 1 (scaffolding + deps)
    ├── Task 2 (exceptions + utils)  ←──────────────────┐
    │       └── Task 3 (IndicTranslator)                 │
    │               └── Task 4 (public API)              │
    │                       └── Task 7 (benchmark) ──────┤
    │                               └── Task 8 (smoke)   │
    └── Task 5 (reference translations) ─────────────────┘
                └── Task 6 (unit tests) ─── Task 8
```

Tasks 2 and 5 can be worked in parallel after Task 1.

## Notes

- IndicTransToolkit is not officially supported on Windows. If developing on Windows, install inside WSL2 or use `pip install indictranstoolkit --no-build-isolation`. The client deployment target (Linux) is fully supported.
- Model download happens automatically on first `from_pretrained()` call — no separate conversion script is needed (unlike the STT module).
- Both 200M models together require ~1.6 GB RAM — well within the 16 GB client budget.
- `num_beams=5` is used everywhere (including the public API default) because banking sentences are short enough to stay within the 3-second latency target even on CPU.

---

### Task 1 — Dependency Audit and Scaffolding

**Goal:** Create directory structure, update `requirements.txt` with new dependencies, and verify all required packages install correctly.

- [ ] Create `backend/translation/` directory with empty `__init__.py`
- [ ] Create `data/translation_test/` directory with placeholder `reference_translations.json` (`{}`)
- [ ] Update `requirements.txt`:
  - Add `indictranstoolkit>=1.1`
  - Add `sacrebleu>=2.4`
  - Add `sentencepiece>=0.1.99`
  - Bump `transformers>=4.51.0` (IndicTransToolkit recommends ≥4.51)
  - Bump `torch>=2.5.0` (IndicTransToolkit recommends ≥2.5)
  - Bump `numpy>=2.1` (IndicTransToolkit recommends ≥2.1)
- [ ] Verify no version conflicts between updated packages and existing STT dependencies (`faster-whisper`, `ctranslate2`)
- [ ] Confirm `indictranstoolkit` installs and imports cleanly:
  - **Linux/macOS:** `pip install indictranstoolkit`
  - **Windows (required flag):** `pip install IndicTransToolkit --no-build-isolation`
    - The `--no-build-isolation` flag is required on Windows so the Cython build step can use the already-installed `numpy` and `setuptools` from the active environment. Without it, the build fails on Windows due to header path resolution issues.
  - Verify: `python -c "from IndicTransToolkit import IndicProcessor; print('OK')"`

**Deliverables:** `backend/translation/__init__.py` (placeholder), `data/translation_test/reference_translations.json` (placeholder), updated `requirements.txt`

---

### Task 2 — Exceptions and Utilities

**Goal:** Implement `exceptions.py` and `utils.py`. No model dependencies — can be tested immediately.

- [ ] Implement `backend/translation/exceptions.py`:
  - Define `TranslationInputError(Exception)` with docstring

- [ ] Implement `backend/translation/utils.py`:
  - `SUPPORTED_DIRECTIONS` constant (set of valid `(src_lang, tgt_lang)` tuples)
  - `validate_direction(src_lang: str, tgt_lang: str) -> None`
    - Raises `TranslationInputError` with list of valid directions if unsupported
  - `normalise_input(text: str) -> str`
    - Strip whitespace, collapse multiple internal spaces
  - `is_empty_input(text: str) -> bool`
    - Returns `True` if text is empty or whitespace-only after stripping

- [ ] Manual smoke test: call `validate_direction("xyz", "abc")` and confirm `TranslationInputError` is raised

**Deliverables:** `backend/translation/exceptions.py`, `backend/translation/utils.py`

---

### Task 3 — Core Translator Class

**Goal:** Implement `IndicTranslator` in `translator.py` — the HuggingFace + IndicProcessor inference wrapper.

- [ ] Implement `backend/translation/translator.py`:
  - `IndicTranslator.__init__(model_name: str, device: str | None = None)`
    - Auto-detect device via `torch.cuda.is_available()` if not specified
    - Set `torch_dtype = torch.float16` on CUDA, `torch.float32` on CPU
    - Load `AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)`
    - Load `AutoModelForSeq2SeqLM.from_pretrained(model_name, trust_remote_code=True, torch_dtype=torch_dtype).to(device)`
    - Instantiate `IndicProcessor(inference=True)`
    - Store `self.last_inference_time_s = 0.0`

  - `IndicTranslator.translate(texts: list[str], src_lang: str, tgt_lang: str) -> list[str]`
    - Validate direction via `validate_direction(src_lang, tgt_lang)`
    - Filter empty inputs, track their original positions
    - Normalise non-empty inputs via `normalise_input()`
    - Call `ip.preprocess_batch(non_empty_texts, src_lang=src_lang, tgt_lang=tgt_lang)`
    - Tokenize with `max_length=256, padding="longest", truncation=True`
    - Generate with `torch.inference_mode()`, `num_beams=5`, `max_length=256`
    - Decode and call `ip.postprocess_batch(decoded, lang=tgt_lang)`
    - Reinsert `""` at positions that were empty in the original input
    - Record wall-clock time in `self.last_inference_time_s`
    - Return list of translated strings

- [ ] Add type hints and docstrings to all public methods

**Deliverables:** `backend/translation/translator.py`

---

### Task 4 — Public API with Singleton Cache

**Goal:** Expose a clean `translate()` function matching the pattern of `backend/stt/__init__.py`.

- [ ] Implement `backend/translation/__init__.py`:
  - `MODEL_IDS` dict mapping direction tuples to HuggingFace model IDs
  - Module-level `_model_cache: dict[str, IndicTranslator]`
  - `translate(text: str, src_lang: str = "kan_Knda", tgt_lang: str = "eng_Latn") -> str`
    - Return `""` immediately for empty/whitespace input (no model load)
    - Validate direction via `validate_direction()`
    - Lazy-load `IndicTranslator` into `_model_cache` keyed by model ID
    - Call `translator.translate([text], src_lang, tgt_lang)[0]`
    - Return single translated string
  - `__all__ = ["translate", "TranslationInputError"]`

**Deliverables:** `backend/translation/__init__.py` (complete)

---

### Task 5 — Reference Translation Test Data

**Goal:** Create the 15 manually-written English reference translations used for BLEU scoring.

- [ ] Populate `data/translation_test/reference_translations.json` with accurate English translations of all 15 Kannada banking phrases from `transcripts.json`:
  ```json
  {
    "clip_001.wav": "What is the balance in my account?",
    "clip_002.wav": "Help me transfer money",
    "clip_003.wav": "How do I apply for a loan?",
    "clip_004.wav": "I want to open an account",
    "clip_005.wav": "I need a mini statement",
    "clip_006.wav": "Block my ATM card",
    "clip_007.wav": "I need to change my PIN",
    "clip_008.wav": "I want to withdraw five thousand rupees",
    "clip_009.wav": "Change my mobile number",
    "clip_010.wav": "I want to make a fixed deposit",
    "clip_011.wav": "I need a cheque book",
    "clip_012.wav": "Activate internet banking",
    "clip_013.wav": "I need to change my name",
    "clip_014.wav": "What is the loan repayment amount?",
    "clip_015.wav": "Where is the nearest branch?"
  }
  ```
- [ ] Review each translation for naturalness — prefer how a bank customer would phrase the request in English, not a literal word-for-word translation
- [ ] Confirm all 15 keys match exactly the keys in `transcripts.json`

**Deliverables:** `data/translation_test/reference_translations.json` (complete, 15 entries)

---

### Task 6 — Unit Tests

**Goal:** Test the module's correctness properties (CP-1 through CP-5) without requiring real model downloads.

- [ ] Create `tests/test_translation.py`:
  - Mock `AutoModelForSeq2SeqLM`, `AutoTokenizer`, and `IndicProcessor` using `unittest.mock`
  - Test CP-1: `translate("", ...)` returns `""`
  - Test CP-2: `translate("   ", ...)` returns `""`
  - Test CP-3: `translate("valid text", ...)` calls model and returns non-empty string
  - Test CP-4: calling `translate()` twice with same direction only loads model once (check `_model_cache` length)
  - Test CP-5: `translate("text", "xyz_Unkn", "eng_Latn")` raises `TranslationInputError`
  - Test `validate_direction()` directly for all valid and several invalid direction combinations
  - Test `normalise_input()` with various whitespace edge cases

- [ ] Run tests: `python -m pytest tests/test_translation.py -v`

**Deliverables:** `tests/test_translation.py`, all tests passing

---

### Task 7 — Benchmark Script

**Goal:** Implement `benchmark.py` — BLEU/chrF2++ harness matching the STT module's benchmark format.

**Prerequisite:** Real model downloaded (first `translate()` call triggers download), Task 5 complete.

- [ ] Implement `backend/translation/benchmark.py`:
  - `load_test_data(kannada_path, reference_path) -> list[tuple[str, str]]`
    - Load and zip `transcripts.json` + `reference_translations.json`
    - Raise `FileNotFoundError` if either file missing
  - `run_benchmark(test_pairs: list[tuple], beam_size: int = 5) -> dict`
    - Use `IndicTranslator` directly (not the cached `translate()`) to control beam_size
    - Collect hypotheses and inference times
  - `compute_metrics(references: list[str], hypotheses: list[str]) -> dict`
    - `sacrebleu.corpus_bleu(hypotheses, [references], tokenize="flores200")` for BLEU
    - `sacrebleu.corpus_chrf(hypotheses, [references])` for chrF2++
    - Return `{bleu_score, chrf_score, avg_inference_time_s, num_sentences}`
  - `save_results(results: dict, output_path: str) -> None`
    - Write CSV with columns: `bleu_score, chrf_score, avg_inference_time_s, num_sentences`
    - Print formatted table via `tabulate`
  - `main()` with `argparse`:
    - `--kannada-data` (default: `data/stt_test_audio/transcripts.json`)
    - `--reference-data` (default: `data/translation_test/reference_translations.json`)
    - `--output` (default: `translation_benchmark_results.csv`)

**Deliverables:** `backend/translation/benchmark.py`

---

### Task 8 — End-to-End Smoke Test and README

**Goal:** Verify the full translation pipeline works with real models, and document the module.

**Prerequisite:** All Tasks 1–7 complete.

- [ ] Run end-to-end smoke test:
  ```python
  from backend.translation import translate

  # Kannada → English
  en = translate("ನನ್ನ ಖಾತೆಯ ಬಾಕಿ ಎಷ್ಟಿದೆ")
  print(en)  # Should print something like: "What is the balance in my account?"

  # English → Kannada
  kn = translate("Your account balance is 5000 rupees.", src_lang="eng_Latn", tgt_lang="kan_Knda")
  print(kn)  # Should print Kannada text
  ```
- [ ] Verify second call for same direction does not reload model (check timing — second call should be faster)
- [ ] Run `benchmark.py` — confirm `translation_benchmark_results.csv` is created with non-zero BLEU and chrF2++ scores
- [ ] Test error cases:
  - Empty string → returns `""`
  - Invalid direction → `TranslationInputError` raised
- [ ] Write `backend/translation/README.md` covering:
  - Setup (model download on first use, no manual conversion)
  - Usage examples for both directions
  - Expected BLEU/chrF2++ ranges for sanity checking
  - Windows installation note for IndicTransToolkit

**Deliverables:** Working end-to-end system, `translation_benchmark_results.csv`, `backend/translation/README.md`
