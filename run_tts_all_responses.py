"""
Generate TTS audio for all 11 banking response_texts.
Runs the full pipeline: STT -> Translation -> NLU -> Router -> TTS
Saves one .wav per clip to data/tts_output/

Run from project root:
    python run_tts_all_responses.py

Output files: data/tts_output/clip_XXX_response.wav
"""
import sys, os, time, json

# Force UTF-8 stdout so any accidental Kannada text doesn't crash the console
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

sys.path.insert(0, '.')

DATA_DIR   = "data/stt_test_audio"
OUTPUT_DIR = "data/tts_output"
os.makedirs(OUTPUT_DIR, exist_ok=True)

with open(os.path.join(DATA_DIR, "transcripts.json"), encoding="utf-8") as f:
    transcripts = json.load(f)

print("Loading all pipeline modules (first call may take 20-30s)...")
from backend.stt import transcribe
from backend.translation import translate_kn_to_en
from backend.nlu import classify
from backend.decision_router import route
from backend.tts import synthesise

print("All modules loaded.\n")
print("=" * 70)

results = []
for clip in sorted(transcripts.keys()):
    wav_path = os.path.join(DATA_DIR, clip)
    if not os.path.exists(wav_path):
        print(clip + ": SKIP (audio file missing)")
        continue

    t0 = time.perf_counter()
    try:
        # Step 1: STT
        stt_output = transcribe(wav_path, model="specialized", beam_size=1)

        # Step 2: Translation
        english = translate_kn_to_en(stt_output) if stt_output else ""

        # Step 3: NLU
        intent, conf = classify(english) if english else ("(empty)", 0.0)

        # Step 4: Router
        try:
            routing = route(intent)
            response_text = routing["response_text"]
            route_type    = routing["route"]
        except Exception as e:
            response_text = "Unable to process this request."
            route_type    = "error"

        # Step 5: TTS
        out_path = os.path.join(OUTPUT_DIR, clip.replace(".wav", "_response.wav"))
        tts_result = synthesise(response_text, output_path=out_path)

        elapsed = round(time.perf_counter() - t0, 1)

        if tts_result is not None:
            audio, sr = tts_result
            duration = round(len(audio)/sr, 1)
            tts_status = str(duration) + "s audio"
        else:
            tts_status = "None (empty response)"

        safe_response = response_text.encode('ascii', errors='replace').decode('ascii')
        print(clip)
        print("  Intent   : " + intent + " (conf=" + str(round(conf,2)) + ", route=" + route_type + ")")
        print("  Response : " + safe_response[:80] + ("..." if len(response_text) > 80 else ""))
        print("  TTS out  : " + out_path)
        print("  Audio    : " + tts_status + " | total=" + str(elapsed) + "s")
        print()

        results.append({
            "clip": clip,
            "intent": intent,
            "route": route_type,
            "tts_file": out_path,
            "tts_status": tts_status,
        })

    except Exception as err:
        elapsed = round(time.perf_counter() - t0, 1)
        print(clip + ": ERROR after " + str(elapsed) + "s")
        print("  " + type(err).__name__ + ": " + str(err)[:120])
        print()

print("=" * 70)
print("Done. " + str(len(results)) + " clips processed.")
print()
print("Audio files saved to: " + os.path.abspath(OUTPUT_DIR))
print()
print("Files to listen to:")
for r in results:
    if "None" not in r["tts_status"]:
        fname = os.path.basename(r["tts_file"])
        print("  " + fname + "  [" + r["intent"] + ", " + r["tts_status"] + "]")
