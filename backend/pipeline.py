"""
backend/pipeline.py

Sequential pipeline: Kannada audio -> Kannada + English text + spoken Kannada response.

Memory management
-----------------
Each model is loaded, used, then explicitly unloaded before the next model
loads. This ensures peak memory never exceeds the cost of ONE heavy model,
preventing the Windows access violation (exit -1073740791) that occurs when
all four models load simultaneously.

Pipeline stages:
    1. STT        load -> transcribe -> UNLOAD
    2. Translation load -> translate -> UNLOAD
    3. NLU + Router  load -> classify + route (kept together, both lightweight once loaded)
                            -> UNLOAD NLU
    4. TTS        load -> synthesise -> UNLOAD

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
    """
    result = PipelineResult(audio_path=audio_path)
    default_output_dir = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "data", "tts_output")
    )
    output_dir = output_dir or default_output_dir
    t_total = time.perf_counter()

    # ── Stage 1: STT ─────────────────────────────────────────────────────────
    t0 = time.perf_counter()
    try:
        from backend.stt import transcribe, unload_model as _unload_stt
        result.kannada_text = transcribe(audio_path, model="specialized", beam_size=1)
    except Exception as exc:
        result.error = "STT failed: " + str(exc)
        result.total_time_s = round(time.perf_counter() - t_total, 2)
        return result
    finally:
        try:
            _unload_stt("specialized")
        except Exception:
            pass
    result.stage_times["stt"] = round(time.perf_counter() - t0, 2)

    if not result.kannada_text.strip():
        result.error = "STT returned empty (silent audio)"
        result.total_time_s = round(time.perf_counter() - t_total, 2)
        return result

    # ── Stage 2: Translation (Kannada -> English) ─────────────────────────────
    t0 = time.perf_counter()
    try:
        from backend.translation import translate_kn_to_en, unload_model as _unload_trans
        result.english_text = translate_kn_to_en(result.kannada_text)
    except Exception as exc:
        result.error = "Translation failed: " + str(exc)
        result.total_time_s = round(time.perf_counter() - t_total, 2)
        return result
    finally:
        try:
            _unload_trans("kn_to_en")
        except Exception:
            pass
    result.stage_times["translation"] = round(time.perf_counter() - t0, 2)

    if not result.english_text.strip():
        result.error = "Translation returned empty"
        result.total_time_s = round(time.perf_counter() - t_total, 2)
        return result

    # ── Stage 3: NLU + Router ────────────────────────────────────────────────
    t0 = time.perf_counter()
    try:
        from backend.nlu import classify, unload_model as _unload_nlu
        from backend.decision_router import route
        result.intent, result.confidence = classify(result.english_text)
        routing = route(result.intent)
        result.route = routing["route"]
        result.response_text = routing["response_text"]
    except Exception as exc:
        result.error = "NLU/Router failed: " + str(exc)
        result.total_time_s = round(time.perf_counter() - t_total, 2)
        return result
    finally:
        try:
            _unload_nlu("finetuned")
        except Exception:
            pass
    result.stage_times["nlu_router"] = round(time.perf_counter() - t0, 2)

    # ── Stage 4: TTS ──────────────────────────────────────────────────────────
    t0 = time.perf_counter()
    try:
        from backend.tts import synthesise, unload_model as _unload_tts
        result.audio = synthesise(result.response_text)
    except Exception as exc:
        result.error = "TTS failed: " + str(exc)
        # Non-fatal — return result without audio rather than crashing
        result.total_time_s = round(time.perf_counter() - t_total, 2)
        return result
    finally:
        try:
            _unload_tts()
        except Exception:
            pass
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
