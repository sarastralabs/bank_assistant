"""
backend/stt/transcriber.py

Core inference wrapper around faster-whisper for Kannada speech-to-text.

Usage
-----
    from backend.stt.transcriber import KannadaTranscriber

    t = KannadaTranscriber("models/whisper-medium-vaani-ct2")
    text = t.transcribe("data/stt_test_audio/clip_001.wav")
    print(text)          # ನನ್ನ ಖಾತೆಯ ಬಾಕಿ ಎಷ್ಟಿದೆ
    print(t.last_inference_time_s)   # e.g. 3.7
"""

import os
import time
import warnings

import numpy as np
import soundfile as sf
from faster_whisper import WhisperModel

from backend.stt.exceptions import STTInputError
from backend.stt.utils import is_silent, validate_audio_file


def _detect_device() -> str:
    """
    Return ``"cuda"`` if a CUDA-capable GPU is available, else ``"cpu"``.

    Importing torch just for device detection is lightweight — the tensor
    runtime itself is not loaded until an actual tensor operation is called.
    torch is listed as an optional dependency; if it is not installed or its
    native CUDA runtime is broken, we fall back silently to CPU.
    """
    try:
        import torch  # noqa: PLC0415

        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


class KannadaTranscriber:
    """
    Transcribe Kannada ``.wav`` audio files to Kannada text.

    Wraps ``faster_whisper.WhisperModel`` with:
    - Automatic CPU/GPU device selection
    - int8 quantization for reduced memory and faster CPU inference
    - Pre-inference audio validation (file existence, format, corruption)
    - Lightweight silence detection to short-circuit inference on empty clips
    - Forced ``language="kn"`` to skip language-detection overhead

    Parameters
    ----------
    model_path:
        Path to a local CTranslate2-converted Whisper model directory.
        Run ``python backend/stt/convert_models.py --model all`` first.
    device:
        ``"cpu"`` or ``"cuda"``.  If ``None`` (default), auto-detected via
        :func:`_detect_device`.
    compute_type:
        CTranslate2 quantization type.  ``"int8"`` is recommended for CPU
        deployments (reduces ~1.5 GB float32 model to ~400 MB).
        Use ``"float16"`` on CUDA if higher accuracy is needed.

    Attributes
    ----------
    last_inference_time_s:
        Wall-clock seconds taken by the most recent :meth:`transcribe` call.
        Initialised to ``0.0`` before the first call.
    """

    def __init__(
        self,
        model_path: str,
        device: str | None = None,
        compute_type: str = "int8",
    ) -> None:
        if not os.path.isdir(model_path):
            raise FileNotFoundError(
                f"Model directory not found: '{model_path}'. "
                "Run 'python backend/stt/convert_models.py --model all' "
                "to download and convert the required models."
            )

        self._model_path = model_path
        self._device = device if device is not None else _detect_device()
        self._compute_type = compute_type
        self.last_inference_time_s: float = 0.0

        self._model = self._load_model()

    def _load_model(self) -> WhisperModel:
        """
        Instantiate and return a ``WhisperModel`` from the local model path.

        ``faster-whisper`` reads the CTranslate2 model directory directly;
        no additional conversion step is needed at inference time.

        If CUDA initialization fails (for example because the local cuDNN/cuBLAS
        runtime is incompatible or unavailable), fall back to CPU so the
        pipeline can still run instead of crashing at import/load time.
        """
        try:
            return WhisperModel(
                self._model_path,
                device=self._device,
                compute_type=self._compute_type,
            )
        except Exception as exc:
            if self._device == "cpu":
                raise

            warnings.warn(
                f"CUDA STT initialization failed ({exc}); falling back to CPU.",
                stacklevel=2,
            )
            return WhisperModel(
                self._model_path,
                device="cpu",
                compute_type=self._compute_type,
            )

    def transcribe(
        self,
        audio_path: str,
        beam_size: int = 1,
    ) -> str:
        """
        Transcribe a Kannada ``.wav`` file and return the Kannada text.

        Parameters
        ----------
        audio_path:
            Path to the ``.wav`` audio file to transcribe.
        beam_size:
            Beam search width used during decoding.

            - ``1`` (default) — greedy decoding; fastest on CPU, meets the
              ≤10 second latency target for the production/client path.
            - ``5`` — standard beam search; more accurate but ~3–5× slower.
              Use this value from the benchmark script where accuracy
              comparison matters more than real-time latency.

        Returns
        -------
        str
            Transcribed Kannada text.  Returns ``""`` for silent or
            speech-free clips (no exception raised).

        Raises
        ------
        STTInputError
            If the audio file does not exist, has an unsupported extension,
            or is corrupted/unreadable.
        """
        # --- 1. Validate input ---
        validate_audio_file(audio_path)

        # --- 2. Quick silence pre-check (avoids loading the full clip into
        #        the model when the user hasn't spoken yet) ---
        audio_array, sample_rate = sf.read(audio_path, dtype="float32", always_2d=False)
        if is_silent(audio_array):
            self.last_inference_time_s = 0.0
            return ""

        # --- 3. Run model inference ---
        t_start = time.perf_counter()

        segments, _info = self._model.transcribe(
            audio_path,
            language="kn",       # Force Kannada; skip language-detection (saves ~1–2 s)
            task="transcribe",   # Keep Kannada output (not translation to English)
            beam_size=beam_size,
            vad_filter=True,     # Built-in VAD removes silence padding automatically
            word_timestamps=False,
        )

        # Segments are a lazy generator — iterate to materialise them
        text = " ".join(seg.text.strip() for seg in segments).strip()

        self.last_inference_time_s = time.perf_counter() - t_start

        return text
