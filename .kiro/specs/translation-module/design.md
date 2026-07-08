# Translation Module — Design

## Overview

The Translation module wraps IndicTrans2 distilled 200M models using the standard HuggingFace `transformers` interface plus `IndicTransToolkit.IndicProcessor` for pre/post-processing. It follows the same structural patterns as the STT module: a central class with device auto-detection, a singleton-caching public API, and a standalone benchmark script.

---

## Architecture

```
backend/
└── translation/
    ├── __init__.py          # Public API: translate()
    ├── translator.py        # IndicTranslator class (core inference wrapper)
    ├── exceptions.py        # TranslationInputError definition
    ├── benchmark.py         # BLEU/chrF2++ benchmark harness
    └── utils.py             # Language code validation, text normalisation helpers

data/
└── translation_test/
    └── reference_translations.json    # 15 manually-written English reference translations

models/
└── (HF hub cache — auto-managed by transformers, no manual conversion needed)
```

Unlike the STT module, **no manual model conversion step is needed**. IndicTrans2 models are downloaded and cached by `transformers`' `from_pretrained()` on first use and loaded directly from the HuggingFace hub cache on subsequent runs. The `models/` directory is not used by this module.

---

## Components and Interfaces

### `exceptions.py`

Single custom exception so callers can catch translation-specific input errors without masking unrelated issues.

```python
class TranslationInputError(Exception):
    """Raised when the input to the translator is invalid (wrong type, etc.)."""
    pass
```

---

### `utils.py` — Language Code Validation and Text Helpers

**`SUPPORTED_DIRECTIONS`** — module-level constant:

```python
SUPPORTED_DIRECTIONS = {
    ("kan_Knda", "eng_Latn"),   # Kannada → English
    ("eng_Latn", "kan_Knda"),   # English → Kannada
}
```

**`validate_direction(src_lang, tgt_lang) -> None`**
- Raises `TranslationInputError` if the direction is not in `SUPPORTED_DIRECTIONS`

**`normalise_input(text: str) -> str`**
- Strips leading/trailing whitespace
- Collapses multiple internal spaces to single space
- Returns empty string unchanged (callers check for empty before translating)

---

### `translator.py` — Core Inference

The central class. Wraps `AutoModelForSeq2SeqLM` + `AutoTokenizer` + `IndicProcessor`.

```
IndicTranslator
├── __init__(model_name, device, torch_dtype)
├── translate(texts, src_lang, tgt_lang) → list[str]
└── _load_model() → (AutoModelForSeq2SeqLM, AutoTokenizer)
```

**Constructor parameters:**

| Parameter | Default | Description |
|-----------|---------|-------------|
| `model_name` | required | HuggingFace model ID (one of the two 200M dist models) |
| `device` | `None` → auto-detected | `"cpu"` or `"cuda"` |
| `torch_dtype` | `"auto"` | `torch.float32` on CPU; `torch.float16` on CUDA |

**Device detection** — identical pattern to `transcriber.py`:

```python
import torch
device = "cuda" if torch.cuda.is_available() else "cpu"
```

**`translate(texts: list[str], src_lang: str, tgt_lang: str) -> list[str]`**

1. Filter out empty/whitespace-only strings — return `""` for those positions without running them through the model
2. Call `ip.preprocess_batch(texts, src_lang=src_lang, tgt_lang=tgt_lang)`
3. Tokenize: `tokenizer(batch, padding="longest", truncation=True, max_length=256, return_tensors="pt").to(device)`
4. Generate: `model.generate(**batch, num_beams=5, num_return_sequences=1, max_length=256)`
5. Decode: `tokenizer.batch_decode(outputs, skip_special_tokens=True, clean_up_tokenization_spaces=True)`
6. Post-process: `ip.postprocess_batch(decoded, lang=tgt_lang)`
7. Reinsert `""` at the positions of any originally-empty inputs
8. Measure and store `self.last_inference_time_s`

