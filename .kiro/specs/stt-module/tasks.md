# STT Module — Implementation Tasks

## Task Overview

Tasks are ordered by dependency. Each task is small, independently reviewable, and maps to one or two files. No task generates the entire module at once.

```
Task 1: Project scaffolding & dependencies
Task 2: exceptions.py + utils.py (validation helpers)
Task 3: transcriber.py (core inference class)
Task 4: __init__.py (public API + singleton)
Task 5: convert_models.py (model conversion CLI)
Task 6: Test data setup (audio clips + transcripts.json)
Task 7: benchmark.py (WER/CER harness + CSV output)
Task 8: End-to-end smoke test
```

---

## Task 1 — Project Scaffolding & Dependency Audit

**Goal:** Create the directory structure and verify all required packages are in `requirements.txt`.

- [ ] Create `backend/stt/` directory with empty `__init__.py`
- [ ] Create `data/stt_test_audio/` directory with a placeholder `transcripts.json` (`{}`)
- [ ] Create `models/` directory and add it to `.gitignore` (model binaries are large)
- [ ] Audit `requirements.txt` — add missing packages if not already present:
  - `faster-whisper`
  - `ctranslate2`
  - `transformers`
  - `huggingface_hub`
  - `jiwer`
  - `soundfile`
  - `numpy`
  - `torch`
  - `tabulate`
- [ ] Verify the package list is consistent (no version conflicts between faster-whisper and ctranslate2)

**Deliverables:** `backend/stt/__init__.py` (empty), `data/stt_test_audio/transcripts.json`, `models/.gitkeep`, updated `requirements.txt`

---

## Task 2 — Exceptions & Audio Validation Utilities

**Goal:** Implement `exceptions.py` and `utils.py`. These have no model dependencies and can be tested immediately.

- [ ] Implement `backend/stt/exceptions.py`:
  - Define `STTInputError(Exception)` with a docstring

- [ ] Implement `backend/stt/utils.py`:
  - `validate_audio_file(path: str) -> None`
    - Check file exists → `STTInputError`
    - Check extension is `.wav` → `STTInputError`
    - Try opening with `soundfile.info()` → `STTInputError` on failure
  - `is_silent(audio_array: np.ndarray, threshold: float = 0.01) -> bool`
    - Return `True` if `np.sqrt(np.mean(audio_array**2)) < threshold`

- [ ] Manual test (no framework needed): call `validate_audio_file` on a non-existent path, a `.mp3` path, and a valid `.wav` path; verify correct behaviour

**Deliverables:** `backend/stt/exceptions.py`, `backend/stt/utils.py`

---

## Task 3 — Core Transcriber Class

**Goal:** Implement `KannadaTranscriber` in `transcriber.py`. This is the most important file — the model inference wrapper.

**Prerequisite:** At least one converted model in `models/` (can use a stub/mock path for unit-level review; real model needed for smoke test in Task 8).

- [ ] Implement `backend/stt/transcriber.py`:
  - `KannadaTranscriber.__init__(model_path, device=None, compute_type="int8")`
    - Auto-detect `device` using `torch.cuda.is_available()` if not specified
    - Instantiate `faster_whisper.WhisperModel(model_path, device=device, compute_type=compute_type)`
    - Raise `FileNotFoundError` with helpful message if `model_path` does not exist
  - `KannadaTranscriber.transcribe(audio_path: str, beam_size: int = 1) -> str`
    - Call `validate_audio_file(audio_path)` first
    - Run `self.model.transcribe(audio_path, language="kn", task="transcribe", beam_size=beam_size, vad_filter=True)`
    - Default `beam_size=1` (greedy) to meet the ≤10s latency requirement on CPU. Callers (e.g. benchmark.py) can pass `beam_size=5` for the accuracy-focused run.
    - Measure wall-clock time → store in `self.last_inference_time_s`
    - Concatenate all segment `.text` fields → strip whitespace → return
    - Return `""` if no segments (silence handled by `vad_filter`)

- [ ] Add type hints and docstrings to all public methods

**Deliverables:** `backend/stt/transcriber.py`

---

## Task 4 — Public API (`__init__.py`)

**Goal:** Expose a clean `transcribe()` function that downstream modules (and benchmark script) can call without knowing about `KannadaTranscriber` internals.

