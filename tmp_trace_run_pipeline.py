import traceback
import sys
sys.path.insert(0, r"C:\Sarastra\voice-based-assistant")

import backend.stt as stt_module
from backend.pipeline import run_pipeline

orig_transcribe = stt_module.transcribe

def wrapped_transcribe(*args, **kwargs):
    print("wrapped_transcribe called")
    try:
        return orig_transcribe(*args, **kwargs)
    except Exception as exc:
        print("wrapped_transcribe exception:")
        traceback.print_exc()
        raise

stt_module.transcribe = wrapped_transcribe

result = run_pipeline("data/stt_test_audio/clip_001.wav")
print("result.error", result.error)
