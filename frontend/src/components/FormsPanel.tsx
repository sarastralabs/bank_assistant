import { useCallback, useEffect, useState } from "react";
import {
  fetchForm,
  fetchFormCatalog,
  normalizeFormValue,
  transcribeFormAudio,
  type BankForm,
  type FormCatalog,
} from "../api/client";
import { RecordButton } from "./RecordButton";
import { useAudioRecorder } from "../hooks/useAudioRecorder";

type Phase = "pick" | "fill" | "preview";

interface FormsPanelProps {
  apiOnline: boolean | null;
}

function speakKannadaPrompt(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "kn-IN";
  const voices = window.speechSynthesis.getVoices();
  const kn = voices.find((v) => v.lang.toLowerCase().startsWith("kn"));
  if (kn) utter.voice = kn;
  window.speechSynthesis.speak(utter);
}

function isSkipPhrase(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/\s+/g, "");
  return (
    t.includes("ಬಿಟ್ಟುಬಿಡಿ") ||
    t.includes("ಬಿಟ್ಟುಬಿಡು") ||
    t === "skip" ||
    t === "none" ||
    t === "na" ||
    t === "n/a"
  );
}

function todayDateString(): string {
  return new Date().toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function autoFilledValues(form: BankForm): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of form.fields) {
    if (field.auto === "today" || (field.type === "date" && field.id === "date")) {
      values[field.id] = todayDateString();
    }
  }
  return values;
}

function askableFields(form: BankForm) {
  return form.fields.filter(
    (f) => !f.auto && !(f.type === "date" && f.id === "date"),
  );
}

