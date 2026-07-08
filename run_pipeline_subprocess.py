"""
Thin wrapper: run_pipeline on a single wav file and print JSON result.
Called by app.py as a subprocess so pipeline crashes don't kill Streamlit.
Usage: python run_pipeline_subprocess.py <wav_path>
"""
import sys, json, os

# Force fully offline mode -- no network calls to huggingface.co
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_DATASETS_OFFLINE"] = "1"
os.environ["HF_HUB_OFFLINE"] = "1"

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.pipeline import run_pipeline
import soundfile as sf
import tempfile, base64, numpy as np

wav_path = sys.argv[1]
result = run_pipeline(wav_path)

# Encode audio as base64 so we can pass it through stdout
audio_b64 = ""
if result.audio is not None:
    buf = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    sf.write(buf.name, result.audio[0], result.audio[1])
    buf.close()
    with open(buf.name, "rb") as f:
        audio_b64 = base64.b64encode(f.read()).decode()
    os.unlink(buf.name)

output = {
    "kannada_text":  result.kannada_text,
    "english_text":  result.english_text,
    "intent":        result.intent,
    "confidence":    result.confidence,
    "route":         result.route,
    "response_text": result.response_text,
    "audio_b64":     audio_b64,
    "stage_times":   result.stage_times,
    "total_time_s":  result.total_time_s,
    "error":         result.error,
}
print(json.dumps(output))
