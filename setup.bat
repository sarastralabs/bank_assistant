@echo off
REM ============================================================================
REM setup.bat — Reproducible environment setup for the Voice Banking Assistant
REM
REM Windows note: IndicTransToolkit compiles a C extension and requires
REM Microsoft C++ Build Tools. Install from:
REM   https://visualstudio.microsoft.com/visual-cpp-build-tools/
REM Select workload: "Desktop development with C++"
REM
REM Usage:  setup.bat
REM ============================================================================

echo [1/4] Installing Cython (required for IndicTransToolkit on Windows)...
pip install Cython numpy setuptools

echo.
echo [2/4] Installing IndicTransToolkit (Windows: --no-build-isolation)...
pip install IndicTransToolkit --no-build-isolation
if errorlevel 1 (
    echo.
    echo ERROR: IndicTransToolkit failed to build.
    echo.
    echo On Windows you need Microsoft Visual C++ 14.0 or greater.
    echo Install "Build Tools for Visual Studio" from:
    echo   https://visualstudio.microsoft.com/visual-cpp-build-tools/
    echo Then select workload: "Desktop development with C++"
    echo After installing, restart this terminal and run setup.bat again.
    exit /b 1
)

echo.
echo [3/4] Installing remaining dependencies...
pip install -r requirements.txt

echo.
echo [4/4] Verifying critical versions...
python -c "from IndicTransToolkit import IndicProcessor; print('IndicTransToolkit: OK')"
python -c "import transformers; print('transformers:', transformers.__version__)"

echo.
echo Setup complete.
