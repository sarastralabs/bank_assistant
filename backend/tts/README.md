# TTS Module -- Kannada Text-to-Speech

Converts the Decision Router's English `response_text` to spoken Kannada audio.
Internally uses `translate_en_to_kn()` (existing Translation module) then synthesises
speech with Facebook's MMS-TTS VITS model.

Model: `facebook/mms-tts-kan` -- 36 MB, public (no auth), fully offline, CC-BY-NC 4.0

---

## Quick Start

```python
from backend.tts import synthesise

audio, sr = synthesise(
    "The interest rate for savings account is 3 point 5 percent per annum.",
    output_path="data/tts_output/response.wav",
)
# audio: float32 NumPy array, sr: 16000
```

Play back with any audio player (VLC, Windows Media Player, Audacity):
```
data/tts_output/response.wav
```

---

## No Setup Required

Unlike IndicTrans2 and Whisper, this model:
- Is **not gated** on HuggingFace -- no auth, no terms acceptance
- Has **no new dependencies** -- `VitsModel` is already in `transformers 4.57.6`
- Downloads **36 MB** in seconds on first use, fully offline afterwards

---

## API

### `synthesise(english_text, output_path=None, play=False) -> tuple[ndarray, int] | None`

| Parameter | Default | Description |
|-----------|---------|-------------|
| `english_text` | required | English text (router's response_text) |
| `output_path` | None | Save .wav to this path if given |
| `play` | False | Play via sounddevice (optional, skips if not installed) |
| `voice_description` | None | Accepted for API compatibility; ignored by MMS-TTS |

Returns `(audio_array, sample_rate)` or `None` for empty input.

---

## Performance (measured on dev machine, CUDA GPU)

| Step | Time |
|------|------|
| translate_en_to_kn() | ~14-15s (model first load) / ~0.2s (cached) |
| KannadaSpeaker init (model load) | ~2s (from cache) |
| synthesis (~10s Kannada speech) | ~1.65s on GPU |
| Total (all models cached) | ~2s end-to-end |

Sample rate: 16000 Hz. Typical output: 8-15 seconds of audio per banking response.

---

## Voice Quality

MMS-TTS produces intelligible Kannada speech but with a robotic/synthetic quality
typical of VITS models trained on limited per-language data. This is acceptable
for a student project pipeline demonstration. The speech is clearly Kannada,
correctly pronounced, and understandable to native speakers.

For higher quality, see the design decision history below.

---

## Known Quality Fixes (both implemented in speaker.py)

### Fix 1 -- Sentence splitting

**Problem:** VITS models produce degraded output and apparent truncation when
given multi-sentence input as a single string. The first sentence sounds fine but
the second is clipped or muffled.

**Root cause:** VITS models are trained on short, single-utterance samples and
their duration predictor degrades on long sequences. Feeding a 200-character
two-sentence string produces less natural prosody than two separate 100-character
inference calls.

**Fix:** `synthesise()` splits English input on sentence boundaries (`. ! ?`)
before translation, translates and synthesises each sentence independently,
then concatenates the audio arrays with a 0.4-second silence gap between them.
This is the standard practical approach for VITS inference on longer texts.

### Fix 2 -- ASCII digit normalisation

**Problem:** IndicTrans2 (`translate_en_to_kn`) sometimes preserves ASCII digits
inside its Kannada output. For example, "3 point 5 percent per annum" translates
to a Kannada string containing the raw characters "3" and "5" rather than spelling
them out in Kannada script. VitsModel tokenises these as mixed-script tokens and
produces audible artefacts (stuttering, clicks) around digit positions.

**Verified by inspection:** The Kannada output for "3 point 5 percent" was
confirmed to contain ASCII digit characters (`digits_replaced: True` in tests).

**Fix:** `_normalise_digits()` in `speaker.py` replaces ASCII digits 0-9 with
their Kannada word equivalents (e.g. "3" -> "ಮೂರು", "5" -> "ಐದು") before passing
text to the tokenizer. This is applied per-sentence inside `_synthesise_kannada()`.
Tested and confirmed on:
- Two-sentence numeric input (interest rate response): 14.61s clean output
- Two-sentence non-numeric input (account info procedure): 20.21s clean output

---

## Files

```
backend/tts/
├── __init__.py      Public API: synthesise()
└── speaker.py       KannadaSpeaker class (VitsModel wrapper)

data/tts_output/     .wav files from synthesise(output_path=...)  [gitignored]
```

---

## Design Decision History -- Why Not indic-parler-tts

The original design specified `ai4bharat/indic-parler-tts` (Parler-TTS, ~0.9B params)
as the TTS model due to its higher Kannada voice quality (NSS 88.17) and 4 named
Kannada voices (Suresh, Anu, Chetan, Vidya).

**Two sequential blockers were hit:**

### Blocker 1 -- transformers metadata pin
`parler-tts 0.2.x` on PyPI pins `transformers==4.46.1` as a hard dependency in its
`setup.py`. Installing it via `pip install parler-tts` silently downgraded
transformers from 4.57.6 to 4.46.1, breaking IndicTransToolkit (requires >=4.51)
and the Translation module (`dtype=` parameter removed in 4.46.x).

Workaround applied: `pip install parler-tts --no-deps` to skip the broken metadata pin,
then `pip install "transformers>=4.51,<5" --upgrade` to restore the correct version.
This is documented in `requirements.txt` and `setup.bat`.

### Blocker 2 -- GenerationMixin incompatibility (fatal, no fix)
After resolving Blocker 1, model loading succeeded but inference crashed with:
```
ValueError: Config has to be initialized with text_encoder, audio_encoder and decoder config
```
This is a known issue (parler-tts GitHub issue #219, opened July 2025, still open).
In transformers >=4.50, `PretrainedConfig.to_diff_dict()` calls `self.__class__()`
with no arguments for logging purposes. `ParlerTTSConfig.__init__` requires
`text_encoder`, `audio_encoder`, and `decoder` and raises `ValueError` when called
with no args.

A monkey-patch was applied to override `ParlerTTSConfig.to_diff_dict` to skip the
no-args instantiation. This unblocked model loading. However, inference then crashed
with a second fatal error:
```
AttributeError: 'ParlerTTSForConditionalGeneration' object has no attribute '_validate_model_kwargs'
```
Investigation revealed that parler-tts's custom `generate()` method calls 10
`GenerationMixin` methods that were removed from `PreTrainedModel` in transformers
>=4.50 (verified by AST analysis). The maintainer's official workaround is
`transformers<4.50` -- which conflicts with IndicTransToolkit's `>=4.51` requirement.
There is no fix that works in a shared environment.

**Decision:** Abandon `indic-parler-tts` entirely. Use `facebook/mms-tts-kan` instead.

### Why facebook/mms-tts-kan
- No gating, no auth, no dependency conflicts
- `VitsModel` is natively in transformers 4.57.6 -- zero new installs
- 36 MB vs 2 GB model size
- Fully offline after 36 MB download
- Voice quality lower but acceptable for demo scope

The monkey-patches added for parler-tts were removed entirely from the shipped code.
Dead code does not ship.
