"""
Batch-converts clip_XXX.wav.ogg files from Downloads into proper
16kHz mono .wav files in data/stt_test_audio/.

Run with: python backend/stt/convert_my_recordings.py
"""

import os

from pydub import AudioSegment

DOWNLOADS_DIR = os.path.join(os.path.expanduser("~"), "Downloads")
OUTPUT_DIR = "data/stt_test_audio"

os.makedirs(OUTPUT_DIR, exist_ok=True)

converted = []
missing = []

for i in range(1, 16):  # clip_001 through clip_015
    num = f"{i:03d}"
    src = os.path.join(DOWNLOADS_DIR, f"clip_{num}.wav.ogg")
    dst = os.path.join(OUTPUT_DIR, f"clip_{num}.wav")

    if not os.path.exists(src):
        missing.append(f"clip_{num}")
        continue

    try:
        audio = AudioSegment.from_file(src, format="ogg")
        audio = audio.set_frame_rate(16000).set_channels(1)
        audio.export(dst, format="wav")
        converted.append(f"clip_{num}")
        print(f"[OK] Converted clip_{num}.wav.ogg -> clip_{num}.wav")
    except Exception as e:
        print(f"[FAIL] clip_{num}: {e}")

print(f"\nDone. Converted: {len(converted)} | Missing/not recorded yet: {len(missing)}")
if missing:
    print("Still need to record:", ", ".join(missing))
