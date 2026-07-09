import os
import gc
import psutil
from backend.decision_router import route
from backend.tts import synthesise
from backend.pipeline import run_pipeline

print('ROUTER_SMOKE')
for intent in ['check_balance', 'apply_loan', 'open_account', 'account_info_query']:
    result = route(intent)
    print(intent, '->', result['route'], '|', result['response_text'][:80])

out = 'data/tts_output/audit_test.wav'
audio = synthesise('Please visit your nearest branch.', output_path=out)
print('TTS_AUDIO', audio is not None, 'exists', os.path.exists(out))

print('PIPELINE_SMOKE')
clips = [
    'data/stt_test_audio/clip_001.wav',
    'data/stt_test_audio/clip_003.wav',
    'data/stt_test_audio/clip_004.wav',
]
proc = psutil.Process(os.getpid())
for i, clip in enumerate(clips, 1):
    print('RUN', i, clip)
    result = run_pipeline(clip)
    print('  error=', result.error)
    print('  intent=', result.intent, 'route=', result.route)
    print('  mem_rss_mb=', round(proc.memory_info().rss / (1024 * 1024), 2))
    gc.collect()

print('PIPELINE_DONE')
