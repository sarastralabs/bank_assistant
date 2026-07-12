# Kannada Voice Banking Assistant

Informational Kannada voice banking demo: speak in Kannada, get spoken **how-to guidance** back in Kannada.

This app does **not** fetch live account balances or personal bank data. It explains how to complete banking tasks (ATM, branch, forms) using a local ML pipeline.

## What you get

- **Web UI** (React) — Home · Assist · History  
- **API** (FastAPI) — audio processing + SQLite query history  
- **Pipeline** (offline after one-time model download):

```
Kannada audio
  → STT (Whisper VAANI / faster-whisper)
  → Translation KN→EN (IndicTrans2)
  → NLU (DistilBERT intents)
  → Decision Router (static bank_info.json)
  → TTS (MMS-TTS + EN→KN)
  → Kannada voice reply
```

Supported intents: how to check balance, apply for loan, open account, deposit, withdraw, account procedures, interest rates.

---

## Requirements

| Item | Notes |
|------|--------|
| **Python** | 3.12+ recommended |
| **Node.js** | 18+ (for the frontend) |
| **Disk** | ~4–6 GB free for models + HF cache |
| **RAM** | 8 GB minimum; 16 GB comfortable |
| **Internet** | Needed **once** for package + model downloads |
| **Windows** | Microsoft C++ Build Tools (for `IndicTransToolkit`) |
| **HuggingFace account** | Required for gated IndicTrans2 models |

