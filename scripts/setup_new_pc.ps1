# ============================================================================
# setup_new_pc.ps1 — Full first-time setup for Kannada Voice Banking Assistant
#
# Run from project root (or from anywhere):
#   powershell -ExecutionPolicy Bypass -File scripts\setup_new_pc.ps1
#
# What this script does:
#   1. Checks Python 3.12+ and Node.js 18+
#   2. Creates .venv and installs all Python packages
#   3. Guides HuggingFace login (you still accept licenses in the browser)
#   4. Downloads / converts STT, Translation, NLU, TTS models
#   5. Runs npm install for the frontend
#
# What YOU must do manually (cannot be automated):
#   - Accept IndicTrans2 licenses on HuggingFace website
#   - Paste your HF token when prompted
#   - Install MSVC Build Tools if IndicTransToolkit fails to compile
# ============================================================================

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $ProjectRoot "requirements.txt"))) {
    $ProjectRoot = Get-Location
}
Set-Location $ProjectRoot

function Write-Step($n, $msg) {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host "  STEP $n — $msg" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan
}

function Fail($msg) {
    Write-Host ""
    Write-Host "ERROR: $msg" -ForegroundColor Red
    exit 1
}

function Ok($msg) {
    Write-Host "  OK: $msg" -ForegroundColor Green
}

Write-Host ""
Write-Host "Kannada Voice Banking — full PC setup" -ForegroundColor Yellow
Write-Host "Project: $ProjectRoot"
Write-Host ""

# --------------------------------------------------------------------------
# STEP 1 — Python
# --------------------------------------------------------------------------
Write-Step "1/8" "Checking Python"

$py = $null
foreach ($candidate in @("python", "py")) {
    try {
        $verOut = & $candidate --version 2>&1
        if ($LASTEXITCODE -eq 0 -or $verOut -match "Python") {
            $py = $candidate
            break
        }
    } catch { }
}

if (-not $py) {
    Fail "Python not found. Install Python 3.12+ from https://www.python.org/downloads/ and tick 'Add Python to PATH', then re-run this script."
}

$verText = & $py --version 2>&1
Ok $verText

# Require 3.10-3.12. Newer versions lack prebuilt wheels for av/torch/ctranslate2,
# which forces slow source builds that need a full C/C++ toolchain.
$m = [regex]::Match("$verText", "Python (\d+)\.(\d+)")
if ($m.Success) {
    $major = [int]$m.Groups[1].Value
    $minor = [int]$m.Groups[2].Value

    if ($major -lt 3 -or ($major -eq 3 -and $minor -lt 10)) {
        Fail "Need Python 3.10-3.12 (3.12 recommended). Found: $verText"
    }

    if ($major -eq 3 -and $minor -gt 12) {
        # Try to find a supported interpreter via the py launcher
        $alt = $null
        foreach ($want in @("3.12", "3.11", "3.10")) {
            try {
                & py "-$want" --version *> $null
                if ($LASTEXITCODE -eq 0) { $alt = $want; break }
            } catch { }
        }
        if ($alt) {
            Write-Host "  $verText has no prebuilt ML wheels; switching to Python $alt" -ForegroundColor Yellow
            $py = "py"
            $script:PyArgs = @("-$alt")
            Ok "Using Python $alt via py launcher"
        } else {
            Fail @"
$verText is too new. Packages like av, torch and ctranslate2 have no prebuilt
wheels for it, so pip compiles them from source and fails.

Install Python 3.12 from:
  https://www.python.org/downloads/release/python-31210/

Then delete the old venv and re-run this script:
  Remove-Item .venv -Recurse -Force
"@
        }
    }
}
if (-not $script:PyArgs) { $script:PyArgs = @() }

# --------------------------------------------------------------------------
# STEP 2 — Node.js
# --------------------------------------------------------------------------
Write-Step "2/8" "Checking Node.js / npm"

$nodeOk = $false
try {
    $nodeVer = & node --version 2>&1
    $npmVer = & npm --version 2>&1
    if ($LASTEXITCODE -eq 0 -or "$nodeVer" -match "v\d+") {
        Ok "node $nodeVer"
        Ok "npm $npmVer"
        $nodeOk = $true
    }
} catch { }

if (-not $nodeOk) {
    Fail "Node.js not found. Install Node 18+ from https://nodejs.org/ then re-run this script."
}

# --------------------------------------------------------------------------
# STEP 3 — Virtual environment
# --------------------------------------------------------------------------
Write-Step "3/8" "Creating Python virtual environment (.venv)"

$venvPython = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
$venvPip = Join-Path $ProjectRoot ".venv\Scripts\pip.exe"

