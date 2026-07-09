import traceback
import sys
sys.path.insert(0, r"C:\Sarastra\voice-based-assistant")

from backend.stt import transcribe as stt_transcribe
from backend.stt.transcriber import KannadaTranscriber

print("Calling direct STT...")
try:
    print(stt_transcribe("data/stt_test_audio/clip_001.wav", model="specialized", beam_size=1))
except Exception:
    traceback.print_exc()

print("Calling transcriber init...")
try:
    transcriber = KannadaTranscriber(r"C:\Sarastra\voice-based-assistant\models\whisper-medium-vaani-ct2")
    print("loaded", transcriber)
except Exception:
    traceback.print_exc()

from backend.pipeline import run_pipeline

print("Calling full pipeline...")
try:
    result = run_pipeline("data/stt_test_audio/clip_001.wav")
    print("RESULT_ERROR", result.error)
    print("KANADA", result.kannada_text)
    print("ENGLISH", result.english_text)
    print("INTENT", result.intent)
    print("RESPONSE", result.response_text)
    print("AUDIO", result.audio is not None)
    print("STAGE_TIMES", result.stage_times)
except Exception:
    traceback.print_exc()
