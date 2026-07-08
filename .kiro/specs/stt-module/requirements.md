# STT Module — Requirements

## Overview

Build a Speech-to-Text (STT) module that converts spoken Kannada audio into Kannada text. The module must run fully offline on CPU-only hardware, use quantized open-source models, and include a benchmarking harness that produces a quantitative comparison between a generic Whisper model and a Kannada-specialized Whisper model.

This is the first module in a larger voice-based banking assistant pipeline for rural Kannada-speaking users in Karnataka. The pipeline order is:

```
Speech (Kannada) → [STT] → Kannada text → Translation → NLU → Routing → TTS → Banking Form
```

---

## Functional Requirements

### US-1: Transcribe Kannada Audio

**As a** rural bank user,  
**I want to** speak in Kannada and have my speech converted to text,  
**so that** the system can understand my banking request.

#### Acceptance Criteria

| ID | Condition | System Behaviour |
|----|-----------|-----------------|
| AC-1.1 | WHEN a `.wav` audio file containing Kannada speech is provided to the STT module | THE SYSTEM SHALL return the transcribed Kannada text within **10 seconds** on an 8-core CPU with 16 GB RAM |
| AC-1.2 | WHEN the audio is silent or contains no recognisable speech | THE SYSTEM SHALL return an empty string `""` or a `"no_speech"` flag — **not** raise an exception |
| AC-1.3 | WHEN the audio file path does not exist, the file is corrupted, or the format is unsupported | THE SYSTEM SHALL raise a `STTInputError` (a catchable, descriptive exception) with a human-readable message |

---

### US-2: Compare Baseline vs Kannada-Specialized Model

**As a** project evaluator,  
**I want to** see a quantitative comparison between a generic Whisper model and a Kannada-finetuned Whisper model,  
**so that** the project demonstrates measurable value from using a domain-specialized model.

#### Acceptance Criteria

| ID | Condition | System Behaviour |
|----|-----------|-----------------|
| AC-2.1 | WHEN both models are run on the same held-out test set of Kannada audio clips | THE SYSTEM SHALL compute **Word Error Rate (WER)** for each model using character-level WER suitable for Kannada script |
| AC-2.2 | WHEN WER computation completes | THE SYSTEM SHALL output a comparison table saved as a **CSV file** containing: model name, WER (%), average inference time per clip (seconds) |
| AC-2.3 | WHEN the benchmark script is run | THE SYSTEM SHALL also print the comparison table to stdout in a human-readable format |

---

### US-3: Run Fully Offline, CPU-Only

**As a** developer deploying to a client machine,  
**I want the** STT module to run without internet access or a GPU,  
**so that** it works on the target 16 GB RAM, CPU-only deployment hardware.

#### Acceptance Criteria

| ID | Condition | System Behaviour |
|----|-----------|-----------------|
| AC-3.1 | WHEN the module is initialised | THE SYSTEM SHALL load models using **int8 quantization via CTranslate2** (faster-whisper) |
| AC-3.2 | WHEN running on a machine with no CUDA device | THE SYSTEM SHALL run on `device="cpu"` and still return a valid transcription without crashing |
| AC-3.3 | WHEN the module is used after initial model download | THE SYSTEM SHALL make **zero network calls** — all inference must use locally cached model files |

---

## Models

| Role | Model ID (HuggingFace) | Purpose |
|------|------------------------|---------|
| Baseline | `openai/whisper-medium` | Generic multilingual Whisper — not Kannada-tuned; serves as the lower-bound reference |
| Specialized | `ARTPARK-IISc/whisper-medium-vaani-kannada` | Fine-tuned on Kannada (VAANI dataset); expected to score lower WER on Kannada speech |

Both models must be converted to CTranslate2 int8 format and stored locally before use.

---

## Test Data Requirements

- **15–20 short Kannada audio clips**, 5–15 seconds each
- Content: banking-related phrases (balance enquiry, fund transfer, loan, account opening, etc.)
- Format: `.wav`, 16 kHz mono (Whisper's expected input format)
- Location: `data/stt_test_audio/`
- Ground-truth transcripts: `data/stt_test_audio/transcripts.json`
  ```json
  {
    "clip_001.wav": "ನನ್ನ ಖಾತೆಯ ಬಾಕಿ ಎಷ್ಟಿದೆ",
    "clip_002.wav": "ಹಣ ವರ್ಗಾಯಿಸಲು ಸಹಾಯ ಮಾಡಿ",
    ...
  }
  ```

---

## Out of Scope (This Phase)

- Real-time / streaming transcription — batch file-based only
- Training or fine-tuning a new STT model from scratch
- Audio preprocessing, noise cancellation, or VAD (assume reasonably clean mic input)
- Integration with downstream Translation or NLU modules
- Any paid API or cloud service

---

## Constraints

| Constraint | Detail |
|------------|--------|
| Hardware (deployment) | 8-core CPU, 16 GB RAM, no GPU |
| Hardware (dev/test) | 24 GB RAM, 8 GB GPU (CUDA allowed during model conversion and testing) |
| Runtime | Python 3.10+ |
| Key libraries | `faster-whisper`, `ctranslate2`, `transformers` (already in requirements.txt) |
| Connectivity | Fully offline after initial model download |
| Latency target | ≤ 10 seconds per clip on CPU |
| Licence | All models and libraries must be free and open-source |