if (-not (Test-Path $venvPython)) {
    & $py @($script:PyArgs) -m venv .venv
    if (-not (Test-Path $venvPython)) {
        Fail "Failed to create .venv"
    }
    Ok "Created .venv"
} else {
    $existing = & $venvPython --version 2>&1
    Ok ".venv already exists ($existing)"
    $vm = [regex]::Match("$existing", "Python 3\.(\d+)")
    if ($vm.Success -and [int]$vm.Groups[1].Value -gt 12) {
        Fail @"
Existing .venv uses $existing, which has no prebuilt ML wheels.
Delete it and re-run this script:
  Remove-Item .venv -Recurse -Force
"@
    }
}

# Always use venv python/pip — avoids Activate.ps1 execution-policy issues
function VPy { & $venvPython @args }
function VPip { & $venvPython -m pip @args }

Write-Host "  Using: $venvPython"

# --------------------------------------------------------------------------
# STEP 4 — Python packages
# --------------------------------------------------------------------------
Write-Step "4/8" "Installing Python packages (this can take several minutes)"

Write-Host "  Upgrading pip..."
VPip install --upgrade pip

Write-Host "  Installing Cython / numpy / setuptools..."
VPip install Cython numpy setuptools

Write-Host "  Installing IndicTransToolkit (Windows: --no-build-isolation)..."
try {
    VPip install IndicTransToolkit --no-build-isolation
} catch {
    Write-Host ""
    Write-Host "  IndicTransToolkit failed to build." -ForegroundColor Yellow
    Write-Host "  Install Microsoft C++ Build Tools:" -ForegroundColor Yellow
    Write-Host "    https://visualstudio.microsoft.com/visual-cpp-build-tools/" -ForegroundColor Yellow
    Write-Host "  Select workload: Desktop development with C++" -ForegroundColor Yellow
    Write-Host "  Then restart the terminal and re-run this script." -ForegroundColor Yellow
    Fail "IndicTransToolkit install failed (usually missing MSVC Build Tools)"
}

# Confirm IndicTransToolkit import
VPy -c "from IndicTransToolkit import IndicProcessor; print('IndicTransToolkit OK')"
if ($LASTEXITCODE -ne 0) {
    Fail "IndicTransToolkit installed but import failed"
}
Ok "IndicTransToolkit import works"

Write-Host "  Installing requirements.txt..."
VPip install -r requirements.txt

VPy -c "import transformers, fastapi, uvicorn, faster_whisper; print('Core imports OK')"
if ($LASTEXITCODE -ne 0) {
    Fail "Some required packages failed to import"
}
Ok "Python dependencies installed"

# --------------------------------------------------------------------------
# STEP 5 — HuggingFace licenses + login
# --------------------------------------------------------------------------
Write-Step "5/8" "HuggingFace authentication"

Write-Host ""
Write-Host "  REQUIRED (browser — do this now if not done already):" -ForegroundColor Yellow
Write-Host "  1. Log in at https://huggingface.co/login"
Write-Host "  2. Accept license on BOTH pages (click Agree and access repository):"
Write-Host "     - https://huggingface.co/ai4bharat/indictrans2-indic-en-dist-200M"
Write-Host "     - https://huggingface.co/ai4bharat/indictrans2-en-indic-dist-200M"
Write-Host "  3. Create a Read token at https://huggingface.co/settings/tokens"
Write-Host ""

$ready = Read-Host "  Have you accepted both licenses and have a token ready? (Y/N)"
if ($ready -notmatch "^[Yy]") {
    Write-Host "  Pausing. Accept licenses, create a token, then re-run this script." -ForegroundColor Yellow
    exit 0
}

# Check if already logged in
$tokenOk = $false
try {
    $check = VPy -c "from huggingface_hub import get_token; t=get_token(); print('yes' if t else 'no')" 2>&1
    if ("$check" -match "yes") { $tokenOk = $true }
} catch { }

if ($tokenOk) {
    Ok "HuggingFace token already configured"
} else {
    Write-Host "  Logging in (paste your HF token when asked)..." -ForegroundColor Yellow
    # huggingface_hub >=1.0 ships `hf`; older versions ship `huggingface-cli`
    $hfExe = Join-Path $ProjectRoot ".venv\Scripts\hf.exe"
    $hfCli = Join-Path $ProjectRoot ".venv\Scripts\huggingface-cli.exe"
    if (Test-Path $hfExe) {
        & $hfExe auth login
    } elseif (Test-Path $hfCli) {
        & $hfCli login
    } else {
        VPip install -U "huggingface_hub[cli]"
        if (Test-Path $hfExe) {
            & $hfExe auth login
        } else {
            Fail "HuggingFace CLI not found. Run: .\.venv\Scripts\pip.exe install -U huggingface_hub[cli], then: .\.venv\Scripts\hf.exe auth login"
        }
    }
}

