"""Voice-assisted bank form routes (v1: catalog + Kannada STT for field fill)."""

from __future__ import annotations

import json
import os
import subprocess
import sys

from fastapi import APIRouter, File, HTTPException, UploadFile

from api.audio import audio_bytes_to_wav, safe_unlink
from api import forms_catalog

router = APIRouter()

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
STT_SCRIPT = os.path.join(PROJECT_ROOT, "run_stt_subprocess.py")


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
    """Accept short audio and return Kannada STT text for one form field."""
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
            env={
                **os.environ,
                "TRANSFORMERS_OFFLINE": "1",
                "HF_HUB_OFFLINE": "1",
                "HF_DATASETS_OFFLINE": "1",
            },
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"STT execution failed: {exc}") from exc
    finally:
        safe_unlink(tmp_wav)

    if proc.returncode != 0:
        stderr = proc.stderr.strip() or "Unknown STT error"
        # Prefer JSON error from stdout if present
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
