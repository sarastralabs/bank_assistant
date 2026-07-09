import traceback
import sys
sys.path.insert(0, r"C:\Sarastra\voice-based-assistant")

import backend.stt as stt

try:
    print(stt.transcribe("data/stt_test_audio/clip_001.wav", model="specialized", beam_size=1))
except Exception:
    traceback.print_exc()
