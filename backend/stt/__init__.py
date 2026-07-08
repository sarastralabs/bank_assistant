"""
backend/stt/__init__.py

Public API for the Kannada STT module.

Quick-start
-----------
    from backend.stt import transcribe

    # Uses the Kannada-specialized model by default
    text = transcribe("data/stt_test_audio/clip_001.wav")

    # Use the generic baseline for comparison
    text = transcribe("data/stt_test_audio/clip_001.wav", model="baseline")

    # Use beam_size=5 for accuracy-critical paths (slower on CPU)
    text = transcribe("path/to/clip.wav", beam_size=5)

Models are loaded once and cached for the lifetime of the process.
Subsequent calls to transcribe() with the same model name reuse the
already-loaded instance, avoiding the 2–5 second reload cost.
"""

from __future__ import annotations

import os
from typing import Literal

from backend.stt.exceptions import STTInputError
from backend.stt.transcriber import KannadaTranscriber

__all__ = ["transcribe", "unload_model", "STTInputError"]

# ---------------------------------------------------------------------------
# Model path configuration
# All paths are relative to the project root.  Resolve to absolute so the
# module works regardless of the caller's working directory.
# ---------------------------------------------------------------------------
_PROJECT_ROOT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..")
)

MODEL_PATHS: dict[str, str] = {
    "baseline": os.path.join(_PROJECT_ROOT, "models", "whisper-medium-ct2"),
    "specialized": os.path.join(_PROJECT_ROOT, "models", "whisper-medium-vaani-ct2"),
}

# ---------------------------------------------------------------------------
# Singleton cache — keyed by model name
# ---------------------------------------------------------------------------
_model_cache: dict[str, KannadaTranscriber] = {}


def transcribe(
    audio_path: str,
    model: Literal["baseline", "specialized"] = "specialized",
    beam_size: int = 1,
) -> str:
    """
    Transcribe a Kannada ``.wav`` file and return the Kannada text.

    This is the primary entry-point for downstream pipeline modules
    (Translation, NLU, etc.).  It lazily loads the requested model on the
    first call and reuses it on subsequent calls.

    Parameters
    ----------
    audio_path:
        Path to the ``.wav`` audio file to transcribe.
    model:
        Which model to use:

        - ``"specialized"`` (default) — ``ARTPARK-IISc/whisper-medium-vaani-kannada``
          fine-tuned on the VAANI Kannada dataset.  Use this for production.
        - ``"baseline"`` — ``openai/whisper-medium``, the generic multilingual
          model.  Use this for benchmarking comparison only.
    beam_size:
        Beam search width.  ``1`` (default) is fast enough for real-time use
        on CPU.  Pass ``5`` for benchmark accuracy runs.

    Returns
    -------
    str
        Transcribed Kannada text, or ``""`` for silent/speech-free clips.

    Raises
    ------
    ValueError
        If *model* is not one of the recognised model names.
    STTInputError
        If the audio file is missing, unsupported, or corrupted.
    FileNotFoundError
        If the model directory has not been created yet.
        Run ``python backend/stt/convert_models.py --model all`` first.
    """
    if model not in MODEL_PATHS:
        valid = ", ".join(f'"{k}"' for k in MODEL_PATHS)
        raise ValueError(
            f"Unknown model '{model}'. Valid options are: {valid}."
        )

    # Lazy-load and cache the transcriber
    if model not in _model_cache:
        _model_cache[model] = KannadaTranscriber(MODEL_PATHS[model])

    return _model_cache[model].transcribe(audio_path, beam_size=beam_size)


def unload_model(model: str = "specialized") -> None:
    """
    Release the cached STT model from memory.

    Deletes the actual KannadaTranscriber object from the module-level
    _model_cache dict and frees GPU/CPU memory. Call this after
    transcription is complete in a memory-constrained pipeline.

    Parameters
    ----------
    model:
        ``"specialized"``, ``"baseline"``, or ``"all"`` to clear all cached models.
    """
    import gc
    import torch

    global _model_cache
    keys = list(_model_cache.keys()) if model == "all" else [model]
    for key in keys:
        if key in _model_cache:
            del _model_cache[key]
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
