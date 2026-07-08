# STT Module — Design

## 1. Architecture Overview

The STT module is a self-contained Python package at `backend/stt/`. It has three concerns:

1. **Inference** — load a CTranslate2-quantized Whisper model and transcribe a `.wav` file
2. **Model conversion** — one-time script to download HuggingFace checkpoints and export to CTranslate2 int8 format
3. **Benchmarking** — run both models over a test set, compute WER, emit a CSV report

```
backend/
└── stt/
    ├── __init__.py              # Public API: transcribe()
    ├── transcriber.py           # KannadaTranscriber class (faster-whisper wrapper)
    ├── exceptions.py            # STTInputError definition
    ├── convert_models.py        # One-time: HF → CTranslate2 int8 conversion
    ├── benchmark.py             # WER computation + comparison CSV
    └── utils.py                 # Audio validation helpers

data/
├── stt_test_audio/
│   ├── clip_001.wav
│   ├── ...
│   └── transcripts.json        # Ground-truth Kannada transcripts

models/
├── whisper-medium-ct2/          # Converted baseline model (gitignored)
└── whisper-medium-vaani-ct2/   # Converted specialized model (gitignored)
```

---

## 2. Component Design

### 2.1 `exceptions.py`

Single custom exception used throughout the module so callers can catch it specifically.

```python
class STTInputError(Exception):
    """Raised when the input audio file is missing, corrupted, or unsupported."""
    pass
```

---

### 2.2 `utils.py` — Audio Validation

Responsible for validating the audio file before passing it to the model. Keeps validation logic out of the transcriber.

**Function:** `validate_audio_file(path: str) -> None`

- Checks the file exists on disk → raises `STTInputError` if not
- Checks the file extension is `.wav` → raises `STTInputError` if not
- Attempts to open the file with `soundfile` or `wave` to detect corruption → raises `STTInputError` on failure
- Does **not** resample or modify the file — validation only

**Function:** `is_silent(audio_array: np.ndarray, threshold: float = 0.01) -> bool`

- Returns `True` if RMS energy of the audio array is below `threshold`
- Used by the transcriber to return the `"no_speech"` flag early, avoiding full model inference on silence

---

### 2.3 `transcriber.py` — Core Inference

The central class. Wraps `faster-whisper`'s `WhisperModel` and adds Kannada-specific configuration.

```
KannadaTranscriber
├── __init__(model_path, device, compute_type)
├── transcribe(audio_path) → str
└── _load_model() → WhisperModel
```

**Constructor parameters:**

| Parameter | Default | Description |
|-----------|---------|-------------|
| `model_path` | required | Path to the local CTranslate2 model directory |
| `device` | `"cpu"` | `"cpu"` or `"cuda"` — auto-detected if not specified |
| `compute_type` | `"int8"` | CTranslate2 quantization type |

**`transcribe(audio_path: str) -> str`**

1. Call `validate_audio_file(audio_path)` — raises `STTInputError` on bad input
2. Load audio with `faster-whisper`'s internal loader (handles 16 kHz resampling automatically)
3. Call `is_silent()` on the audio array — return `""` if silent
4. Call `model.transcribe(audio_path, language="kn", task="transcribe", beam_size=beam_size)` where `beam_size` defaults to `1` for production use
5. Concatenate segment texts → return as single string
6. Measure and store last inference time as `self.last_inference_time_s` for benchmarking

**Key `faster-whisper` transcribe options used:**

| Option | Value | Reason |
|--------|-------|--------|
| `language` | `"kn"` | Force Kannada; avoids language-detection overhead |
| `task` | `"transcribe"` | Not translation — keep Kannada output |
| `beam_size` | `1` (default) | CPU latency target of ≤10s — beam_size=1 is greedy decoding; `beam_size=5` available as an optional parameter for benchmark use |
| `vad_filter` | `True` | Built-in VAD handles silence padding without extra deps |
| `word_timestamps` | `False` | Not needed for this phase |

**Device detection logic:**

```python
import torch
device = "cuda" if torch.cuda.is_available() else "cpu"
```

This means the same code works on both the GPU dev machine and the CPU-only client.

---

### 2.4 `convert_models.py` — Model Conversion

A standalone CLI script run **once** during project setup, not at inference time.

**Flow:**

```
1. Instantiate ctranslate2.converters.TransformersConverter(hf_id)
   - Downloads the HuggingFace checkpoint on first call (cached in HF hub cache)
   - No CLI tool, no PATH dependency — works on Windows user-site installs
2. Call converter.convert(output_dir, quantization="int8", force=True)
   → output_dir: models/<model-name>-ct2/
3. Verify output directory contains expected files (model.bin, config.json, vocabulary.json)
4. Print success / file sizes
```

**Why programmatic API instead of CLI subprocess:**  
On Windows, `pip install ctranslate2` places `ct2-transformers-converter.exe` in
`%APPDATA%\Python\Python3xx\Scripts`, which is not on `PATH` by default. Calling
it via `subprocess` fails with "command not found" on any machine where the user
hasn't manually added that directory to their PATH — which is the common case on
both dev and client machines. `ctranslate2.converters.TransformersConverter` is the
same conversion logic exposed as a Python API and requires no PATH configuration.

**CLI usage:**
```bash
python backend/stt/convert_models.py --model baseline
python backend/stt/convert_models.py --model specialized
python backend/stt/convert_models.py --model all
```

**Model ID mapping** (defined as constants, not hard-coded strings scattered everywhere):

