import os
import traceback
from faster_whisper import WhisperModel

model_path = os.path.join('models', 'whisper-medium-vaani-ct2')
for device in ['cuda', 'cpu']:
    print('TRY', device)
    try:
        model = WhisperModel(model_path, device=device, compute_type='int8')
        print('loaded', device)
    except Exception as exc:
        print('EXC', type(exc).__name__, exc)
        traceback.print_exc()
