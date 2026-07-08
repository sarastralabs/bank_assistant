# TTS Module — Design

## Overview

The TTS module is a self-contained Python package at `backend/tts/`. It wraps `indic-parler-tts` (Parler-TTS) with a two-step pipeline: translate English → Kannada using the existing Translation module, then synthesise Kannada speech. Follows identical structural patterns to all previous modules: device auto-detection, singleton cache, small public API.

---

## Architecture

```
backend/
└── tts/
    ├── __init__.py       # Public API: synthesise()
    └── speaker.py        # KannadaSpeaker class (Parler-TTS wrapper)

data/
└── tts_output/           # Default directory for saved .wav files (gitignored)
```

No training script, no benchmark script, no conversion script — the model loads directly from HuggingFace cache via `from_pretrained()`, same as the Translation module.

---

## Components and Interfaces

### `speaker.py` — Core Synthesis

```
KannadaSpeaker
├── __init__(model_id, device, torch_dtype)
├── synthesise(english_text, voice_description, output_path, play) → tuple[np.ndarray, int] | None
└── _load_model() → (ParlerTTSForConditionalGeneration, tokenizer, description_tokenizer)
```

**Constructor parameters:**

| Parameter | Default | Description |
|-----------|---------|-------------|
| `model_id` | `"ai4bharat/indic-parler-tts"` | HuggingFace model ID |
| `device` | `None` → auto-detected | `"cpu"` or `"cuda"` |
| `torch_dtype` | `None` → auto | `bfloat16` on CUDA, `float32` on CPU |

**Device detection — same pattern as all other modules:**
```python
device = "cuda" if torch.cuda.is_available() else "cpu"
dtype  = torch.bfloat16 if device == "cuda" else torch.float32
```

**`synthesise(english_text, voice_description, output_path, play) -> tuple[np.ndarray, int] | None`**

1. Return `None` if `english_text` is empty/whitespace — no exception (AC-1.2)
2. Call `translate_en_to_kn(english_text)` — uses existing Translation module
3. Tokenize `voice_description` with `description_tokenizer`
4. Tokenize Kannada text with `tokenizer` (Parler-TTS uses two separate tokenizers)
5. Call `model.generate(...)` under `torch.inference_mode()`
6. Squeeze output → NumPy float32 array
7. If `output_path` given: save with `soundfile.write(output_path, audio, sample_rate)`
8. If `play=True`: play with `sounddevice.play()` — skip gracefully if not installed
9. Return `(audio_array, sample_rate)`

**Voice description** — Parler-TTS is description-conditioned, not just text-conditioned. The description controls gender, pace, pitch, and recording quality. The default is a module-level constant but is a **parameter at every call level** — not hardcoded into any function body. Callers can override it at call time without editing source code:

```python
DEFAULT_VOICE_DESCRIPTION = (
    "Suresh speaks at a moderate pace with a clear voice. "
    "The recording is of very high quality with no background noise."
)

# Other available Kannada voices (from official model card):
# Female: "Anu speaks at a moderate pace with a clear, warm voice. The recording is very high quality."
# Female: "Vidya speaks clearly at a slightly slow pace. The recording is of very high quality."
# Male:   "Chetan speaks with a deep voice at a moderate pace. The recording is very high quality."
```

`KannadaSpeaker.synthesise()` and the public `synthesise()` function both accept `voice_description` as an explicit parameter. `None` triggers the default; any string overrides it. This means voice can be switched at demo/report time without touching source code.

**Parler-TTS two-tokenizer requirement:**
Unlike standard transformers models, Parler-TTS requires two separate tokenizers:
- `description_tokenizer` — tokenizes the voice description (English)
- `tokenizer` — tokenizes the text to speak (Kannada)

Both are loaded from `from_pretrained()` with different sources:
```python
tokenizer             = AutoTokenizer.from_pretrained(model_id)
description_tokenizer = AutoTokenizer.from_pretrained(
    model.config.text_encoder._name_or_path  # typically flan-t5-large
)
```

---

### `__init__.py` — Public API

```python
from backend.tts import synthesise

# Translate English → Kannada → .wav file
audio, sr = synthesise(
    "Real-time balance lookup is not available in this demonstration.",
    output_path="data/tts_output/response.wav",
)
```

**`synthesise(english_text, voice_description=None, output_path=None, play=False) -> tuple[np.ndarray, int] | None`**

- Returns `None` for empty input — no exception, no model load
- Lazy-loads `KannadaSpeaker` singleton on first call
- Delegates to `KannadaSpeaker.synthesise()`
- `voice_description=None` uses `DEFAULT_VOICE_DESCRIPTION`

