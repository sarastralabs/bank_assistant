from backend.pipeline import run_pipeline

result = run_pipeline('data/stt_test_audio/clip_001.wav')
print('error=', result.error)
print('intent=', result.intent)
print('route=', result.route)
print('audio_ok=', result.audio is not None)
print('stage_times=', result.stage_times)
