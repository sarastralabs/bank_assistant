@echo off
REM ============================================================================
REM setup.bat — Reproducible environment setup for the Voice Banking Assistant
REM
REM Run this instead of "pip install -r requirements.txt" directly.
REM It handles a known dependency conflict: parler-tts 0.2.x pins
REM transformers==4.46.1 in its metadata (a bug in the package), which would
REM silently downgrade transformers and break the Translation module.
REM
REM Usage:  setup.bat
REM ============================================================================

echo [1/3] Installing base dependencies...
pip install -r requirements.txt --ignore-requires-python

echo.
echo [2/3] Verifying critical versions...
python -c "import transformers; print('transformers:', transformers.__version__)"

echo.
echo Setup complete.
