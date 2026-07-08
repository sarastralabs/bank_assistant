# Translation Module — Requirements

## Overview

Build a Translation module using IndicTrans2 that converts Kannada text (output of the STT module) into English for downstream NLU processing, and converts English response text back to Kannada for downstream TTS output. The module must run fully offline on CPU-only hardware after initial model download, with optional GPU acceleration where available.

This is Module 2 in the pipeline:

```
Kannada audio → [STT] → Kannada text → [TRANSLATION] → English text → [NLU] → ...
                                                ↑
                                     English response text ← [Decision Router]
                                                ↓
                                         Kannada text → [TTS]
```

---

## Functional Requirements

### US-1: Translate Kannada to English

**As a** developer building the NLU stage,  
**I want** Kannada text converted to accurate English text,  
**so that** the intent/entity extraction stage (which operates in English) can process it.

#### Acceptance Criteria

| ID | Condition | System Behaviour |
|----|-----------|-----------------|
| AC-1.1 | WHEN a Kannada text string is provided to the translator | THE SYSTEM SHALL return a grammatically coherent English translation |
| AC-1.2 | WHEN the input text is empty or whitespace-only | THE SYSTEM SHALL return an empty string without raising an exception |
| AC-1.3 | WHEN the input contains Kannada text mixed with numerals or common English banking terms (e.g. "ATM", "PIN", "OTP") | THE SYSTEM SHALL preserve numerals and transliterated terms sensibly rather than mistranslating them |

---

### US-2: Translate English to Kannada (reverse direction)

**As a** developer building the TTS/response stage,  
**I want** English response text converted to Kannada text,  
**so that** the Text-to-Speech module can speak the response back to the user in Kannada.

#### Acceptance Criteria

| ID | Condition | System Behaviour |
|----|-----------|-----------------|
| AC-2.1 | WHEN an English text string is provided to the translator | THE SYSTEM SHALL return a coherent Kannada translation suitable for TTS input |
| AC-2.2 | WHEN translating fixed banking response templates | THE SYSTEM SHALL produce natural-sounding Kannada, not literal word-for-word translation |

---

### US-3: Run within latency and resource budget

**As a** developer targeting 16 GB RAM client hardware,  
**I want** the translation module to be fast and memory-efficient,  
**so that** it fits within the pipeline's overall response-time budget alongside STT, NLU, and TTS.

#### Acceptance Criteria

| ID | Condition | System Behaviour |
|----|-----------|-----------------|
| AC-3.1 | WHEN the module is initialised | THE SYSTEM SHALL load the **distilled 200M** IndicTrans2 models (not the full 1.1B variants) |
| AC-3.2 | WHEN translating a single sentence of typical banking query length (<30 words) | THE SYSTEM SHALL return a result within **3 seconds** on an 8-core CPU with 16 GB RAM |
| AC-3.3 | WHEN a CUDA-capable GPU is available | THE SYSTEM SHALL use it automatically; otherwise fall back to CPU without error |
| AC-3.4 | WHEN both translation directions are used in the same session | THE SYSTEM SHALL cache each loaded model so it is not reloaded on subsequent calls |

---

### US-4: Benchmark translation quality (optional)

**As a** project evaluator,  
**I want** translation quality measured with a standard MT metric,  
**so that** the report includes a quantitative result for this pipeline stage.

#### Acceptance Criteria

| ID | Condition | System Behaviour |
|----|-----------|-----------------|
| AC-4.1 | WHEN reference Kannada-to-English sentence pairs are provided | THE SYSTEM SHALL compute a **BLEU score** and **chrF2++** score comparing model output to reference translations |
| AC-4.2 | WHEN the benchmark script is run | THE SYSTEM SHALL save results to a CSV file and print a table to stdout, consistent with the STT module's benchmark format |

---

## Models

| Direction | HuggingFace Model ID | Size | Purpose |
|-----------|---------------------|------|---------|
| Kannada → English | `ai4bharat/indictrans2-indic-en-dist-200M` | ~200M params | Translating STT output for NLU |
| English → Kannada | `ai4bharat/indictrans2-en-indic-dist-200M` | ~200M params | Translating responses for TTS |

Both models are used via the `transformers` `AutoModelForSeq2SeqLM` + `AutoTokenizer` interface, pre-processed and post-processed with `IndicTransToolkit.IndicProcessor`.

---

## Language Codes Used with IndicTrans2

| Language | IndicTrans2 code |
|----------|-----------------|
| Kannada | `kan_Knda` |
| English | `eng_Latn` |

---

## Test Data

- **Kannada input:** Reuse `data/stt_test_audio/transcripts.json` (15 banking phrases)
- **English reference translations:** `data/translation_test/reference_translations.json` — manually written accurate English translations of the same 15 phrases, used for BLEU/chrF2++ scoring

---

## Out of Scope

- Fine-tuning or adapting IndicTrans2 (use pretrained as-is)
- Real-time or streaming translation
- Languages other than Kannada ↔ English
- Post-editing or quality estimation beyond BLEU/chrF2++

---

## Constraints

| Constraint | Detail |
|------------|--------|
| Hardware (deployment) | 8-core CPU, 16 GB RAM, no GPU |
| Hardware (dev) | 24 GB RAM, 8 GB GPU (CUDA allowed) |
| Runtime | Python 3.10+ |
| OS note | `IndicTransToolkit` is not officially supported on Windows. The module must include a documented fallback/workaround for Windows development (see design.md §7). |
| Model size | Must use distilled 200M variants only — the 1.1B models exceed memory budget |
| Connectivity | Fully offline after initial model download |
| Latency target | ≤ 3 seconds per sentence on CPU |
| Licence | All models and libraries must be free and open-source |

---

## Dependencies on Other Modules

| Module | Relationship |
|--------|-------------|
| STT (Module 1) | Provides Kannada text input; Translation takes this as its input |
| NLU (Module 3) | Consumes English output of Kannada→English translation |
| TTS (Module 5) | Consumes Kannada output of English→Kannada translation |
