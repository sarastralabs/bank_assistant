"""
FastAPI server for the Kannada Voice Banking Assistant.

Usage:
    uvicorn api.main:app --reload --port 8000
"""

from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.cuda_runtime import ensure_compatible_cudnn

ensure_compatible_cudnn()

from api.history import init_db
from api.routes import admin, forms, history, kiosk, landing, pipeline

os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("HF_DATASETS_OFFLINE", "1")
# Natural Kannada = Parler. Ignore leftover BANK_TTS_ENGINE=mms unless explicitly allowed.
_tts = os.environ.get("BANK_TTS_ENGINE", "parler").strip().lower()
if _tts in {"mms", "mms-tts"} and os.environ.get("BANK_TTS_ALLOW_MMS", "").strip().lower() not in {
    "1",
    "true",
    "yes",
}:
    _tts = "parler"
os.environ["BANK_TTS_ENGINE"] = _tts or "parler"
os.environ.setdefault("BANK_TTS_SPEAKER", "Suresh")

app = FastAPI(title="Kannada Voice Banking API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(pipeline.router, prefix="/api")
app.include_router(history.router, prefix="/api")
app.include_router(landing.router, prefix="/api")
app.include_router(forms.router, prefix="/api")
app.include_router(kiosk.router, prefix="/api")
app.include_router(admin.router, prefix="/api")


@app.on_event("startup")
def _startup() -> None:
    init_db()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
