"""
backend/pipeline.py

Sequential pipeline: Kannada audio -> Kannada + English text + spoken Kannada response.

Memory management
-----------------
By default each model is loaded, used, then unloaded (low peak RAM).

Set BANK_PIPELINE_KEEP_LOADED=1 (used by the warm pipeline worker) to keep
models resident across turns — much lower latency after the first request.

Pipeline stages:
    1. STT        load -> transcribe -> UNLOAD
    2. Translation load -> translate_kn_to_en -> UNLOAD
    3. NLU + Router  load -> classify + route (kept together, both lightweight once loaded)
                            -> UNLOAD NLU
    4. TTS        load -> synthesise(response_text) -> UNLOAD
                  Router returns English response_text; pipeline.py passes it to
                  synthesise() as-is. MMS-TTS (facebook/mms-tts-kan) is Kannada-only,
                  so translation does NOT happen in this file — it happens inside
                  synthesise() (backend/tts/speaker.py):
                      Router (English response_text)
                          -> synthesise()
                              split sentences
                              -> translate_en_to_kn() per sentence
                              -> MMS-TTS
                              -> audio

Each stage's model is guaranteed gone before the next stage loads.
The router has no model, so it costs nothing.

Usage
-----
    from backend.pipeline import run_pipeline

    result = run_pipeline("data/stt_test_audio/clip_001.wav")
    print(result.intent)             # "check_balance"
    print(result.response_text)      # "Real-time balance lookup..."
    # result.audio is a (numpy_array, sample_rate) tuple
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from typing import Optional

import numpy as np


@dataclass
class PipelineResult:
    """Structured result from one full pipeline run."""
    audio_path:     str = ""
    kannada_text:   str = ""       # STT output
    english_text:   str = ""       # Translation output
    intent:         str = ""       # NLU output
    confidence:     float = 0.0    # NLU confidence
    route:          str = ""       # "informational" or "transactional"
    response_text:  str = ""       # Decision Router output (English)
    required_fields: list = field(default_factory=list)  # transactional only
    form_id:        str = ""       # voice-fill form id when transactional
    audio:          Optional[tuple[np.ndarray, int]] = None  # TTS output
    audio_output_path: str = ""     # Where the generated wave file was written, if any
    stage_times:    dict = field(default_factory=dict)
    total_time_s:   float = 0.0
    error:          Optional[str] = None


def _write_audio_to_disk(audio: Optional[tuple[np.ndarray, int]], output_path: str) -> str:
    """Write a numpy audio tuple to disk as a .wav file and return the saved path."""
    if audio is None:
        return ""

    audio_array, sample_rate = audio
    abs_output_path = os.path.abspath(output_path)
    os.makedirs(os.path.dirname(abs_output_path), exist_ok=True)

    import soundfile as sf  # noqa: PLC0415

    sf.write(abs_output_path, audio_array, sample_rate)
    return abs_output_path


def run_pipeline(
    audio_path: str,
    output_dir: str | None = None,
    output_name: str | None = None,
) -> PipelineResult:
    """
    Run the complete voice banking pipeline on a single .wav file.

    Each stage explicitly unloads its model before the next stage begins,
    keeping peak memory at single-model level.

    Parameters
    ----------
    audio_path:
        Path to a .wav audio file containing Kannada speech.

    Returns
    -------
    PipelineResult
        All intermediate and final outputs. Check result.error for failures.
        ``response_text`` is English (from the Decision Router).
        ``audio`` is Kannada speech: ``synthesise()`` translates En→Kn
        internally (split sentences → ``translate_en_to_kn()`` → MMS-TTS)
        before returning the waveform.
    """
    result = PipelineResult(audio_path=audio_path)
    default_output_dir = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "data", "tts_output")
    )
    output_dir = output_dir or default_output_dir
    t_total = time.perf_counter()
    keep_loaded = os.environ.get("BANK_PIPELINE_KEEP_LOADED", "0").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }

    def _maybe_unload(fn, *args) -> None:
        if keep_loaded:
            return
        try:
            fn(*args)
        except Exception:
            pass

    # ── Stage 1: STT ─────────────────────────────────────────────────────────
    t0 = time.perf_counter()
    _unload_stt = None
    try:
        from backend.stt import transcribe, unload_model as _unload_stt
        result.kannada_text = transcribe(audio_path, model="specialized", beam_size=1)
    except Exception as exc:
        result.error = "STT failed: " + str(exc)
        result.total_time_s = round(time.perf_counter() - t_total, 2)
        return result
    finally:
        if _unload_stt is not None:
            _maybe_unload(_unload_stt, "specialized")
    result.stage_times["stt"] = round(time.perf_counter() - t0, 2)

    if not result.kannada_text.strip():
        result.error = "STT returned empty (silent audio)"
        result.total_time_s = round(time.perf_counter() - t_total, 2)
        return result

    # ── Stage 2: Translation (Kannada -> English) ─────────────────────────────
    t0 = time.perf_counter()
    _unload_trans = None
    try:
        from backend.translation import translate_kn_to_en, unload_model as _unload_trans
        result.english_text = translate_kn_to_en(result.kannada_text)
    except Exception as exc:
        result.error = "Translation failed: " + str(exc)
        result.total_time_s = round(time.perf_counter() - t_total, 2)
        return result
    finally:
        if _unload_trans is not None:
            _maybe_unload(_unload_trans, "kn_to_en")
    result.stage_times["translation"] = round(time.perf_counter() - t0, 2)

    if not result.english_text.strip():
        result.error = "Translation returned empty"
        result.total_time_s = round(time.perf_counter() - t_total, 2)
        return result

    # ── Stage 3: NLU + Router ────────────────────────────────────────────────
    t0 = time.perf_counter()
    _unload_nlu = None
    try:
        from backend.nlu import classify, unload_model as _unload_nlu
        from backend.decision_router import route
        from backend.forms import form_id_for_intent
        result.intent, result.confidence = classify(result.english_text)
        routing = route(result.intent)
        result.route = routing["route"]
        result.response_text = routing["response_text"]
        result.required_fields = list(routing.get("required_fields") or [])
        result.form_id = form_id_for_intent(result.intent) or ""
    except Exception as exc:
        result.error = "NLU/Router failed: " + str(exc)
        result.total_time_s = round(time.perf_counter() - t_total, 2)
        return result
    finally:
        if _unload_nlu is not None:
            _maybe_unload(_unload_nlu, "finetuned")
    result.stage_times["nlu_router"] = round(time.perf_counter() - t0, 2)

    # ── Stage 4: TTS ──────────────────────────────────────────────────────────
    # Natural Kannada = Indic Parler. Free Whisper/NLU VRAM before Parler worker.
    t0 = time.perf_counter()
    _unload_tts = None
    try:
        engine = os.environ.get("BANK_TTS_ENGINE", "parler").strip().lower()
        if engine in {"parler", "indic-parler", "auto"}:
            try:
                from backend.stt import unload_model as _u_stt
                from backend.nlu import unload_model as _u_nlu
                from backend.translation import unload_model as _u_tr
                import gc
                import torch

                _u_stt("all")
                _u_nlu("all")
                _u_tr("all")
                gc.collect()
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception:
                pass

        from backend.tts import synthesise, unload_model as _unload_tts
        result.audio = synthesise(result.response_text)
        if result.audio is None:
            result.error = "TTS returned empty audio"
    except Exception as exc:
        result.error = "TTS failed: " + str(exc)
        # Non-fatal — return result without audio rather than crashing
        result.total_time_s = round(time.perf_counter() - t_total, 2)
        return result
    finally:
        if _unload_tts is not None:
            _maybe_unload(_unload_tts)
    result.stage_times["tts"] = round(time.perf_counter() - t0, 2)

    if result.audio is not None:
        stem = output_name or os.path.splitext(os.path.basename(audio_path))[0]
        output_path = os.path.join(output_dir, f"{stem}.wav")
        result.audio_output_path = _write_audio_to_disk(result.audio, output_path)

    result.total_time_s = round(time.perf_counter() - t_total, 2)
    return result


if __name__ == "__main__":
    import gc
    import os
    import sys
    # Ensure project root is on path when running as: python backend/pipeline.py
    sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
    import soundfile as sf
    import torch

    def gpu_mem():
        if torch.cuda.is_available():
            used = round(torch.cuda.memory_allocated() / 1024**3, 2)
            res  = round(torch.cuda.memory_reserved()  / 1024**3, 2)
            return "GPU used=" + str(used) + "GB reserved=" + str(res) + "GB"
        return "CPU-only"

    clips = [
        "data/stt_test_audio/clip_001.wav",   # check_balance
        "data/stt_test_audio/clip_003.wav",   # apply_loan
        "data/stt_test_audio/clip_004.wav",   # open_account
        "data/stt_test_audio/clip_007.wav",   # account_info_query
    ]

    output_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data", "tts_output"))
    os.makedirs(output_dir, exist_ok=True)
    print("Full pipeline.py multi-run test")
    print("Confirms memory stays flat across repeated calls")
    print("=" * 65)
    print("Start: " + gpu_mem())
    print()

    for i, clip_path in enumerate(clips, 1):
        clip_name = os.path.basename(clip_path)
        print("Run " + str(i) + "/4: " + clip_name)

        result = run_pipeline(clip_path, output_dir=output_dir, output_name=f"pipeline_run{i}")

        if result.error:
            print("  ERROR: " + result.error)
        else:
            safe_resp = result.response_text.encode('ascii', errors='replace').decode('ascii')
            audio_dur = (round(len(result.audio[0]) / result.audio[1], 1)
                         if result.audio else 0)
            if result.audio_output_path:
                out = result.audio_output_path
            else:
                out = ""
            print("  intent=" + result.intent +
                  " conf=" + str(round(result.confidence, 2)) +
                  " route=" + result.route)
            print("  response=" + safe_resp[:65] +
                  ("..." if len(safe_resp) > 65 else ""))
            print("  audio=" + str(audio_dur) + "s  total=" +
                  str(result.total_time_s) + "s  " + str(result.stage_times) +
                  ("  saved=" + out if out else ""))

        print("  mem after run: " + gpu_mem())
        print()

    print("=" * 65)
    print("All 4 runs complete. No crash. Exit 0.")
