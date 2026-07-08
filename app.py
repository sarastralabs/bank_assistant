"""
app.py -- Streamlit frontend for the Kannada Voice Banking Assistant

The pipeline runs in the Streamlit process using the sequential
load-use-unload pattern from backend/pipeline.py.

Usage:  python -m streamlit run app.py
Opens:  http://localhost:8501
"""

import io
import os
import sys
import tempfile

import numpy as np
import soundfile as sf
import streamlit as st

# Force offline mode -- no network calls, use cached models only
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("HF_DATASETS_OFFLINE", "1")

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, PROJECT_ROOT)

from backend.pipeline import run_pipeline


def _audio_bytes_to_wav(audio_bytes: bytes) -> str:
    """Convert any audio format to 16kHz mono WAV temp file."""
    from pydub import AudioSegment
    buf = io.BytesIO(audio_bytes)
    audio = AudioSegment.from_file(buf)
    audio = audio.set_frame_rate(16000).set_channels(1)
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    audio.export(tmp.name, format="wav")
    return tmp.name


def process_and_display(audio_bytes: bytes) -> None:
    """Convert audio, run pipeline, display results in Streamlit."""
    tmp_wav = None
    try:
        with st.spinner("Converting audio..."):
            tmp_wav = _audio_bytes_to_wav(audio_bytes)

        with st.spinner("Running pipeline — STT → Translation → NLU → Router → TTS  (~25s first run, ~10s after)"):
            result = run_pipeline(tmp_wav)

    finally:
        if tmp_wav and os.path.exists(tmp_wav):
            try: os.unlink(tmp_wav)
            except: pass

    if result.error:
        st.error("Pipeline error: " + result.error)
        return

    # Timings
    t = result.stage_times
    st.caption(
        "STT " + str(t.get("stt","?")) + "s | "
        + "Trans " + str(t.get("translation","?")) + "s | "
        + "NLU " + str(t.get("nlu_router","?")) + "s | "
        + "TTS " + str(t.get("tts","?")) + "s | "
        + "Total " + str(result.total_time_s) + "s"
    )

    col1, col2 = st.columns(2)
    with col1:
        st.markdown("**Detected Intent**")
        st.info(
            result.intent + "\n\n"
            + str(round(result.confidence * 100)) + "% confidence\n"
            + "Route: " + result.route
        )
    with col2:
        st.markdown("**English Translation**")
        st.write(result.english_text or "(empty)")

    st.markdown("**Response (English)**")
    st.success(result.response_text)

    if result.audio is not None:
        audio_arr, sr = result.audio
        buf = io.BytesIO()
        sf.write(buf, audio_arr, sr, format="WAV")
        buf.seek(0)
        st.markdown("**Kannada Voice Response**")
        st.audio(buf, format="audio/wav", autoplay=True)


# ---------------------------------------------------------------------------
# Page layout
# ---------------------------------------------------------------------------
st.set_page_config(page_title="Kannada Voice Banking", page_icon="🏦", layout="centered")
st.title("🏦 Kannada Voice Banking Assistant")
st.markdown(
    "Speak in **Kannada** → get a Kannada voice response.\n\n"
    "Pipeline: **Whisper STT** → **IndicTrans2** → **DistilBERT NLU** "
    "→ **Decision Router** → **MMS-TTS**"
)
st.divider()

# Microphone
st.subheader("🎙️ Record")
mic_audio = st.audio_input("Click mic, speak, click again to stop")
if st.button("▶ Process Recording", type="primary", disabled=(mic_audio is None)):
    process_and_display(mic_audio.getvalue())

st.divider()

# File upload
st.subheader("📁 Or upload a .wav / .ogg file")
uploaded = st.file_uploader("Upload audio", type=["wav", "ogg"])
if st.button("▶ Process Upload", disabled=(uploaded is None)):
    process_and_display(uploaded.read())

st.divider()
st.caption(
    "Supported intents: check_balance · apply_loan · open_account · "
    "deposit_money · withdraw_money · account_info_query · interest_rate_query  |  "
    "First query ~25s · Subsequent ~10s"
)