export function FormsPanel({ apiOnline }: FormsPanelProps) {
  const { state: recorderState, error: recorderError, startRecording, stopRecording } =
    useAudioRecorder();

  const [catalog, setCatalog] = useState<FormCatalog | null>(null);
  const [form, setForm] = useState<BankForm | null>(null);
  const [phase, setPhase] = useState<Phase>("pick");
  const [fieldIndex, setFieldIndex] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState("");
  const [rawHeard, setRawHeard] = useState("");
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;

    const load = () => {
      fetchFormCatalog()
        .then((data) => {
          if (cancelled) return;
          setCatalog(data);
          setLoadError(null);
        })
        .catch((err) => {
          if (cancelled) return;
          if (attempts < 8) {
            attempts += 1;
            window.setTimeout(load, 1500);
            return;
          }
          setLoadError(err instanceof Error ? err.message : "Could not load forms");
        });
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const askFields = form ? askableFields(form) : [];
  const currentField = askFields[fieldIndex] ?? null;

  useEffect(() => {
    if (phase === "fill" && currentField?.prompt_kn && !awaitingConfirm && !busy) {
      speakKannadaPrompt(currentField.prompt_kn);
    }
  }, [phase, fieldIndex, currentField?.id, awaitingConfirm, busy]);

  const handlePickForm = useCallback(async (formId: string) => {
    setError(null);
    setLoadError(null);
    setBusy(true);
    try {
      const detail = await fetchForm(formId);
      setForm(detail);
      setValues(autoFilledValues(detail));
      setDraft("");
      setRawHeard("");
      setFieldIndex(0);
      setAwaitingConfirm(false);
      setPhase("fill");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open form");
    } finally {
      setBusy(false);
    }
  }, []);

  const handleStart = useCallback(async () => {
    setError(null);
    await startRecording();
  }, [startRecording]);

  const handleStop = useCallback(async () => {
    if (!currentField) return;
    const blob = await stopRecording();
    if (!blob) {
      setError("Recording was empty. Please try again.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ext = blob.type.includes("ogg") ? "ogg" : "webm";
      const text = await transcribeFormAudio(blob, `field.${ext}`);
      if (!text) {
        setError("Could not hear speech. Please try again.");
        return;
      }
      if (!currentField.required && isSkipPhrase(text)) {
        setRawHeard(text);
        setDraft("");
        setAwaitingConfirm(true);
        return;
      }
      setRawHeard(text);
      setDraft(normalizeFormValue(text, currentField.type, currentField.id));
      setAwaitingConfirm(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transcription failed");
    } finally {
      setBusy(false);
    }
  }, [currentField, stopRecording]);

  const commitField = useCallback(
    (value: string) => {
      if (!form || !currentField) return;
      const askable = askableFields(form);
      const nextValues = {
        ...autoFilledValues(form),
        ...values,
        [currentField.id]: value,
      };
      setValues(nextValues);
      setDraft("");
      setRawHeard("");
      setAwaitingConfirm(false);

      if (fieldIndex >= askable.length - 1) {
        setPhase("preview");
        return;
      }
      setFieldIndex((i) => i + 1);
    },
    [form, currentField, values, fieldIndex],
  );

  const handleConfirm = useCallback(() => {
    if (!currentField) return;
    const normalized = normalizeFormValue(draft, currentField.type, currentField.id);
    if (currentField.required && !normalized.trim()) {
      setError("This field is required.");
      return;
    }
    // Optional skip phrases left in the box after STT
    if (!currentField.required && isSkipPhrase(draft)) {
      setError(null);
      commitField("");
      return;
    }
    setError(null);
    setDraft(normalized);
    commitField(normalized.trim());
  }, [currentField, draft, commitField]);

  const handleReRecord = useCallback(() => {
    setAwaitingConfirm(false);
    setDraft("");
    setRawHeard("");
    setError(null);
  }, []);

  const handleBackField = useCallback(() => {
    if (fieldIndex <= 0) {
      setPhase("pick");
      setForm(null);
      return;
    }
    setAwaitingConfirm(false);
    setDraft("");
    setError(null);
    setFieldIndex((i) => i - 1);
  }, [fieldIndex]);

  const handleStartOver = useCallback(() => {
    setPhase("pick");
    setForm(null);
    setValues({});
    setDraft("");
    setFieldIndex(0);
    setAwaitingConfirm(false);
    setError(null);
  }, []);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  if (loadError) {
    return (
      <div className="panel error-panel">
        <h2>Forms unavailable</h2>
        <p>{loadError}</p>
      </div>
    );
  }

  if (phase === "pick") {
    return (
      <div className="forms-panel">
        <header className="forms-header">
          <h1>ಅರ್ಜಿಗಳು · Forms</h1>
          <p className="subtitle">
            Choose a form in Kannada. Speak each answer one by one. Preview, then print.
          </p>
        </header>

        <div className="form-pick-grid">
          {(catalog?.forms ?? []).map((item) => (
            <button
              key={item.id}
              type="button"
              className="form-pick-card"
              disabled={busy || apiOnline === false}
              onClick={() => handlePickForm(item.id)}
            >
              <p className="form-pick-title">{item.title_kn}</p>
              <p className="form-pick-en">{item.title_en}</p>
              <p className="form-pick-desc">{item.description_kn}</p>
              <p className="form-pick-meta">{item.field_count} fields</p>
            </button>
          ))}
        </div>

        {error && <p className="api-warning">{error}</p>}
      </div>
    );
  }

  if (phase === "fill" && form && currentField) {
    const step = fieldIndex + 1;
    const total = askFields.length;
    const progress = (step / total) * 100;

    return (
      <div className="forms-panel">
        <header className="forms-header">
          <button type="button" className="text-btn" onClick={handleBackField}>
            ← Back
          </button>
          <h1>{form.title_kn}</h1>
          <p className="subtitle">{form.title_en}</p>
          <div className="form-progress" aria-label={`Step ${step} of ${total}`}>
            <div className="form-progress-bar" style={{ width: `${progress}%` }} />
          </div>
          <p className="form-step-label">
            {step} / {total} · {currentField.label_kn}
          </p>
        </header>

        <section className="form-wizard panel">
          <p className="form-prompt">{currentField.prompt_kn}</p>
          <p className="muted form-prompt-en">{currentField.label_en}</p>

          {!awaitingConfirm && (
            <>
              <RecordButton
                recorderState={recorderState}
                disabled={busy || apiOnline === false}
                onStart={handleStart}
                onStop={handleStop}
              />
              {recorderState === "recording" && (
                <p className="recording-hint">Recording… click Stop when finished.</p>
              )}
              {busy && <p className="recording-hint">Transcribing…</p>}
            </>
          )}

          {awaitingConfirm && (
            <div className="form-confirm">
              {rawHeard && (
                <p className="form-raw-heard muted">
                  Heard in Kannada: <strong>{rawHeard}</strong>
                </p>
              )}
              <label className="form-field-label" htmlFor="form-draft">
                Form value (English)
              </label>
              <input
                id="form-draft"
                className="form-draft-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={currentField.required ? "" : "(optional — leave empty to skip)"}
              />
              <div className="form-confirm-actions">
                <button type="button" className="primary-btn" onClick={handleConfirm}>
                  Confirm · ದೃಢೀಕರಿಸಿ
                </button>
                <button type="button" className="secondary-btn" onClick={handleReRecord}>
                  Re-record · ಮರುಹೇಳಿ
                </button>
              </div>
            </div>
          )}

          {(error || recorderError) && (
            <p className="api-warning">{error ?? recorderError}</p>
          )}
        </section>

        {Object.keys(values).length > 0 && (
          <aside className="form-filled-so-far">
            <h2>Filled so far</h2>
            <ul>
              {form.fields
                .filter((f) => values[f.id] !== undefined)
                .map((f) => (
                  <li key={f.id}>
                    <span>{f.label_en}</span>
                    <strong>{values[f.id] || "—"}</strong>
                  </li>
                ))}
            </ul>
          </aside>
        )}
      </div>
    );
  }

  if (phase === "preview" && form) {
    return (
      <div className="forms-panel">
        <header className="forms-header no-print">
          <h1>Preview</h1>
          <p className="subtitle">Check the filled form, then print or save as PDF.</p>
          <div className="form-preview-actions">
            <button type="button" className="primary-btn" onClick={handlePrint}>
              Print
            </button>
            <button type="button" className="secondary-btn" onClick={handleStartOver}>
              New form
            </button>
          </div>
        </header>

        <article className="bank-form-sheet" id="bank-form-print">
          <div className="bank-form-sheet-header">
            <p className="bank-form-bank">Banking Services</p>
            <h2>{form.title_en}</h2>
          </div>

          <dl className="bank-form-fields">
            {form.fields.map((f) => (
              <div key={f.id} className="bank-form-row">
                <dt>{f.label_en}</dt>
                <dd>{values[f.id]?.trim() ? values[f.id] : "—"}</dd>
              </div>
            ))}
          </dl>

          <div className="bank-form-sign">
            <div>
              <p>Applicant signature</p>
              <div className="sign-line" />
            </div>
            <div>
              <p>Date</p>
              <div className="sign-line">{values.date || ""}</div>
            </div>
          </div>
        </article>
      </div>
    );
  }

  return null;
}
