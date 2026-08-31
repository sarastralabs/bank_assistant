"""
Long-lived inference worker: keep STT / translation / NLU / TTS warm across turns.

Protocol (stdin/stdout, one JSON line per message):
  {"cmd":"ping"} -> {"ok":true}
  {"cmd":"process","wav":"<path>"} -> pipeline JSON result
  {"cmd":"fill","wav":"<path>","field_type":"...","field_id":"..."} -> fill JSON
  {"cmd":"quit"} -> exit

Env:
  BANK_PIPELINE_KEEP_LOADED=1  (default in this worker) — do not unload between stages
"""
from __future__ import annotations

import base64
import json
import os
import sys
import tempfile
import traceback

# Load .env before anything else so BANK_TTS_ENGINE and offline flags are set
_HERE = os.path.dirname(os.path.abspath(__file__))
try:
    from dotenv import load_dotenv as _load_dotenv
    _load_dotenv(dotenv_path=os.path.join(_HERE, ".env"), override=True)
except ImportError:
    pass

os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("HF_DATASETS_OFFLINE", "1")
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("BANK_PIPELINE_KEEP_LOADED", "1")
# TTS engine: .env sets BANK_TTS_ENGINE=mms — honour that, don't default to parler
_tts = os.environ.get("BANK_TTS_ENGINE", "mms").strip().lower()
os.environ["BANK_TTS_ENGINE"] = _tts
os.environ.setdefault("BANK_TTS_ALLOW_MMS", "1")
os.environ.setdefault("BANK_TTS_SPEAKER", "Suresh")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Keep protocol stdout clean — torch/triton may print noise on import.
_REAL_STDOUT = sys.stdout
sys.stdout = sys.stderr

from backend.cuda_runtime import ensure_compatible_cudnn  # noqa: E402

ensure_compatible_cudnn()


def _reply(payload: dict) -> None:
    _REAL_STDOUT.write(json.dumps(payload) + "\n")
    _REAL_STDOUT.flush()


def _process(wav: str) -> dict:
    import soundfile as sf
    from backend.pipeline import run_pipeline

    result = run_pipeline(wav)
    audio_b64 = ""
    if result.audio is not None:
        buf = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        buf.close()
        sf.write(buf.name, result.audio[0], result.audio[1])
        with open(buf.name, "rb") as f:
            audio_b64 = base64.b64encode(f.read()).decode("ascii")
        try:
            os.unlink(buf.name)
        except OSError:
            pass
    return {
        "ok": True,
        "kannada_text": result.kannada_text,
        "english_text": result.english_text,
        "intent": result.intent,
        "confidence": result.confidence,
        "route": result.route,
        "response_text": result.response_text,
        "required_fields": result.required_fields,
        "form_id": result.form_id,
        "audio_b64": audio_b64,
        "stage_times": result.stage_times,
        "total_time_s": result.total_time_s,
        "error": result.error,
    }


def _fill(wav: str, field_type: str, field_id: str) -> dict:
    from backend.forms.extract import extract_field_value
    from backend.stt import transcribe
    from backend.translation import translate_kn_to_en

    keep = os.environ.get("BANK_PIPELINE_KEEP_LOADED", "1").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    kannada = ""
    english = ""
    value = ""
    error = None
    try:
        # beam_size=1 for kiosk latency (was 5)
        kannada = transcribe(wav, model="specialized", beam_size=1) or ""
        if not kannada.strip():
            error = "STT returned empty (silent audio)"
        else:
            english = translate_kn_to_en(kannada) or ""
            if not english.strip():
                value = kannada.strip()
                error = "Translation returned empty; using Kannada text"
            else:
                value = extract_field_value(english, field_type=field_type, field_id=field_id)
        if not keep:
            try:
                from backend.stt import unload_model as unload_stt

                unload_stt("specialized")
            except Exception:
                pass
            try:
                from backend.translation import unload_model as unload_trans

                unload_trans("kn_to_en")
            except Exception:
                pass
    except Exception as exc:
        error = str(exc)
    return {
        "ok": True,
        "kannada_text": kannada,
        "english_text": english,
        "value": value,
        "error": error,
    }


def main() -> None:
    _reply({"ok": True, "ready": True, "keep_loaded": os.environ.get("BANK_PIPELINE_KEEP_LOADED", "1")})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError as exc:
            _reply({"ok": False, "error": f"bad json: {exc}"})
            continue
        cmd = (msg.get("cmd") or "").strip().lower()
        try:
            if cmd == "ping":
                _reply({"ok": True})
            elif cmd == "quit":
                _reply({"ok": True, "bye": True})
                break
            elif cmd == "process":
                wav = msg.get("wav") or ""
                if not wav or not os.path.isfile(wav):
                    _reply({"ok": False, "error": f"missing wav: {wav}"})
                    continue
                _reply(_process(wav))
            elif cmd == "fill":
                wav = msg.get("wav") or ""
                if not wav or not os.path.isfile(wav):
                    _reply({"ok": False, "error": f"missing wav: {wav}"})
                    continue
                _reply(
                    _fill(
                        wav,
                        str(msg.get("field_type") or "text"),
                        str(msg.get("field_id") or ""),
                    )
                )
            else:
                _reply({"ok": False, "error": f"unknown cmd: {cmd}"})
        except Exception as exc:
            _reply({"ok": False, "error": str(exc), "trace": traceback.format_exc()[-800:]})


if __name__ == "__main__":
    main()
