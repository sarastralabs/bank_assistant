import sys, traceback, time
sys.path.insert(0, r"C:\Sarastra\voice-based-assistant")

from backend.stt import transcribe as stt_transcribe, unload_model as unload_stt
from backend.translation import translate_kn_to_en, unload_model as unload_trans
from backend.nlu import classify, unload_model as unload_nlu
from backend.decision_router import route
from backend.tts import synthesise, unload_model as unload_tts


audio_path = "data/stt_test_audio/clip_001.wav"

print("Stage 1: STT")
try:
    text = stt_transcribe(audio_path, model="specialized", beam_size=1)
    print("STT OK", text)
except Exception as exc:
    print("STT FAIL", exc)
    traceback.print_exc()
    raise
finally:
    try:
        unload_stt("specialized")
        print("STT unload OK")
    except Exception as exc:
        print("STT unload FAIL", exc)
        traceback.print_exc()

print("Stage 2: Translation")
try:
    en = translate_kn_to_en(text)
    print("Translation OK", en)
except Exception as exc:
    print("Translation FAIL", exc)
    traceback.print_exc()
    raise
finally:
    try:
        unload_trans("kn_to_en")
        print("Translation unload OK")
    except Exception as exc:
        print("Translation unload FAIL", exc)
        traceback.print_exc()

print("Stage 3: NLU + Router")
try:
    intent, conf = classify(en)
    routing = route(intent)
    print("NLU/Routing OK", intent, conf, routing)
except Exception as exc:
    print("NLU/Routing FAIL", exc)
    traceback.print_exc()
    raise
finally:
    try:
        unload_nlu("finetuned")
        print("NLU unload OK")
    except Exception as exc:
        print("NLU unload FAIL", exc)
        traceback.print_exc()

print("Stage 4: TTS")
try:
    audio = synthesise(routing["response_text"])
    print("TTS OK", audio is not None)
except Exception as exc:
    print("TTS FAIL", exc)
    traceback.print_exc()
    raise
finally:
    try:
        unload_tts()
        print("TTS unload OK")
    except Exception as exc:
        print("TTS unload FAIL", exc)
        traceback.print_exc()
