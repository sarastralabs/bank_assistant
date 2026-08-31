# Kannada Voice Banking Assistant

A full AI/ML pipeline that takes spoken Kannada audio and returns a Kannada voice response for banking queries. Built as a college engineering project (AI/ML branch).

---

## Pipeline Overview

```
User speaks Kannada
        ↓
[Module 1] STT — Whisper (ARTPARK-IISc vaani-kannada, int8)
        ↓  Kannada text
[Module 2] Translation — IndicTrans2 indic-en-dist-200M
        ↓  English text
[Module 3] NLU — DistilBERT fine-tuned (94 training samples, 7 intents)
        ↓  Intent label + confidence
[Module 4] Decision Router — pure Python logic
        ↓  Route (informational/transactional) + English response text
[Module 5] TTS — IndicTrans2 en-indic + Facebook MMS-TTS (mms-tts-kan)
        ↓
User hears Kannada voice response
```

---

## Project Structure

```
voice-based-assistant/
│
├── backend/                    # All AI/ML modules
│   ├── pipeline.py             # Sequential pipeline orchestrator (main entry point)
│   ├── pipeline_bridge.py      # Bridge for API calls
│   │
│   ├── stt/                    # Module 1: Speech-to-Text
│   │   ├── __init__.py         # Public API: transcribe(), unload_model()
│   │   ├── transcriber.py      # KannadaTranscriber (faster-whisper wrapper)
│   │   ├── convert_models.py   # One-time: HuggingFace → CTranslate2 int8
│   │   ├── benchmark.py        # WER/CER comparison script
│   │   ├── utils.py            # Audio validation, silence detection
│   │   └── exceptions.py       # STTInputError
│   │
│   ├── translation/            # Module 2: Kannada ↔ English Translation
│   │   ├── __init__.py         # Public API: translate_kn_to_en(), translate_en_to_kn(), unload_model()
│   │   ├── translator.py       # IndicTranslator (IndicTrans2 wrapper)
│   │   ├── benchmark.py        # BLEU/chrF2++ benchmark
│   │   ├── utils.py            # Language code validation
│   │   └── exceptions.py       # TranslationInputError
│   │
│   ├── nlu/                    # Module 3: Intent Classification
│   │   ├── __init__.py         # Public API: classify(), unload_model()
│   │   ├── train.py            # Fine-tuning script (run once on GPU)
│   │   ├── evaluate.py         # Comparison: keyword baseline vs DistilBERT
│   │   ├── distilbert_classifier.py  # Fine-tuned DistilBERT inference
│   │   ├── keyword_classifier.py     # Rule-based baseline (no training)
│   │   ├── dataset.py          # Data loading + stratified split
│   │   ├── intents.py          # Single source of truth for 7 intent labels
│   │   └── exceptions.py       # NLUInputError
│   │
│   ├── decision_router/        # Module 4: Decision Router (no ML)
│   │   ├── __init__.py         # Public API: route()
│   │   ├── router.py           # Routing logic + bank_info.json lookup
│   │   └── exceptions.py       # RouterError
│   │
│   ├── tts/                    # Module 5: Text-to-Speech
│   │   ├── __init__.py         # Public API: synthesise(), unload_model()
│   │   └── speaker.py          # KannadaSpeaker (MMS-TTS wrapper)
│   │
│   └── forms/                  # Form generation (entity extraction)
│       ├── extract.py          # Entity extraction from English text
│       └── intent_map.py       # Intent → required fields mapping
│
├── api/                        # FastAPI backend server
│   ├── main.py                 # FastAPI app entry point
│   ├── kiosk_state.py          # Session/state management
│   ├── audio.py                # Audio file handling
│   └── routes/                 # API route handlers
│       ├── pipeline.py         # /api/pipeline endpoint
│       ├── kiosk.py            # /api/kiosk endpoints
│       ├── forms.py            # /api/forms endpoints
│       └── history.py          # /api/history endpoints
│
├── frontend/                   # React + TypeScript UI
│   ├── src/App.tsx             # Main user kiosk interface
│   ├── src/AdminApp.tsx        # Admin dashboard
│   └── src/components/         # UI components
│
├── data/
│   ├── nlu_training_data.json  # 294 labeled sentences (42 per intent)
│   ├── bank_info.json          # Banking rates + procedures (informational responses)
│   ├── forms.json              # Form templates for transactional flows
│   ├── stt_test_audio/         # 11 Kannada test audio clips
│   │   └── transcripts.json   # Ground-truth Kannada transcripts
│   └── translation_test/
│       └── reference_translations.json  # English reference translations
│
├── models/
│   ├── whisper-medium-ct2/          # Baseline STT model (CTranslate2 int8)
│   ├── whisper-medium-vaani-ct2/    # Specialized Kannada STT model
│   └── nlu-distilbert/              # Fine-tuned DistilBERT + benchmark results
│
├── scripts/
│   ├── setup_new_pc.bat        # Full setup script for new machine
│   └── setup_new_pc.ps1        # PowerShell version
│
├── requirements.txt            # Python dependencies
├── backend/pipeline.py         # Run this to test the full pipeline
└── run_tts_responses_fast.py   # Generate audio responses for all 11 test clips
```

---

## 7 Banking Intents

