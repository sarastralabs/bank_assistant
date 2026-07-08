"""
Generate TTS audio for all 11 banking responses.
Uses ground-truth Kannada from transcripts.json directly (skips STT)
to avoid loading all 4 models simultaneously.

Pipeline: KN text -> translate_kn_to_en -> NLU -> Router -> TTS
Saves: data/tts_output/clip_XXX_response.wav

Run: python run_tts_responses_fast.py
"""
import sys, os, time, json
sys.path.insert(0, '.')
os.makedirs("data/tts_output", exist_ok=True)

with open("data/stt_test_audio/transcripts.json", encoding="utf-8") as f:
    transcripts = json.load(f)

# Load modules one at a time
print("Loading Translation module...")
from backend.translation import translate_kn_to_en
print("Loading NLU module...")
from backend.nlu import classify
print("Loading Decision Router...")
from backend.decision_router import route
print("Loading TTS module...")
from backend.tts import synthesise
print("All loaded.\n")

sep = "=" * 65
print(sep)

results = []
for clip in sorted(transcripts.keys()):
    kn_text = transcripts[clip]
    t0 = time.perf_counter()

    # Translate KN -> EN
    english = translate_kn_to_en(kn_text)

    # NLU classify
    intent, conf = classify(english) if english else ("unknown", 0.0)

    # Router
    try:
        routing = route(intent)
        response_text = routing["response_text"]
        route_type = routing["route"]
    except Exception:
        response_text = "I could not process that request."
        route_type = "error"

    # TTS
    out_path = os.path.join("data/tts_output", clip.replace(".wav", "_response.wav"))
    tts_result = synthesise(response_text, output_path=out_path)

    elapsed = round(time.perf_counter() - t0, 1)
    duration = round(len(tts_result[0]) / tts_result[1], 1) if tts_result else 0

    safe = response_text.encode('ascii', errors='replace').decode('ascii')
    print(clip + "  [" + intent + ", " + route_type + ", conf=" + str(round(conf,2)) + "]")
    print("  Response : " + safe[:75] + ("..." if len(safe) > 75 else ""))
    print("  Audio    : " + out_path)
    print("  Duration : " + str(duration) + "s  |  time=" + str(elapsed) + "s")
    print()

    results.append({"clip": clip, "intent": intent, "file": out_path, "duration": duration})

print(sep)
print("Done. " + str(len(results)) + " files saved to data/tts_output/")
print()
for r in results:
    print("  " + os.path.basename(r["file"]) + "  [" + r["intent"] + ", " + str(r["duration"]) + "s]")