**`IndicProcessor` instantiation:**

```python
from IndicTransToolkit import IndicProcessor
self._ip = IndicProcessor(inference=True)
```

The processor is stateless for inference — one instance is shared across calls.

**Generation config:**

| Option | Value | Reason |
|--------|-------|--------|
| `num_beams` | `5` | Standard MT quality — IndicTrans2 was evaluated at beam=5 |
| `max_length` | `256` | Sufficient for banking sentence lengths (<30 words) |
| `num_return_sequences` | `1` | Single best translation only |

**`torch.inference_mode()`** wraps the generate call to disable gradient tracking and reduce memory footprint on CPU.

---

### `__init__.py` — Public API

```python
from backend.translation import translate

# Kannada → English (STT output → NLU input)
en_text = translate("ನನ್ನ ಖಾತೆಯ ಬಾಕಿ ಎಷ್ಟಿದೆ", src_lang="kan_Knda", tgt_lang="eng_Latn")

# English → Kannada (response → TTS input)
kn_text = translate("What is your account balance?", src_lang="eng_Latn", tgt_lang="kan_Knda")
```

**Singleton cache keyed by model name** — same pattern as STT module:

```python
_model_cache: dict[str, IndicTranslator] = {}

MODEL_IDS = {
    ("kan_Knda", "eng_Latn"): "ai4bharat/indictrans2-indic-en-dist-200M",
    ("eng_Latn", "kan_Knda"): "ai4bharat/indictrans2-en-indic-dist-200M",
}
```

**`translate(text: str, src_lang: str, tgt_lang: str) -> str`**
- Returns `""` immediately if input is empty/whitespace
- Looks up the model ID from `MODEL_IDS`
- Lazy-loads `IndicTranslator` into `_model_cache` on first call for that direction
- Calls `translator.translate([text], src_lang, tgt_lang)[0]`
- Returns a single string

---

### `benchmark.py` — BLEU / chrF2++ Scoring

Runs the Kannada→English model against the 15 reference translation pairs and reports standard MT metrics.

**Functions:**

`load_test_data(kannada_path, reference_path) -> list[tuple[str, str]]`
- Load `transcripts.json` (Kannada phrases) and `reference_translations.json` (English references)
- Return list of `(kannada_source, english_reference)` pairs

`run_benchmark(test_pairs, beam_size=5) -> dict`
- Translate each Kannada source using the indic-en model
- Collect hypotheses and inference times
- Return `{hypotheses, references, inference_times}`

`compute_metrics(references, hypotheses) -> dict`
- Use `sacrebleu.corpus_bleu()` for BLEU (tokenize="flores200" for Indic scripts)
- Use `sacrebleu.corpus_chrf()` for chrF2++
- Return `{bleu, chrf, avg_inference_time_s}`

`save_results(results, output_path) -> None`
- Write CSV: `bleu_score, chrf_score, avg_inference_time_s, num_sentences`
- Print formatted table via `tabulate`

**CLI args:** `--output` (default: `translation_benchmark_results.csv`)

---

## Data Models

### `data/translation_test/reference_translations.json`

Maps the same 15 filenames used in `transcripts.json` to their manually-written English reference translations:

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

---

## Correctness Properties

The following properties must hold and are verifiable by the test suite:

| ID | Property | Testable via |
|----|----------|-------------|
| CP-1 | `translate("", ...)` returns `""` without raising | Unit test |
| CP-2 | `translate("   ", ...)` returns `""` without raising | Unit test |
| CP-3 | `translate(valid_kannada, "kan_Knda", "eng_Latn")` returns a non-empty string | Unit test with mock model |
| CP-4 | Calling `translate()` twice with the same direction does not load the model twice (singleton) | Unit test checking `_model_cache` length |
| CP-5 | `translate(text, "xyz_Unkn", "eng_Latn")` raises `TranslationInputError` | Unit test |
| CP-6 | BLEU score on 15 banking phrases is above 0 (model produces non-empty output) | Benchmark script |

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Empty or whitespace input | Returns `""` — no exception, no model call |
| Unsupported language direction | `TranslationInputError` with message listing valid directions |
| Model files missing / download failed | `OSError` from `transformers` with original message preserved |
| Non-string input | `TranslationInputError("Input must be a string, got <type>")` |
| CUDA OOM during generation | Caught and re-raised with a message suggesting CPU fallback via `device="cpu"` |