| Intent | Meaning | Route |
|--------|---------|-------|
| `check_balance` | Check account balance | informational |
| `apply_loan` | Apply for a loan | transactional |
| `open_account` | Open a new account | transactional |
| `deposit_money` | Deposit money | transactional |
| `withdraw_money` | Withdraw money | transactional |
| `account_info_query` | ATM card, PIN, cheque book, name change, etc. | informational |
| `interest_rate_query` | Interest rates, FD rates, loan repayment | informational |

---

## Models Used

| Module | Model | Size | Notes |
|--------|-------|------|-------|
| STT (baseline) | `openai/whisper-medium` | ~400MB int8 | Generic multilingual |
| STT (specialized) | `ARTPARK-IISc/whisper-medium-vaani-kannada` | ~400MB int8 | Fine-tuned on Kannada VAANI dataset |
| Translation KN→EN | `ai4bharat/indictrans2-indic-en-dist-200M` | ~800MB | Gated — requires HF auth |
| Translation EN→KN | `ai4bharat/indictrans2-en-indic-dist-200M` | ~800MB | Gated — requires HF auth |
| NLU | `distilbert-base-uncased` fine-tuned | ~250MB | Trained on 294 banking sentences |
| TTS | `facebook/mms-tts-kan` | ~36MB | Public — no auth needed |

---

## Benchmark Results

### STT (11 clips, seed=42, beam_size=5)

| Model | WER% | CER% |
|-------|------|------|
| Baseline (whisper-medium) | 111.11 | 87.55 |
| Specialized (vaani-kannada) | **50.00** | **20.60** |

### Translation (11 phrases, BLEU/chrF2++)

| Metric | Score |
|--------|-------|
| Corpus BLEU | 16.30 |
| Corpus chrF2++ | **48.28** |

### NLU (46 test sentences, stratified split seed=42)

| Model | Accuracy | Macro F1 |
|-------|----------|----------|
| Keyword baseline | 60.9% | 0.619 |
| Fine-tuned DistilBERT | **97.8%** | **0.979** |

---

## Quick Start

### Prerequisites
- Python 3.10+, Windows 10/11
- 16GB RAM, GPU recommended (8GB VRAM) but CPU works

### 1. Install dependencies

```bash
pip install -r requirements.txt
pip install IndicTransToolkit --no-build-isolation
pip install "transformers>=4.51.0,<5.0" --upgrade
pip install "huggingface-hub>=0.23,<1.0" --upgrade
```

### 2. HuggingFace authentication (one-time)

```bash
huggingface-cli login
```

Then visit these pages while logged in and click **"Agree and access"**:
- https://huggingface.co/ai4bharat/indictrans2-indic-en-dist-200M
- https://huggingface.co/ai4bharat/indictrans2-en-indic-dist-200M

### 3. One-time model setup

```bash
# Convert STT models (~10 minutes, downloads ~3GB)
python backend/stt/convert_models.py --model all

# Train NLU model (~1 minute on GPU)
python backend/nlu/train.py
```

### 4. Run the pipeline test (VERIFIED — confirmed working)

```bash
python -m backend.pipeline
```

Runs 4 test clips through the full pipeline. Audio responses saved to `data/tts_output/`.

### 5. Generate all 11 responses

```bash
python run_tts_responses_fast.py
```

Saves 11 Kannada voice response `.wav` files to `data/tts_output/`.

---

## Memory Architecture

All four AI models together would exceed 16GB RAM. The pipeline uses **sequential load-unload**:

```
STT model loads → transcribe → STT unloads
Translation loads → translate → Translation unloads  
NLU loads → classify → NLU unloads
Router runs (no model, instant)
TTS loads → synthesise → TTS unloads
```

Peak GPU memory: ~0.4GB at any moment. Verified stable across 4 repeated runs.

---

## Key Design Decisions

**Why DistilBERT for NLU instead of a larger model?**
DistilBERT is 40% smaller than BERT-base, 60% faster at inference, and retains 97% of accuracy. For 294 training sentences, the capacity difference is irrelevant — DistilBERT reached 97.8% test accuracy.

**Why Facebook MMS-TTS instead of indic-parler-tts?**
indic-parler-tts was the original choice (higher voice quality) but has a hard incompatibility with transformers >=4.50: 10 GenerationMixin methods removed from the custom generate() call. MMS-TTS uses VitsModel natively in transformers, has no dependency conflicts, and requires no HuggingFace auth.

**Why keyword matching as the NLU baseline?**
BART-large-mnli (the standard zero-shot baseline) requires 50+ GB RAM on CPU. Keyword matching is the honest baseline for a 300-sentence domain-specific dataset — it shows what's achievable with zero training data.

**Why sequential model unloading?**
Loading all 4 models simultaneously causes a Windows access violation (exit -1073740791). Sequential load-unload keeps peak memory under 1GB and the process stable.

---

## API Server (FastAPI)

```bash
cd api
uvicorn main:app --reload --port 8000
```

Endpoints:
- `POST /api/pipeline` — process audio file, returns intent + audio response
- `GET /api/history` — query history
- `POST /api/forms` — form generation for transactional flows

---

## Frontend (React)

```bash
cd frontend
npm install
npm run dev
```

Opens at `http://localhost:5173`

---

## License

Academic project — AI/ML Engineering, 2024-25.
Models are subject to their respective licences (see each module's README).