Optional: [ffmpeg](https://ffmpeg.org/) on PATH (helps browser `.webm` conversion; PyAV is used as fallback).

---

## Full setup (do these in order)

### 1. Clone / open the project

```bash
cd D:\Projects\bank_assistant
```

### 2. Windows only — install C++ Build Tools

`IndicTransToolkit` compiles a C extension. Without MSVC you will see:

`error: Microsoft Visual C++ 14.0 or greater is required`

1. Install [Build Tools for Visual Studio](https://visualstudio.microsoft.com/visual-cpp-build-tools/)  
   or: `winget install Microsoft.VisualStudio.2022.BuildTools`
2. Select workload: **Desktop development with C++** (or VCTools)
3. **Restart the terminal** after install

### 3. Create a virtual environment (recommended)

```bash
python -m venv .venv

# Windows PowerShell
.\.venv\Scripts\Activate.ps1

# Windows CMD
.\.venv\Scripts\activate.bat

# Linux / macOS
source .venv/bin/activate
```

### 4. Install Python packages

**Windows (use the project script):**

```bash
setup.bat
```

That runs:

1. `pip install Cython numpy setuptools`
2. `pip install IndicTransToolkit --no-build-isolation`
3. `pip install -r requirements.txt`

**Or manually on Windows:**

```bash
pip install Cython numpy setuptools
pip install IndicTransToolkit --no-build-isolation
pip install -r requirements.txt
```

**Linux / macOS:**

```bash
pip install -r requirements.txt
```

**CPU-only PyTorch (optional, smaller install):**

```bash
pip install torch --index-url https://download.pytorch.org/whl/cpu
```

Verify:

```bash
python -c "from IndicTransToolkit import IndicProcessor; print('IndicTransToolkit OK')"
python -c "import transformers; print('transformers', transformers.__version__)"
```

### 5. HuggingFace account, licenses, and token

IndicTrans2 models are **gated**. You must accept licenses and authenticate before download.

#### 5a. Create / log into HuggingFace

https://huggingface.co/join

#### 5b. Accept model licenses (required)

While logged in, open each page and click **Agree and access repository**:

| Model | Purpose | Link |
|-------|---------|------|
| `ai4bharat/indictrans2-indic-en-dist-200M` | Kannada → English | https://huggingface.co/ai4bharat/indictrans2-indic-en-dist-200M |
| `ai4bharat/indictrans2-en-indic-dist-200M` | English → Kannada | https://huggingface.co/ai4bharat/indictrans2-en-indic-dist-200M |

STT / TTS models used below are public (no license click required).

#### 5c. Create an access token

1. Go to https://huggingface.co/settings/tokens  
2. Create a token with **Read** access  
3. Copy it

#### 5d. Log in on this machine

```bash
huggingface-cli login
```

Paste the token when prompted.

Or set an env var for the current session:

```bash
# Windows PowerShell
$env:HF_TOKEN="hf_xxxxxxxxxxxxxxxxxxxx"

# Windows CMD
set HF_TOKEN=hf_xxxxxxxxxxxxxxxxxxxx

# Linux / macOS
export HF_TOKEN=hf_xxxxxxxxxxxxxxxxxxxx
```

#### 5e. Verify gated access

```bash
python -c "from huggingface_hub import model_info; print(model_info('ai4bharat/indictrans2-indic-en-dist-200M').id); print(model_info('ai4bharat/indictrans2-en-indic-dist-200M').id)"
```

Both lines should print the model IDs. If you get `GatedRepoError`, re-check license acceptance and login.

### 6. Download / prepare ML models (one-time, needs internet)

Run these **with offline mode OFF** (do not set `HF_HUB_OFFLINE=1` yet).

#### 6a. STT — Kannada Whisper (required)

Downloads ~1.5 GB, converts to local CTranslate2 int8 under `models/`:

```bash
python backend/stt/convert_models.py --model specialized
```

This writes `models/whisper-medium-vaani-ct2/` including `tokenizer.json` for offline use.

Optional baseline (benchmark only):

```bash
python backend/stt/convert_models.py --model baseline
# or both: python backend/stt/convert_models.py --model all
```

#### 6b. Translation — IndicTrans2 (required)

Caches both gated models into the HuggingFace hub cache:

```bash
python -c "from transformers import AutoModelForSeq2SeqLM, AutoTokenizer; m='ai4bharat/indictrans2-indic-en-dist-200M'; AutoTokenizer.from_pretrained(m, trust_remote_code=True); AutoModelForSeq2SeqLM.from_pretrained(m, trust_remote_code=True); print('kn->en OK')"

python -c "from transformers import AutoModelForSeq2SeqLM, AutoTokenizer; m='ai4bharat/indictrans2-en-indic-dist-200M'; AutoTokenizer.from_pretrained(m, trust_remote_code=True); AutoModelForSeq2SeqLM.from_pretrained(m, trust_remote_code=True); print('en->kn OK')"
```

Cache location:

- Windows: `%USERPROFILE%\.cache\huggingface\hub`
- Linux/macOS: `~/.cache/huggingface/hub`

#### 6c. NLU — DistilBERT intent classifier (required)

Trains and saves the checkpoint (~few minutes on CPU):

```bash
# From project root so `backend` imports resolve
set PYTHONPATH=.
python backend/nlu/train.py
```

PowerShell:

```powershell
$env:PYTHONPATH="."
python backend/nlu/train.py
```

Output: `models/nlu-distilbert/`

#### 6d. TTS — MMS-TTS Kannada (required)

Public model (~36 MB), no auth:

```bash
python -c "from transformers import VitsModel, AutoTokenizer; m='facebook/mms-tts-kan'; AutoTokenizer.from_pretrained(m); VitsModel.from_pretrained(m); print('TTS OK')"
```

### 7. Install frontend dependencies

```bash
cd frontend
npm install
cd ..
```

### 8. Run the app

**Terminal 1 — API**

```bash
uvicorn api.main:app --reload --port 8000
```

**Terminal 2 — Frontend**

```bash
cd frontend
npm run dev
```

Or on Windows: `scripts\dev.bat`

Open **http://localhost:5173**

- **Home** — product landing (rates, intents, how-to messaging)  
- **Assist** — record / upload Kannada audio  
- **History** — saved queries + replay voice (SQLite)

The API runs with `HF_HUB_OFFLINE=1` so inference uses local caches only. If a model is missing, download it again with offline mode disabled (step 6).

---

## Checklist (first machine)

- [ ] Python 3.12+ and Node 18+
- [ ] MSVC Build Tools (Windows)
- [ ] `setup.bat` / `pip install -r requirements.txt` succeeded
- [ ] HuggingFace account created
- [ ] Accepted licenses for both IndicTrans2 models
- [ ] `huggingface-cli login` done
- [ ] STT converted → `models/whisper-medium-vaani-ct2/`
- [ ] IndicTrans2 cached (kn→en and en→kn)
- [ ] NLU trained → `models/nlu-distilbert/`
- [ ] TTS `facebook/mms-tts-kan` cached
- [ ] `npm install` in `frontend/`
- [ ] API on `:8000` and UI on `:5173`

---

## Project layout

```
bank_assistant/
├── api/                 FastAPI (process-audio, history, landing)
├── backend/             STT, translation, NLU, router, TTS, pipeline
├── frontend/            React + Vite UI
├── data/
│   ├── bank_info.json   Static guidance / sample rates
│   ├── nlu_training_data.json
│   ├── history.db       Query history (created at runtime)
│   └── history_audio/   Saved response WAVs
├── models/              Local STT + NLU checkpoints (gitignored)
├── scripts/dev.bat
├── run_pipeline_subprocess.py
├── setup.bat
├── requirements.txt
└── app.py               Optional Streamlit prototype
```

---

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/landing` | Home page data (rates, intents, stats) |
| POST | `/api/process-audio` | Upload audio → full pipeline JSON + `audio_b64`; saves history |
| GET | `/api/history` | List saved queries |
| GET | `/api/history/{id}` | One query including response audio |
| DELETE | `/api/history/{id}` | Delete one query |
| DELETE | `/api/history` | Clear all history |

---

## Optional: Streamlit UI

```bash
python -m streamlit run app.py
```

Opens http://localhost:8501

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Microsoft Visual C++ 14.0 required` | Install VS Build Tools + C++ workload; restart terminal; re-run `setup.bat` |
| `IndicTransToolkit` / Cython build fails | `pip install Cython numpy setuptools` then `pip install IndicTransToolkit --no-build-isolation` |
| `GatedRepoError` / 401 on IndicTrans2 | Accept licenses on HF website + `huggingface-cli login` |
| `Model directory not found ... whisper-medium-vaani-ct2` | `python backend/stt/convert_models.py --model specialized` |
| STT Hub / tokenizer offline error | Re-run STT convert (writes `tokenizer.json`) |
| `NLU model checkpoint not found` | `PYTHONPATH=. python backend/nlu/train.py` |
| TTS / translation “couldn't connect to huggingface.co” | Models not cached yet — download with internet (step 6), then restart API |
| `No module named 'pydub'` / audio convert fails | `pip install pydub soundfile av` (in requirements); optional: install ffmpeg |
| Frontend “API offline” | Start `uvicorn api.main:app --reload --port 8000` |

---

## Module docs

More detail per stage:

- [backend/stt/README.md](backend/stt/README.md)
- [backend/translation/README.md](backend/translation/README.md)
- [backend/tts/README.md](backend/tts/README.md)
- [backend/decision_router/README.md](backend/decision_router/README.md)