- [ ] Implement `backend/stt/__init__.py`:
  - Module-level dict `_model_cache: dict[str, KannadaTranscriber]` for singleton storage
  - `MODEL_PATHS` constant dict mapping `"baseline"` and `"specialized"` to their local model directories
  - `transcribe(audio_path: str, model: str = "specialized", beam_size: int = 1) -> str`
    - Validate `model` argument is one of the known keys → `ValueError` if not
    - Lazy-load `KannadaTranscriber` into `_model_cache` on first call for that model
    - Delegate to `KannadaTranscriber.transcribe(audio_path, beam_size=beam_size)`
  - `__all__ = ["transcribe", "STTInputError"]`

**Deliverables:** `backend/stt/__init__.py` (complete version)

---

## Task 5 — Model Conversion CLI

**Goal:** Implement the one-time script that downloads HuggingFace checkpoints and converts them to CTranslate2 int8 format.

- [ ] Implement `backend/stt/convert_models.py`:
  - Define `MODELS` dict with `hf_id` and `output_dir` for both models (as per design.md)
  - `convert_model(model_key: str) -> None`:
    - Use `ctranslate2.converters.TransformersConverter` directly — **no subprocess call**:
      ```python
      from ctranslate2.converters import TransformersConverter
      converter = TransformersConverter(hf_id, low_cpu_mem_usage=True)
      converter.convert(output_dir, quantization="int8", force=True)
      ```
    - This avoids the Windows PATH problem where `ct2-transformers-converter.exe`
      is installed to `%APPDATA%\Python\Python3xx\Scripts` but not on `PATH` by default.
      The programmatic API is identical in behaviour to the CLI tool.
    - Verify `model.bin` exists in `output_dir` after conversion
    - Print file size of `model.bin`
  - `argparse` CLI: `--model {baseline,specialized,all}`
  - `if __name__ == "__main__"` guard
  - `argparse` CLI: `--model {baseline,specialized,all}`
  - `if __name__ == "__main__"` guard

- [ ] Add a note at the top of the file: "Run this script once before using the STT module."

**Deliverables:** `backend/stt/convert_models.py`

---

## Task 6 — Test Data Setup

**Goal:** Create the 15–20 Kannada banking audio clips and ground-truth transcripts needed for benchmarking.

- [ ] Create `data/stt_test_audio/transcripts.json` with at least 15 entries. Suggested banking phrases in Kannada:

  ```json
  {
    "clip_001.wav": "ನನ್ನ ಖಾತೆಯ ಬಾಕಿ ಎಷ್ಟಿದೆ",
    "clip_002.wav": "ಹಣ ವರ್ಗಾಯಿಸಲು ಸಹಾಯ ಮಾಡಿ",
    "clip_003.wav": "ಸಾಲ ಅರ್ಜಿ ಹೇಗೆ ಮಾಡಬೇಕು",
    "clip_004.wav": "ನನ್ನ ಖಾತೆ ತೆರೆಯಬೇಕು",
    "clip_005.wav": "ಮಿನಿ ಸ್ಟೇಟ್ಮೆಂಟ್ ಬೇಕು",
    "clip_006.wav": "ಎಟಿಎಂ ಕಾರ್ಡ್ ಬ್ಲಾಕ್ ಮಾಡಿ",
    "clip_007.wav": "ಪಿನ್ ಬದಲಾಯಿಸಬೇಕು",
    "clip_008.wav": "ಐದು ಸಾವಿರ ರೂಪಾಯಿ ಹಿಂತೆಗೆದುಕೊಳ್ಳಬೇಕು",
    "clip_009.wav": "ನನ್ನ ಮೊಬೈಲ್ ನಂಬರ್ ಬದಲಾಯಿಸಿ",
    "clip_010.wav": "ಫಿಕ್ಸೆಡ್ ಡಿಪಾಸಿಟ್ ಮಾಡಬೇಕು",
    "clip_011.wav": "ಚೆಕ್ ಬುಕ್ ಬೇಕು",
    "clip_012.wav": "ಇಂಟರ್ನೆಟ್ ಬ್ಯಾಂಕಿಂಗ್ ಸಕ್ರಿಯಗೊಳಿಸಿ",
    "clip_013.wav": "ನನ್ನ ಹೆಸರು ಬದಲಾಯಿಸಬೇಕು",
    "clip_014.wav": "ಲೋನ್ ಮರುಪಾವತಿ ಎಷ್ಟು",
    "clip_015.wav": "ನೆರೆಯ ಶಾಖೆ ಎಲ್ಲಿದೆ"
  }
  ```