**Singleton cache:**
```python
_speaker: KannadaSpeaker | None = None

def synthesise(english_text, ...):
    global _speaker
    if _speaker is None:
        _speaker = KannadaSpeaker()
    return _speaker.synthesise(english_text, ...)
```

---

## Data Flow

```
[English response_text from Decision Router]
              │
              ▼
    is empty? ──yes──► return None
              │ no
              ▼
    translate_en_to_kn(english_text)
              │
              ▼
    [Kannada text]
              │
              ▼
    description_tokenizer(voice_description)  ← "Suresh speaks clearly..."
    tokenizer(kannada_text)
              │
              ▼
    model.generate(
        input_ids=description_ids,
        prompt_input_ids=kannada_ids,
    )
              │
              ▼
    [audio tensor] → squeeze → NumPy float32
              │
              ├── output_path? → soundfile.write()
              ├── play=True?   → sounddevice.play()
              │
              ▼
    return (audio_array, sample_rate)
              │
              ▼
    [Pipeline complete — user hears Kannada response]
```

---

## Dependencies

New packages to add to `requirements.txt`:

| Package | Install command | Role |
|---------|----------------|------|
| `parler-tts` | `pip install git+https://github.com/huggingface/parler-tts.git` | Parler-TTS model class |
| `sounddevice` | `pip install sounddevice` | Optional audio playback (`play=True`) |

Already installed and compatible:
- `soundfile` — save .wav output
- `numpy` — audio array handling
- `torch` — inference
- `transformers>=4.51` — AutoTokenizer, model loading

**Note on `sounddevice`:** It requires PortAudio system library. On Windows this is usually present; if not, `pip install sounddevice` will warn and playback silently degrades to "no-op with warning". The synthesis and save steps always work regardless.

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Empty/whitespace input | Returns `None` — no exception, no model load |
| `sounddevice` not installed | Warning printed, playback skipped — synthesis continues |
| HuggingFace auth not set up | `GatedRepoError` at model load time — same fix as IndicTrans2 (accept terms + `huggingface-cli login`) |
| Translation returns empty string | Returns `None` — no synthesis on empty Kannada text |
| CUDA OOM | Caught, message suggests `device="cpu"` fallback |

---

## Key Design Decisions

**Why use `translate_en_to_kn()` rather than synthesising directly from English?**
The user speaks Kannada. The entire pipeline contract is to respond *in Kannada*. The router's `response_text` is English because NLU and the banking content database operate in English. `translate_en_to_kn()` is already built, tested, and produces natural Kannada text. The TTS module should not re-implement translation.

**Why Parler-TTS over IndicF5?**
IndicF5 requires `transformers<4.50` which conflicts with our current 4.57.3 and would break IndicTransToolkit (requires ≥4.51) and the Translation module. Parler-TTS has no version conflict, requires no reference audio clip, and has published Kannada quality scores (NSS 88.17).

**Why a description-conditioned model?**
Description conditioning lets you specify voice characteristics in plain English ("moderate pace", "clear audio", "no background noise") without recording a reference clip. This is much simpler to use in a demo context where you want consistent, predictable output.

**Why `bfloat16` on CUDA and `float32` on CPU?**
`bfloat16` is natively accelerated on modern NVIDIA GPUs (Ampere+) and halves memory use. `float16` on CPU is not accelerated and can cause quality issues on some platforms. `float32` on CPU is the safe default — the ~0.9B model at float32 is ~3.6 GB, within the 16 GB client budget when other models are not simultaneously loaded.

**Known constraint — simultaneous model memory budget:**
All four pipeline models loaded at once on the client machine (CPU, float32):
- STT (Whisper-medium int8): ~400 MB
- Translation indic-en + en-indic (both loaded if both directions used): ~1.6 GB
- NLU DistilBERT: ~250 MB
- TTS Parler-TTS: ~3.6 GB
- OS + process overhead: ~2–3 GB

**Total worst-case: ~8–10 GB** — fits in 16 GB. However, if Translation loads *both* direction models simultaneously alongside TTS, peak usage approaches 14 GB, leaving little headroom. This is a documented constraint, not a blocker for this module. The resolution is lazy model loading per pipeline stage in the FastAPI orchestration layer (future module): load STT → unload after transcription → load Translation → unload → load NLU → route → load TTS. At no point are all four models simultaneously resident. This strategy is the standard approach for memory-constrained multi-model pipelines and will be implemented when the orchestration layer is built.
