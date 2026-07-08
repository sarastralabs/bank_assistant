# Implementation Plan: TTS Module

## Overview

Five tasks. The model is loaded directly via `from_pretrained()` — no conversion step. The only non-trivial dependency is the `parler-tts` package install and HuggingFace authentication (same process as IndicTrans2).

## Tasks

- [ ] 1. Dependency install and HuggingFace auth
- [ ] 2. KannadaSpeaker class (core synthesis wrapper)
- [ ] 3. Public API with singleton cache
- [ ] 4. End-to-end smoke test with real audio
- [ ] 5. Integration into demo_pipeline.py

## Task Dependency Graph

```
Task 1 (deps + auth)
    └── Task 2 (KannadaSpeaker)
            └── Task 3 (public API)
                    └── Task 4 (smoke test)
                            └── Task 5 (demo pipeline integration)
```

## Notes

- `parler-tts` installs via git URL — no Cython, no C++ build tools
- `sounddevice` is optional for playback; synthesis and save always work without it
- Both `ai4bharat/indic-parler-tts` model and `google/flan-t5-large` (description encoder) need to be downloaded — allow ~4–5 GB total disk space
- `bfloat16` on CUDA, `float32` on CPU — same device detection pattern as all other modules

---

### Task 1 — Dependency Install and HuggingFace Auth

**Goal:** Install `parler-tts`, verify it imports correctly, and confirm HuggingFace auth covers the gated `ai4bharat/indic-parler-tts` model.

- [ ] Install parler-tts:
  ```bash
  pip install git+https://github.com/huggingface/parler-tts.git
  ```
- [ ] Install sounddevice (optional, for audio playback):
  ```bash
  pip install sounddevice
  ```
- [ ] Add both to `requirements.txt` under `# ── TTS Module (Module 5) ──`
- [ ] Verify parler-tts imports:
  ```bash
  python -c "from parler_tts import ParlerTTSForConditionalGeneration; print('OK')"
  ```
- [ ] Accept HuggingFace terms for `ai4bharat/indic-parler-tts`:
  - Visit https://huggingface.co/ai4bharat/indic-parler-tts
  - Click "Agree and access repository"
- [ ] Verify access:
  ```bash
  python -c "from huggingface_hub import model_info; print(model_info('ai4bharat/indic-parler-tts').id)"
  ```

**Deliverables:** `parler-tts` installed, updated `requirements.txt`, HF auth confirmed

---

### Task 2 — KannadaSpeaker Class

**Goal:** Implement `speaker.py` — the Parler-TTS inference wrapper.

- [ ] Create `backend/tts/` directory with placeholder `__init__.py`
- [ ] Implement `backend/tts/speaker.py`:
  - `DEFAULT_VOICE_DESCRIPTION` constant
  - `_detect_device() -> str` — same pattern as all other modules
  - `KannadaSpeaker.__init__(model_id, device, torch_dtype)`:
    - Auto-detect device and dtype
    - Load `ParlerTTSForConditionalGeneration.from_pretrained(model_id, torch_dtype=dtype).to(device).eval()`
    - Load `AutoTokenizer.from_pretrained(model_id)` — prompt tokenizer
    - Load `AutoTokenizer.from_pretrained(model.config.text_encoder._name_or_path)` — description tokenizer
  - `KannadaSpeaker.synthesise(english_text, voice_description, output_path, play) -> tuple[np.ndarray, int] | None`:
    - Return `None` for empty input
    - Call `translate_en_to_kn(english_text)` — import from `backend.translation`
    - Return `None` if translation returns empty string
    - Tokenize both inputs, run `model.generate()` under `torch.inference_mode()`
    - Squeeze output to NumPy float32 at model's sampling rate
    - Save to `output_path` if given
    - Play via `sounddevice` if `play=True` and sounddevice is available

- [ ] Syntax check: `python -m py_compile backend/tts/speaker.py`

**Deliverables:** `backend/tts/speaker.py`, `backend/tts/__init__.py` (placeholder)

---

### Task 3 — Public API with Singleton Cache

**Goal:** Implement `__init__.py` with the `synthesise()` public function.

- [ ] Implement `backend/tts/__init__.py`:
  - Module-level `_speaker: KannadaSpeaker | None = None`
  - `DEFAULT_MODEL_ID = "ai4bharat/indic-parler-tts"`
  - `synthesise(english_text, voice_description=None, output_path=None, play=False) -> tuple[np.ndarray, int] | None`
    - Return `None` for empty/whitespace input — no model load
    - Lazy-instantiate `KannadaSpeaker` into `_speaker` on first call
    - `voice_description=None` → use `DEFAULT_VOICE_DESCRIPTION` from `speaker.py`
    - Delegate to `_speaker.synthesise()`
  - `__all__ = ["synthesise"]`
- [ ] Syntax check all files

**Deliverables:** `backend/tts/__init__.py` (complete)

---

### Task 4 — End-to-End Smoke Test with Real Audio

**Goal:** Verify synthesis works with a real banking response string and produce a listenable .wav file.

**Prerequisite:** HF auth complete, model downloaded on first call (allow ~5–10 minutes).

- [ ] Create `data/tts_output/` directory (gitignored)
- [ ] Run smoke test:
  ```python
  from backend.tts import synthesise

  # Test with the check_balance informational response
  result = synthesise(
      "Real-time balance lookup is not available in this demonstration. "
      "For your current balance, please visit a branch or use the ATM.",
      output_path="data/tts_output/test_check_balance.wav",
  )
  assert result is not None
  audio, sr = result
  print(f"Audio shape: {audio.shape}, sample rate: {sr}")
  # Play it to verify it sounds like natural Kannada speech
  ```
- [ ] Listen to `data/tts_output/test_check_balance.wav` and confirm:
  - Language is Kannada (not English or garbled)
  - Voice is intelligible
  - Duration is reasonable (5–15 seconds for ~2 sentences)
- [ ] Test empty input returns `None`:
  ```python
  assert synthesise("") is None
  assert synthesise("   ") is None
  ```

**Deliverables:** Working end-to-end synthesis, `data/tts_output/test_check_balance.wav`

---

### Task 5 — Integration into demo_pipeline.py

**Goal:** Add TTS as the final stage in the end-to-end demo script.

- [ ] Update `backend/demo_pipeline.py`:
  - Import `synthesise` from `backend.tts`
  - Add Stage 5 after the router step:
    ```python
    audio, sr = synthesise(
        result["response_text"],
        output_path=f"data/tts_output/{clip_name}.wav",
    )
    ```
  - Add `[TTS]` line to the per-clip output: file path + duration
  - Add `tts_output` column to the summary table
  - Handle TTS errors gracefully (catch exception, print, continue)
- [ ] Run `python backend/demo_pipeline.py --all` and confirm .wav files are created for all 11 clips
- [ ] Write `backend/tts/README.md` covering:
  - HuggingFace auth requirement (same section format as Translation module README)
  - Usage examples
  - Voice description customisation
  - CPU vs GPU memory requirements

**Deliverables:** Updated `demo_pipeline.py`, 11 `.wav` output files, `backend/tts/README.md`
