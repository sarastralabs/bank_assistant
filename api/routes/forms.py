"""Voice-assisted bank form routes — catalog + STT + IndicTrans2 field fill."""

from __future__ import annotations

import json
import os
import subprocess
import sys

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from api.audio import audio_bytes_to_wav, safe_unlink
from api import forms_catalog
from backend.pipeline_bridge import (
    fill_field as warm_fill_field,
    oneshot_fill,
    worker_enabled,
)

router = APIRouter()

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
STT_SCRIPT = os.path.join(PROJECT_ROOT, "run_stt_subprocess.py")

_OFFLINE_ENV = {
    "TRANSFORMERS_OFFLINE": "1",
    "HF_HUB_OFFLINE": "1",
    "HF_DATASETS_OFFLINE": "1",
}


@router.get("/forms")
def list_forms() -> dict:
    return forms_catalog.list_forms()


@router.get("/forms/{form_id}")
def get_form(form_id: str) -> dict:
    form = forms_catalog.get_form(form_id)
    if form is None:
        raise HTTPException(status_code=404, detail=f"Unknown form: {form_id}")
    return form


@router.post("/forms/transcribe")
async def transcribe_field(audio: UploadFile = File(...)) -> dict:
    """Legacy: Kannada STT only (kept for compatibility). Prefer /forms/fill-field."""
    if not audio.filename:
        raise HTTPException(status_code=400, detail="No audio file provided")

    raw_bytes = await audio.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file")

    tmp_wav: str | None = None
    try:
        tmp_wav = audio_bytes_to_wav(raw_bytes)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Audio conversion failed: {exc}") from exc

    try:
        proc = subprocess.run(
            [sys.executable, STT_SCRIPT, tmp_wav],
            capture_output=True,
            text=True,
            cwd=PROJECT_ROOT,
            env={**os.environ, **_OFFLINE_ENV},
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"STT execution failed: {exc}") from exc
    finally:
        safe_unlink(tmp_wav)

    if proc.returncode != 0:
        stderr = proc.stderr.strip() or "Unknown STT error"
        try:
            payload = json.loads(proc.stdout or "{}")
            if payload.get("error"):
                raise HTTPException(status_code=500, detail=f"STT failed: {payload['error']}")
        except (json.JSONDecodeError, HTTPException):
            pass
        raise HTTPException(status_code=500, detail=f"STT subprocess failed: {stderr}")

    try:
        result = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Invalid STT output: {(proc.stdout or '')[:200]}",
        ) from exc

    if result.get("error"):
        raise HTTPException(status_code=500, detail=f"STT failed: {result['error']}")

    return {"text": (result.get("text") or "").strip()}


@router.post("/forms/fill-field")
async def fill_field(
    audio: UploadFile = File(...),
    field_type: str = Form("text"),
    field_id: str = Form(""),
) -> dict:
    """
    Speak one answer in Kannada → English form value via local models.

    Pipeline (offline, no API keys):
        STT (Whisper) → IndicTrans2 Kn→En → typed extract_field_value()
    """
    if not audio.filename:
        raise HTTPException(status_code=400, detail="No audio file provided")

    raw_bytes = await audio.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file")

    tmp_wav: str | None = None
    try:
        tmp_wav = audio_bytes_to_wav(raw_bytes)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Audio conversion failed: {exc}") from exc

    try:
        if worker_enabled():
            try:
                result = warm_fill_field(tmp_wav, field_type or "text", field_id or "")
            except Exception as warm_exc:
                print(f"[forms] warm worker failed, oneshot fallback: {warm_exc}", file=sys.stderr)
                result = oneshot_fill(tmp_wav, field_type or "text", field_id or "")
        else:
            result = oneshot_fill(tmp_wav, field_type or "text", field_id or "")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Form fill failed: {exc}") from exc
    finally:
        safe_unlink(tmp_wav)

    kannada = (result.get("kannada_text") or "").strip()
    english = (result.get("english_text") or "").strip()
    value = (result.get("value") or "").strip()
    err = result.get("error")

    if err and not value and not kannada:
        raise HTTPException(
            status_code=500,
            detail=f"Form fill failed: {err}",
        )

    if not kannada and not value:
        raise HTTPException(status_code=500, detail=err or "Could not hear speech")

    return {
        "kannada_text": kannada,
        "english_text": english,
        "value": value or english or kannada,
        "error": err,
    }
