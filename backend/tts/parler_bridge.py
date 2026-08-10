"""
Bridge to AI4Bharat Indic Parler-TTS via an isolated .venv-parler worker.

Main project stays on transformers>=4.51 (IndicTrans2). Parler needs 4.46.x,
so synthesis runs in a long-lived subprocess started from .venv-parler.
"""

from __future__ import annotations

import base64
import io
import json
import os
import subprocess
import sys
import threading
from typing import Any

import numpy as np

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORKER_SCRIPT = os.path.join(PROJECT_ROOT, "run_parler_tts_worker.py")
DEFAULT_VENV_PY = os.path.join(PROJECT_ROOT, ".venv-parler", "Scripts", "python.exe")
DEFAULT_VENV_PY_UNIX = os.path.join(PROJECT_ROOT, ".venv-parler", "bin", "python")

_lock = threading.Lock()
_proc: subprocess.Popen[str] | None = None
_ready = False


def _parler_python() -> str | None:
    override = os.environ.get("BANK_PARLER_PYTHON", "").strip()
    if override and os.path.isfile(override):
        return override
    if os.path.isfile(DEFAULT_VENV_PY):
        return DEFAULT_VENV_PY
    if os.path.isfile(DEFAULT_VENV_PY_UNIX):
        return DEFAULT_VENV_PY_UNIX
    return None


def parler_available() -> bool:
    """True when isolated Parler venv exists and engine is not forced to mms."""
    engine = os.environ.get("BANK_TTS_ENGINE", "auto").strip().lower()
    if engine in {"mms", "mms-tts", "off"}:
        return False
    if engine not in {"parler", "indic-parler", "auto"}:
        return False
    if _parler_python() is None or not os.path.isfile(WORKER_SCRIPT):
        return False

    if engine in {"auto"}:
        free_mb = _cuda_free_mb()
        # 8GB laptops often have <4.5GB free after Whisper — allow Parler more often.
        min_free = int(os.environ.get("BANK_PARLER_MIN_FREE_MB", "2800"))
        if free_mb is not None and free_mb < min_free:
            return False
    return True


def _cuda_free_mb() -> int | None:
    """Free VRAM in MiB on device 0, or None if unavailable."""
    try:
        import torch

        if not torch.cuda.is_available():
            return None
        free, _total = torch.cuda.mem_get_info(0)
        return int(free // (1024 * 1024))
    except Exception:
        return None


def default_speaker() -> str:
    sp = os.environ.get("BANK_TTS_SPEAKER", "Suresh").strip()
    if sp.lower() == "anu":
        return "Anu"
    return "Suresh"


def _start_worker_locked() -> None:
    global _proc, _ready
    if _proc is not None and _proc.poll() is None and _ready:
        return

    py = _parler_python()
    if not py:
        raise RuntimeError(
            "Parler venv not found. Run: .\\scripts\\setup_parler_venv.ps1"
        )

    env = {
        **os.environ,
        # Allow first download; subsequent runs can set TRANSFORMERS_OFFLINE=1
        "PYTHONUNBUFFERED": "1",
    }
    _proc = subprocess.Popen(
        [py, WORKER_SCRIPT],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=PROJECT_ROOT,
        env=env,
        bufsize=1,
    )
    assert _proc.stdout is not None
    # First stdout line should be ready handshake
    line = _proc.stdout.readline()
    if not line:
        err = _proc.stderr.read() if _proc.stderr else ""
        _proc = None
        _ready = False
        raise RuntimeError(f"Parler worker failed to start: {err[:500]}")
    try:
        payload = json.loads(line)
    except json.JSONDecodeError as exc:
        _ready = False
        raise RuntimeError(f"Parler worker bad handshake: {line[:200]}") from exc
    if not payload.get("ok"):
        _ready = False
        raise RuntimeError(payload.get("error") or "Parler worker not ready")
    _ready = True


def _request(payload: dict[str, Any], timeout_s: float = 300.0) -> dict[str, Any]:
    global _proc, _ready
    with _lock:
        _start_worker_locked()
        assert _proc is not None and _proc.stdin and _proc.stdout
        try:
            _proc.stdin.write(json.dumps(payload) + "\n")
            _proc.stdin.flush()
        except BrokenPipeError:
            _proc = None
            _ready = False
            _start_worker_locked()
            assert _proc is not None and _proc.stdin and _proc.stdout
            _proc.stdin.write(json.dumps(payload) + "\n")
            _proc.stdin.flush()

        # Blocking readline — model may take a while on CPU
        line = _proc.stdout.readline()
        if not line:
            err = ""
            if _proc.stderr:
                try:
                    err = _proc.stderr.read()[:800]
                except Exception:
                    pass
            _proc = None
            _ready = False
            raise RuntimeError(f"Parler worker died: {err}")
        return json.loads(line)


def stop_worker() -> None:
    global _proc, _ready
    with _lock:
        if _proc is None:
            return
        try:
            if _proc.stdin and _proc.poll() is None:
                _proc.stdin.write(json.dumps({"cmd": "quit"}) + "\n")
                _proc.stdin.flush()
                _proc.wait(timeout=10)
        except Exception:
            try:
                _proc.kill()
            except Exception:
                pass
        _proc = None
        _ready = False


def synthesise_kannada_parler(
    kannada_text: str,
    speaker: str | None = None,
) -> tuple[np.ndarray, int]:
    """
    Synthesise Kannada speech with Indic Parler-TTS (Suresh/Anu).
    Raises on failure — caller should fall back to MMS.
    """
    if not kannada_text or not kannada_text.strip():
        raise ValueError("empty text")
    sp = speaker or default_speaker()
    resp = _request({"cmd": "synth", "text": kannada_text.strip(), "speaker": sp})
    if not resp.get("ok") or not resp.get("audio_b64"):
        raise RuntimeError(resp.get("error") or "Parler synth failed")

    raw = base64.b64decode(resp["audio_b64"])
    import soundfile as sf

    audio, sr = sf.read(io.BytesIO(raw), dtype="float32")
    if getattr(audio, "ndim", 1) > 1:
        audio = audio.mean(axis=1)
    return np.asarray(audio, dtype=np.float32), int(sr or resp.get("sr") or 22050)
