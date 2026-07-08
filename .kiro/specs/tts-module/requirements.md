# TTS Module — Requirements

## Overview

Build a Text-to-Speech module that takes the Decision Router's English `response_text`, translates it to Kannada using the existing Translation module, and converts the Kannada text to natural-sounding spoken audio. This is the final AI model stage in the pipeline — the voice output the user hears.

Pipeline position:
```
Decision Router (English response_text)
    → [TTS: translate_en_to_kn()]        ← uses existing Translation module
    → [TTS: Kannada text → speech]       ← indic-parler-tts model
    → .wav audio file / playback
```

---

## Functional Requirements

### US-1: Generate Kannada Speech from English Text

**As a** rural banking user,
**I want** the system's response spoken back to me in Kannada,
**so that** I can understand the answer without reading.

| ID | Condition | System Behaviour |
|----|-----------|-----------------|
| AC-1.1 | WHEN English text is provided to the TTS module | THE SYSTEM SHALL translate it to Kannada (via `translate_en_to_kn()`) then synthesise spoken Kannada audio |
| AC-1.2 | WHEN the input text is empty or whitespace-only | THE SYSTEM SHALL return `None` without error — no audio generated for empty input |
| AC-1.3 | WHEN synthesis completes | THE SYSTEM SHALL return a NumPy float32 audio array and the sample rate, so callers can save or play the audio |

---

### US-2: Save and Play Generated Audio

**As a** developer validating the TTS output,
**I want** to save the generated audio to a `.wav` file and optionally play it,
**so that** I can verify the output sounds correct by listening.

| ID | Condition | System Behaviour |
|----|-----------|-----------------|
| AC-2.1 | WHEN `synthesise(..., output_path="out.wav")` is called | THE SYSTEM SHALL save the audio to the specified path using `soundfile` |
| AC-2.2 | WHEN `play=True` is passed | THE SYSTEM SHALL attempt to play the audio using `sounddevice` if available, otherwise log a warning and skip (no crash) |

---

### US-3: CPU-Only Inference with Optional GPU

**As a** developer deploying to client hardware,
**I want** TTS to run on CPU-only machines,
**so that** the system works on the 16 GB RAM / no-GPU client deployment target.

| ID | Condition | System Behaviour |
|----|-----------|-----------------|
| AC-3.1 | WHEN no CUDA device is available | THE SYSTEM SHALL run inference in `float32` on CPU without error |
| AC-3.2 | WHEN a CUDA device is available | THE SYSTEM SHALL use it automatically with `bfloat16` dtype for faster generation |

---

## Model

| Property | Value |
|----------|-------|
| Model ID | `ai4bharat/indic-parler-tts` |
| Type | Parler-TTS (description-conditioned TTS) |
| Size | ~0.9B params, ~2 GB FP32 / ~1 GB FP16 |
| Kannada voices | Suresh, Anu, Chetan, Vidya |
| Default voice | Suresh (male, clear, moderate pace) |
| Kannada NSS quality score | 88.17 (published evaluation) |
| Auth required | Yes — gated on HuggingFace (same process as IndicTrans2) |

---

## Out of Scope

- Real-time streaming audio output
- Voice cloning or custom voice training
- Audio post-processing (noise reduction, normalisation beyond what the model produces)
- Languages other than Kannada output

---

## Constraints

| Constraint | Detail |
|------------|--------|
| No re-implementation of translation | Must call `translate_en_to_kn()` from the existing Translation module |
| CPU-only deployment | Must work on 16 GB RAM, no GPU |
| HF auth required | Model is gated — same `huggingface-cli login` step as IndicTrans2 |
| transformers version | `parler-tts` compatible with ≥4.51 — no conflict with existing dependencies |
