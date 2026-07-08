"""
backend/tts/__init__.py

Public API for the TTS (Text-to-Speech) module.

Quick-start
-----------
    from backend.tts import synthesise

    audio, sr = synthesise(
        "For account-related queries, please visit your nearest branch.",
        output_path="data/tts_output/response.wav",
    )

The underlying KannadaSpeaker is lazily instantiated on the first call and
cached for the process lifetime -- same singleton pattern as all other modules.
"""

from __future__ import annotations

import numpy as np
from backend.tts.speaker import KannadaSpeaker, _DEFAULT_MODEL_ID

__all__ = ["synthesise", "unload_model"]

_speaker: KannadaSpeaker | None = None


def synthesise(
    english_text: str,
    output_path: str | None = None,
    play: bool = False,
    voice_description: str | None = None,
) -> tuple[np.ndarray, int] | None:
    """
    Translate English text to Kannada and synthesise spoken audio.

    Parameters
    ----------
    english_text:
        English text to speak (Decision Router's response_text).
    output_path:
        Save audio to this .wav path if given. Parent dirs auto-created.
    play:
        Play via sounddevice if True. Silently skipped if not installed.
    voice_description:
        Accepted for API compatibility; ignored by MMS-TTS.

    Returns
    -------
    tuple[np.ndarray, int] | None
        (float32 audio array, sample_rate) or None for empty input.
    """
    global _speaker
    if not english_text or not english_text.strip():
        return None
    if _speaker is None:
        _speaker = KannadaSpeaker(_DEFAULT_MODEL_ID)
    return _speaker.synthesise(
        english_text,
        output_path=output_path,
        play=play,
        voice_description=voice_description,
    )


def unload_model() -> None:
    """
    Release the cached TTS speaker from memory.
    """
    import gc
    import torch

    global _speaker
    _speaker = None
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
