import traceback
import sys
sys.path.insert(0, r"C:\Sarastra\voice-based-assistant")

import time
from backend.stt import transcribe

try:
    t0 = time.perf_counter()
    text = transcribe("data/stt_test_audio/clip_001.wav", model="specialized", beam_size=1)
    print("TEXT", text)
    print("elapsed", round(time.perf_counter() - t0, 2))
except Exception:
    traceback.print_exc()
