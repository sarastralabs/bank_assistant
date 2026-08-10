"""Pipeline HTTP routes."""

from __future__ import annotations

import sys

from fastapi import APIRouter, File, HTTPException, UploadFile

from api.audio import audio_bytes_to_wav, safe_unlink
from api import history as history_store
from backend.pipeline_bridge import (
    fill_field,
    oneshot_fill,
    oneshot_process,
    process_wav,
    worker_enabled,
)

router = APIRouter()


@router.post("/process-audio")
async def process_audio(audio: UploadFile = File(...)) -> dict:
    """Accept audio upload, run pipeline (warm worker by default), return JSON."""
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
                result = process_wav(tmp_wav)
            except Exception as warm_exc:
                # Fall back once to cold subprocess if worker crashed mid-flight
                print(f"[pipeline] warm worker failed, oneshot fallback: {warm_exc}", file=sys.stderr)
                result = oneshot_process(tmp_wav)
        else:
            result = oneshot_process(tmp_wav)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Pipeline execution failed: {exc}") from exc
    finally:
        safe_unlink(tmp_wav)

    # Persist successful turns for product history (non-fatal if save fails)
    if not result.get("error"):
        try:
            saved = history_store.save_query(result)
            result["history_id"] = saved["id"]
        except Exception as exc:
            print(f"[history] save failed: {exc}", file=sys.stderr)
            result["history_id"] = None

    return result
