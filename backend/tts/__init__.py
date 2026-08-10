"""
backend/tts/__init__.py

Public API for the TTS (Text-to-Speech) module.

Preferred engine: AI4Bharat Indic Parler-TTS (Suresh / Anu) via isolated
.venv-parler worker. Falls back to facebook/mms-tts-kan if Parler is unavailable.
"""

from __future__ import annotations

import os
import warnings

import numpy as np
import soundfile as sf

from backend.tts.speaker import KannadaSpeaker, _DEFAULT_MODEL_ID

__all__ = ["synthesise", "synthesise_kannada", "unload_model", "parler_status"]

_speaker: KannadaSpeaker | None = None


def parler_status() -> dict:
    from backend.tts.parler_bridge import default_speaker, parler_available, _parler_python

    return {
        "available": parler_available(),
        "python": _parler_python(),
        "speaker": default_speaker(),
        "engine_env": os.environ.get("BANK_TTS_ENGINE", "auto"),
    }


def _play_audio(audio: np.ndarray, sr: int) -> None:
    try:
        import sounddevice as sd

        sd.play(audio, sr)
        sd.wait()
    except ImportError:
        warnings.warn(
            "sounddevice not installed -- playback skipped. pip install sounddevice",
            stacklevel=3,
        )
    except Exception as exc:
        warnings.warn("Playback failed: " + str(exc), stacklevel=3)


def _save_audio(audio: np.ndarray, sr: int, output_path: str) -> None:
    out_dir = os.path.dirname(output_path)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    sf.write(output_path, audio, sr)


def synthesise_kannada(
    kannada_text: str,
    output_path: str | None = None,
    play: bool = False,
    voice_description: str | None = None,
) -> tuple[np.ndarray, int] | None:
    """
    Synthesise from Kannada text.

    Prefer Indic Parler-TTS (Suresh/Anu). MMS only when BANK_TTS_ENGINE=mms/auto
    fallback is allowed — never silently replace Parler when engine=parler.
    """
    if not kannada_text or not kannada_text.strip():
        return None

    speaker = None
    if voice_description:
        v = voice_description.strip().lower()
        if "anu" in v:
            speaker = "Anu"
        elif "suresh" in v:
            speaker = "Suresh"

    from backend.tts.parler_bridge import parler_available, synthesise_kannada_parler

    engine = os.environ.get("BANK_TTS_ENGINE", "parler").strip().lower()
    force_parler = engine in {"parler", "indic-parler"}
    allow_mms = engine in {"mms", "mms-tts", "auto", "off", ""}

    if force_parler or parler_available():
        try:
            audio, sr = synthesise_kannada_parler(kannada_text, speaker=speaker)
            if output_path:
                _save_audio(audio, sr, output_path)
            if play:
                _play_audio(audio, sr)
            return audio, sr
        except Exception as exc:
            if force_parler:
                raise RuntimeError(
                    f"Natural Kannada voice (Parler) failed: {exc}. "
                    "Do not use MMS — fix Parler/GPU, then retry."
                ) from exc
            warnings.warn(
                f"Parler-TTS failed ({exc}); falling back to MMS-TTS",
                stacklevel=2,
            )

    if not allow_mms or force_parler:
        raise RuntimeError(
            "Parler-TTS is required for natural Kannada (BANK_TTS_ENGINE=parler) "
            "but is not available. Check .venv-parler and GPU memory."
        )

    global _speaker
    if _speaker is None:
        _speaker = KannadaSpeaker(_DEFAULT_MODEL_ID)
    return _speaker.synthesise_kannada(
        kannada_text,
        output_path=output_path,
        play=play,
    )


def synthesise(
    english_text: str,
    output_path: str | None = None,
    play: bool = False,
    voice_description: str | None = None,
) -> tuple[np.ndarray, int] | None:
    """
    Translate English → Kannada, then synthesise with Parler (natural Kannada).
    """
    if not english_text or not english_text.strip():
        return None

    from backend.translation import translate_en_to_kn, unload_model as unload_translation
    import gc
    import re

    parts = re.split(r"(?<=[.!?])\s+", english_text.strip())
    sentences = [p.strip() for p in parts if p.strip()] or [english_text.strip()]

    # Translate first (IndicTrans on GPU), then free VRAM for Parler worker.
    kannada_lines: list[str] = []
    for sentence in sentences:
        kannada = translate_en_to_kn(sentence)
        if kannada and kannada.strip():
            kannada_lines.append(kannada.strip())

    engine = os.environ.get("BANK_TTS_ENGINE", "parler").strip().lower()
    if engine in {"parler", "indic-parler", "auto"}:
        try:
            unload_translation("all")
        except Exception:
            pass
        try:
            import torch

            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass

    audio_parts: list[np.ndarray] = []
    sr_out = 22050
    silence = None

    for kannada in kannada_lines:
        result = synthesise_kannada(
            kannada,
            play=False,
            voice_description=voice_description,
        )
        if result is None:
            continue
        audio, sr_out = result
        if silence is None:
            silence = np.zeros(int(0.35 * sr_out), dtype=np.float32)
        audio_parts.append(audio)
        if len(kannada_lines) > 1:
            audio_parts.append(silence)

    if not audio_parts:
        return None
    if len(kannada_lines) > 1 and audio_parts:
        audio_parts = audio_parts[:-1]

    audio = np.concatenate(audio_parts)
    if output_path:
        _save_audio(audio, sr_out, output_path)
    if play:
        _play_audio(audio, sr_out)
    return audio, sr_out


def unload_model() -> None:
    """Release MMS speaker + stop Parler worker."""
    import gc

    import torch

    from backend.tts.parler_bridge import stop_worker

    global _speaker
    _speaker = None
    stop_worker()
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
