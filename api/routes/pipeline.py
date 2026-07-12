"""Pipeline HTTP routes."""

from __future__ import annotations

import json
import os
import subprocess
import sys

from fastapi import APIRouter, File, HTTPException, UploadFile

from api.audio import audio_bytes_to_wav, safe_unlink
from api import history as history_store

router = APIRouter()

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SUBPROCESS_SCRIPT = os.path.join(PROJECT_ROOT, "run_pipeline_subprocess.py")


@router.post("/process-audio")
async def process_audio(audio: UploadFile = File(...)) -> dict:
    """Accept audio upload, run pipeline in subprocess, return JSON result."""
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
            [sys.executable, SUBPROCESS_SCRIPT, tmp_wav],
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
        raise HTTPException(status_code=500, detail=f"Pipeline execution failed: {exc}") from exc
    finally:
        safe_unlink(tmp_wav)

    if proc.returncode != 0:
        stderr = proc.stderr.strip() or "Unknown subprocess error"
        raise HTTPException(status_code=500, detail=f"Pipeline subprocess failed: {stderr}")

    try:
        result = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Invalid pipeline output: {proc.stdout[:200]}",
        ) from exc

    # Persist successful turns for product history (non-fatal if save fails)
    if not result.get("error"):
        try:
            saved = history_store.save_query(result)
            result["history_id"] = saved["id"]
        except Exception as exc:
            # Keep the pipeline response even if history persistence fails
            print(f"[history] save failed: {exc}", file=sys.stderr)
            result["history_id"] = None

    return result
