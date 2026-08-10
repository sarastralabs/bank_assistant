# Setup isolated Parler-TTS venv (does not touch main project packages).
# Run from repo root:  .\scripts\setup_parler_venv.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$Venv = Join-Path $Root ".venv-parler"
$Py = Join-Path $Venv "Scripts\python.exe"

Write-Host "==> Creating .venv-parler (isolated Indic Parler-TTS)"
if (-not (Test-Path $Py)) {
  python -m venv $Venv
}

Write-Host "==> Upgrading pip"
& $Py -m pip install --upgrade pip wheel setuptools

Write-Host "==> Installing torch (CUDA if available on machine index, else default)"
# Prefer same CUDA wheel family as main env when possible; CPU also works (slower).
try {
  & $Py -m pip install "torch>=2.1,<2.5" "torchaudio>=2.1,<2.5" --index-url https://download.pytorch.org/whl/cu124
} catch {
  & $Py -m pip install "torch>=2.1,<2.5" "torchaudio>=2.1,<2.5"
}

Write-Host "==> Installing transformers==4.46.1 + deps"
& $Py -m pip install "transformers==4.46.1" "accelerate>=0.25" "sentencepiece>=0.2" "soundfile>=0.12" "numpy>=1.24,<2.1" "huggingface_hub>=0.23,<1" "protobuf>=4" 

Write-Host "==> Installing parler-tts (--no-deps so transformers stays 4.46.1)"
& $Py -m pip install "git+https://github.com/huggingface/parler-tts.git" --no-deps
# descript-audiotools pins protobuf<3.20; parler needs protobuf>=4 — install codec with --no-deps
& $Py -m pip install "descript-audiotools>=0.7.0"
& $Py -m pip install "descript-audio-codec==1.0.0" --no-deps
& $Py -m pip install einops "protobuf>=4.0,<5"

Write-Host "==> Warming Hugging Face cache for ai4bharat/indic-parler-tts (large download)"
& $Py -c @"
from parler_tts import ParlerTTSForConditionalGeneration
from transformers import AutoTokenizer
print('Downloading model...')
m = ParlerTTSForConditionalGeneration.from_pretrained('ai4bharat/indic-parler-tts')
AutoTokenizer.from_pretrained('ai4bharat/indic-parler-tts')
AutoTokenizer.from_pretrained(m.config.text_encoder._name_or_path)
print('Parler model ready')
"@

Write-Host ""
Write-Host "Done. Parler python: $Py"
Write-Host "Set BANK_TTS_ENGINE=parler (default when .venv-parler exists)."
Write-Host "Speakers: BANK_TTS_SPEAKER=Suresh|Anu (default Suresh)"
