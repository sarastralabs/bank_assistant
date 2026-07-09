import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.stt.transcriber import KannadaTranscriber

model_path = os.path.join('models', 'whisper-medium-vaani-ct2')
transcriber = KannadaTranscriber(model_path, device='cuda', compute_type='int8')
print('loaded', transcriber._device)