Write-Host "  Verifying gated model access..."
VPy -c @"
from huggingface_hub import model_info
for m in ['ai4bharat/indictrans2-indic-en-dist-200M', 'ai4bharat/indictrans2-en-indic-dist-200M']:
    print('OK:', model_info(m).id)
"@
if ($LASTEXITCODE -ne 0) {
    Fail "Cannot access IndicTrans2 models. Accept licenses in the browser and run: .\.venv\Scripts\hf.exe auth login"
}
Ok "Gated IndicTrans2 access verified"

# --------------------------------------------------------------------------
# STEP 6 — Models
# --------------------------------------------------------------------------
Write-Step "6/8" "Downloading / preparing ML models (long — stay online)"

# Clear offline flags for download phase
$env:TRANSFORMERS_OFFLINE = "0"
$env:HF_HUB_OFFLINE = "0"
$env:HF_DATASETS_OFFLINE = "0"
$env:PYTHONPATH = $ProjectRoot

# 6a STT
$sttDir = Join-Path $ProjectRoot "models\whisper-medium-vaani-ct2\model.bin"
if (Test-Path $sttDir) {
    Ok "STT model already present (models\whisper-medium-vaani-ct2)"
} else {
    Write-Host "  Converting STT model (download ~1.5 GB, several minutes)..."
    VPy backend\stt\convert_models.py --model specialized
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $sttDir)) {
        Fail "STT model conversion failed"
    }
    Ok "STT model ready"
}

# 6b Translation kn->en
Write-Host "  Caching IndicTrans2 kn->en..."
VPy -c "from transformers import AutoModelForSeq2SeqLM, AutoTokenizer; m='ai4bharat/indictrans2-indic-en-dist-200M'; AutoTokenizer.from_pretrained(m, trust_remote_code=True); AutoModelForSeq2SeqLM.from_pretrained(m, trust_remote_code=True); print('kn->en OK')"
if ($LASTEXITCODE -ne 0) { Fail "IndicTrans2 kn->en download failed" }
Ok "Translation kn->en cached"

# 6c Translation en->kn
Write-Host "  Caching IndicTrans2 en->kn..."
VPy -c "from transformers import AutoModelForSeq2SeqLM, AutoTokenizer; m='ai4bharat/indictrans2-en-indic-dist-200M'; AutoTokenizer.from_pretrained(m, trust_remote_code=True); AutoModelForSeq2SeqLM.from_pretrained(m, trust_remote_code=True); print('en->kn OK')"
if ($LASTEXITCODE -ne 0) { Fail "IndicTrans2 en->kn download failed" }
Ok "Translation en->kn cached"

# 6d NLU
$nluDir = Join-Path $ProjectRoot "models\nlu-distilbert\config.json"
if (Test-Path $nluDir) {
    Ok "NLU model already present (models\nlu-distilbert)"
} else {
    Write-Host "  Training NLU DistilBERT (few minutes on CPU)..."
    $env:PYTHONIOENCODING = "utf-8"
    VPy backend\nlu\train.py
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $nluDir)) {
        Fail "NLU training failed"
    }
    Ok "NLU model ready"
}

# 6e TTS
Write-Host "  Caching TTS facebook/mms-tts-kan..."
VPy -c "from transformers import VitsModel, AutoTokenizer; m='facebook/mms-tts-kan'; AutoTokenizer.from_pretrained(m); VitsModel.from_pretrained(m); print('TTS OK')"
if ($LASTEXITCODE -ne 0) { Fail "TTS model download failed" }
Ok "TTS model cached"

# --------------------------------------------------------------------------
# STEP 7 — Frontend
# --------------------------------------------------------------------------
Write-Step "7/8" "Installing frontend (npm install)"

Push-Location (Join-Path $ProjectRoot "frontend")
try {
    npm install
    if ($LASTEXITCODE -ne 0) { Fail "npm install failed" }
    Ok "Frontend dependencies installed"
} finally {
    Pop-Location
}

# --------------------------------------------------------------------------
# STEP 8 — Done / how to run
# --------------------------------------------------------------------------
Write-Step "8/8" "Setup complete"

Write-Host ""
Write-Host "All automated steps finished." -ForegroundColor Green
Write-Host ""
Write-Host "To run the app, open TWO terminals:" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Terminal 1 — API"
Write-Host "    cd $ProjectRoot"
Write-Host "    .\.venv\Scripts\python.exe -m uvicorn api.main:app --reload --port 8000"
Write-Host ""
Write-Host "  Terminal 2 — Frontend"
Write-Host "    cd $ProjectRoot\frontend"
Write-Host "    npm run dev"
Write-Host ""
Write-Host "  Then open: http://localhost:5173"
Write-Host ""
Write-Host "Tip: If PowerShell blocks Activate.ps1, you do NOT need to activate."
Write-Host "     Always call .\.venv\Scripts\python.exe as shown above."
Write-Host ""
