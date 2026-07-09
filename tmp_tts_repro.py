import os
from backend.tts import synthesise

out = 'data/tts_output/verify_tts.wav'
print('calling synthesise')
audio = synthesise('Please visit your nearest branch.', output_path=out)
print('result', audio is not None, os.path.exists(out))