- [ ] Record audio clips using a microphone (or use text-to-speech as placeholder for initial testing):
  - Each clip should be a native Kannada speaker reading the corresponding phrase
  - Save as `.wav`, 16 kHz, mono
  - Silence-padded to ~1 second at start and end is fine
  - If real recordings are not available yet, document how to use `gTTS` or `espeak-ng` to generate placeholder `.wav` files for early pipeline smoke-testing only
  - **WARNING:** Do NOT use TTS-generated audio for final benchmark numbers. Synthetic speech is artificially clean and will produce unrealistically low WER/CER, making the results meaningless. Final benchmark must use real human-recorded Kannada audio (yourself, teammates, or family reading the phrases).

- [ ] Validate all filenames in `transcripts.json` match actual `.wav` files present

**Deliverables:** `data/stt_test_audio/transcripts.json`, `data/stt_test_audio/clip_001.wav` … `clip_015.wav`

---

## Task 7 — Benchmark Script

**Goal:** Implement `benchmark.py` — the WER/CER comparison harness.

**Prerequisite:** Both converted models in `models/`, test data from Task 6.

- [ ] Implement `backend/stt/benchmark.py`:
  - `load_test_data(data_dir: str) -> dict[str, str]`
    - Load `transcripts.json` → return `{filename: ground_truth}`
    - Raise `FileNotFoundError` if json missing
  - `run_model_benchmark(model_key: str, test_data: dict, data_dir: str, beam_size: int = 5) -> dict`
    - Instantiate `KannadaTranscriber` for the given model
    - Loop over test clips, collect hypotheses and inference times using `beam_size=5` by default (accuracy matters more than speed here, since benchmarking is not a live user interaction — and it gives you the beam_size=1 vs beam_size=5 tradeoff as an additional report data point)
    - Return `{model_key, hypotheses, ground_truths, inference_times}`
  - `compute_metrics(ground_truths: list[str], hypotheses: list[str]) -> tuple[float, float]`
    - Use `jiwer.wer()` for WER
    - Use `jiwer.cer()` for CER
    - Return `(wer_percent, cer_percent)` rounded to 2 decimal places
  - `save_results(results: list[dict], output_path: str) -> None`
    - Write CSV with columns: `model_name,wer_percent,cer_percent,avg_inference_time_s,num_clips,total_time_s`
    - Also print a formatted table using `tabulate`
  - `main()` with `argparse`:
    - `--data-dir` (default: `data/stt_test_audio`)
    - `--output` (default: `benchmark_results.csv`)
    - `--models` (default: `all`, or `baseline`/`specialized`)

- [ ] Verify CSV is saved correctly after a dry-run with mock data

**Deliverables:** `backend/stt/benchmark.py`

---

## Task 8 — End-to-End Smoke Test

**Goal:** Verify the full pipeline works with real models and real audio on both GPU (dev) and CPU (simulated deployment).

**Prerequisite:** All tasks 1–7 complete, models converted, at least 3 audio clips available.

- [ ] Run `convert_models.py --model all` on dev machine (GPU) — confirm both model directories are created
- [ ] Run a quick inference check:
  ```python
  from backend.stt import transcribe
  result = transcribe("data/stt_test_audio/clip_001.wav", model="specialized")
  print(result)  # Should print Kannada text
  ```
- [ ] Run the same inference with `model="baseline"` and compare outputs
- [ ] Run `benchmark.py` on all test clips — confirm `benchmark_results.csv` is created
- [ ] Confirm WER(specialized) < WER(baseline) (expected — this validates the project hypothesis)
- [ ] Test CPU-only mode by setting `CUDA_VISIBLE_DEVICES=""` before running — confirm no crash
- [ ] Test error handling:
  - Pass a non-existent file path → confirm `STTInputError` is raised
  - Pass a `.mp3` file → confirm `STTInputError` is raised
  - Pass a silent `.wav` → confirm empty string returned

**Deliverables:** Working end-to-end system, `benchmark_results.csv` with real numbers, documented in a short `backend/stt/README.md`

---

## Dependencies Between Tasks

```
Task 1 (scaffolding)
    ├── Task 2 (exceptions + utils)
    │       └── Task 3 (transcriber)
    │               ├── Task 4 (public API)
    │               └── Task 5 (model conversion) ──┐
    │                                                 │
    ├── Task 6 (test data)                            │
    │                                                 ▼
    └─────────────────────────────────── Task 7 (benchmark) ──▶ Task 8 (smoke test)
```

Tasks 2 and 6 can be done in parallel. Task 5 (model conversion) is a prerequisite for running real inference but the code in Tasks 3 and 4 can be reviewed without real model files.