---

## Testing Strategy

**Unit tests** (`tests/test_translation.py`):
- Mock `AutoModelForSeq2SeqLM` and `AutoTokenizer` to test the translate() wrapper without loading real models
- Test all correctness properties CP-1 through CP-5
- Test singleton caching behaviour

**Integration test** (Task 8, manual):
- Run with real models after download
- Verify Kannada→English on at least 3 of the 15 banking phrases produces readable English
- Verify English→Kannada produces Kannada script (not Latin or garbled output)

**Benchmark** (Task 7):
- Run `benchmark.py` on all 15 pairs; confirm BLEU > 0 and chrF2++ > 0
- Report both scores in the project report

---

## Dependencies

New packages to add to `requirements.txt`:

| Package | Version constraint | Role |
|---------|-------------------|------|
| `indictranstoolkit` | `>=1.1` | `IndicProcessor` for pre/post-processing |
| `sacrebleu` | `>=2.4` | BLEU and chrF2++ computation |
| `sentencepiece` | `>=0.1.99` | Tokenizer backend for IndicTrans2 |

Already in `requirements.txt` and compatible:
- `transformers>=4.36.0` (toolkit recommends ≥4.51 — version will be bumped in Task 1)
- `torch>=2.1.0` (toolkit recommends ≥2.5 — version will be bumped in Task 1)
- `huggingface_hub>=0.23`
- `numpy>=1.24` (toolkit recommends ≥2.1 — version will be bumped in Task 1)

---

## Key Design Decisions

**Why distilled 200M over 1.1B?**  
The 1.1B model requires ~4–5 GB RAM for inference, pushing total pipeline memory beyond the 16 GB client budget when STT and NLU are also loaded. The distilled 200M model uses ~800 MB and achieves only marginally lower BLEU on high-resource language pairs like Kannada↔English.

**Why `num_beams=5`?**  
IndicTrans2 was evaluated and published with `num_beams=5`. Reducing to 1 (greedy) saves ~2–3× latency on CPU but measurably drops BLEU. Banking queries are short enough that beam=5 stays within the 3-second budget.

**Why no manual model conversion (unlike STT)?**  
IndicTrans2 is natively a HuggingFace `transformers` model and runs directly via `AutoModelForSeq2SeqLM` without any CTranslate2 conversion. The STT module needed conversion because `faster-whisper` requires CTranslate2 format; IndicTrans2 does not.

**Why two separate model objects (not one bilingual model)?**  
IndicTrans2 provides direction-specific models. `indic-en-dist-200M` and `en-indic-dist-200M` are separate checkpoints; there is no single bidirectional 200M model. The singleton cache holds both simultaneously only if both directions are actually used in the same session.

**Windows note — IndicTransToolkit:**  
The toolkit states it is not officially tested on Windows, but it installs and works correctly on Windows using:

```
pip install IndicTransToolkit --no-build-isolation
```

The `--no-build-isolation` flag is required on Windows to allow the Cython build step to use the already-installed `numpy` and `setuptools` from the active environment rather than a clean isolated build environment, which fails on Windows due to header path issues. The standard `pip install IndicTransToolkit` (without the flag) may fail at the Cython compilation step. Verified working: Windows 11, Python 3.12, `pip install IndicTransToolkit --no-build-isolation` → `import IndicTransToolkit` succeeds. Document this command in `README.md` as the required install step for Windows developers.
