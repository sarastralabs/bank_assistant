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

echo [1/4] Installing base dependencies...
pip install -r requirements.txt --ignore-requires-python

echo.
echo [2/4] Installing parler-tts WITHOUT its broken dependency pin...
pip install parler-tts --no-deps

echo.
echo [3/4] Restoring transformers to required version (>=4.51)...
pip install "transformers>=4.51.0,<5" --upgrade

echo.
echo [4/4] Verifying critical versions...
python -c "import transformers, parler_tts; print('transformers:', transformers.__version__); print('parler_tts: OK')"

echo.
echo Setup complete. If transformers shows 4.46.x above, re-run step 3:
echo   pip install "transformers>=4.51.0,<5" --upgrade