```python
MODELS = {
    "baseline": {
        "hf_id": "openai/whisper-medium",
        "output_dir": "models/whisper-medium-ct2",
    },
    "specialized": {
        "hf_id": "ARTPARK-IISc/whisper-medium-vaani-kannada",
        "output_dir": "models/whisper-medium-vaani-ct2",
    },
}
```

---

### 2.5 `benchmark.py` — WER Comparison

Runs both models against the test set and emits a structured report.

**Flow:**

```
1. Load transcripts.json  →  dict {filename: ground_truth}
2. For each model in [baseline, specialized]:
   a. Instantiate KannadaTranscriber(model_path)
   b. For each clip in data/stt_test_audio/:
      - run transcribe(clip_path) → hypothesis
      - record inference time
   c. Compute WER(ground_truth_list, hypothesis_list) using jiwer
3. Build results table:
   [model_name, WER%, avg_inference_time_s, num_clips]
4. Save as benchmark_results.csv in project root (or configurable --output path)
5. Print table to stdout (tabulate or manual formatting)
```

**WER for Kannada script:**

Standard `jiwer` WER uses whitespace tokenization, which works for Kannada since words are space-separated in standard script. However, Kannada uses complex conjuncts (ಒತ್ತಕ್ಷರ), so the WER metric is fundamentally character-sensitive. The implementation will use **character error rate (CER)** alongside WER, as CER is more linguistically meaningful for agglutinative scripts like Kannada.

Both WER and CER will be reported in the CSV.

**Output CSV schema:**

```
model_name, wer_percent, cer_percent, avg_inference_time_s, num_clips, total_time_s
```

---

### 2.6 `__init__.py` — Public API

Exposes a clean, minimal interface for downstream modules (Translation, etc.):

```python
from backend.stt import transcribe

text = transcribe("path/to/audio.wav", model="specialized")
```

The `transcribe()` function:
- Accepts `model: Literal["baseline", "specialized"]`, defaults to `"specialized"`
- Accepts `beam_size: int = 1` — defaults to `1` (fast/production path); pass `5` from benchmark script for accuracy comparison
- Lazily instantiates `KannadaTranscriber` (singleton per model to avoid reload overhead)
- Returns `str`

---

## 3. Data Flow Diagram

```
[.wav file path]
      │
      ▼
validate_audio_file()
      │ STTInputError (bad file)
      │
      ▼
is_silent()?  ──yes──▶  return ""
      │ no
      ▼
WhisperModel.transcribe(
  language="kn",
  task="transcribe",
  vad_filter=True
)
      │
      ▼
concat segment texts
      │
      ▼
[Kannada text string]
```

---

## 4. Directory & File Layout

```
backend/stt/
├── __init__.py          ~30 lines   Public transcribe() function
├── transcriber.py       ~80 lines   KannadaTranscriber class
├── exceptions.py        ~10 lines   STTInputError
├── utils.py             ~50 lines   validate_audio_file, is_silent
├── convert_models.py    ~80 lines   CLI: HF → CTranslate2
└── benchmark.py         ~120 lines  WER/CER benchmark harness

data/stt_test_audio/
├── clip_001.wav  …  clip_020.wav
└── transcripts.json

models/
├── whisper-medium-ct2/
└── whisper-medium-vaani-ct2/
```

---

## 5. Dependencies

All already expected in `requirements.txt`:

| Package | Role |
|---------|------|
| `faster-whisper` | Inference wrapper around CTranslate2 Whisper |
| `ctranslate2` | Quantized model runtime (int8 CPU/GPU) |
| `transformers` | Used by convert_models.py to pull HF checkpoints |
| `huggingface_hub` | Model download / cache management |
| `jiwer` | WER and CER computation |
| `soundfile` | Audio validation (read headers) |
| `numpy` | RMS silence detection |
| `torch` | CUDA availability check only (`torch.cuda.is_available()`) |
| `tabulate` | Pretty-print benchmark table to stdout |

> `jiwer`, `soundfile`, `tabulate` may need to be added to `requirements.txt` — confirmed in Task 1.

---

## 6. Error Handling Strategy

| Scenario | Behaviour |
|----------|-----------|
| File not found | `STTInputError("Audio file not found: <path>")` |
| Unsupported format (not .wav) | `STTInputError("Unsupported format '<ext>'. Only .wav is supported.")` |
| Corrupted file | `STTInputError("Could not read audio file '<path>': <underlying error>")` |
| Silent audio | Returns `""` (no exception) |
| Model files missing | `FileNotFoundError` with message pointing to `convert_models.py` |
| No CUDA | Gracefully falls back to `device="cpu"` — no error |

---

## 7. Key Design Decisions

**Why faster-whisper over the original openai/whisper?**  
`faster-whisper` uses CTranslate2 under the hood, giving 2–4× speed improvement and native int8 quantization on CPU with no extra conversion step needed at inference time. This is critical for the ≤10 second latency target.

**Why int8 quantization?**  
Whisper-medium in float32 is ~1.5 GB. int8 reduces this to ~400 MB, making it comfortably fit in 16 GB RAM alongside the OS and other processes.

**Why force `language="kn"`?**  
Language auto-detection costs 1–2 seconds and adds latency. Since this is a Kannada-only assistant, forcing the language is both faster and more reliable.

**Why include both WER and CER?**  
Kannada is an agglutinative, phonetically complex script. A single wrongly-recognised conjunct character can make an entire word unrecognisable under WER (whole-word metric), while CER captures partial matches more fairly. Reporting both gives evaluators a complete picture.

**Why a singleton pattern for model loading in `__init__.py`?**  
Loading a CTranslate2 model takes 2–5 seconds. In the full pipeline, the STT module will be called repeatedly (multiple user turns). A module-level singleton avoids reloading the model on each call.
