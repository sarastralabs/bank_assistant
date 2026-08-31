import { useEffect, useRef, useState } from "react";
import {
  fetchForm,
  fillFormFieldAudio,
  normalizeFormValue,
  processAudio,
  type BankForm,
  type PipelineResult,
} from "../api/client";
import { useVadRecorder } from "../hooks/useVadRecorder";
import { playBase64Wav, speakKannadaBrowser, unlockAudio } from "../utils/playAudio";
import {
  isEndSessionCommand,
  isRejectCommand,
  isSkipCommand,
} from "../utils/voiceCommands";

export type HandsFreeTurn =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "form_prompt"
  | "form_confirm"
  | "form_preview";

interface HandsFreeConversationProps {
  active: boolean;
  apiOnline: boolean | null;
  onRequestEnd: (reason: string) => void;
  onTurnChange?: (turn: HandsFreeTurn) => void;
}

type Mode = "assist" | "form";

interface FormSession {
  form: BankForm;
  fieldIndex: number;
  values: Record<string, string>;
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
  return form.fields.filter((f) => !f.auto && !(f.type === "date" && f.id === "date"));
}

function statusLabel(turn: HandsFreeTurn, mode: Mode): string {
  switch (turn) {
    case "listening":
      return mode === "form"
        ? "ಕೇಳುತ್ತಿದ್ದೇನೆ… · Listening for your answer"
        : "ಕೇಳುತ್ತಿದ್ದೇನೆ… · Listening — speak in Kannada";
    case "thinking":
      return "ಯೋಚಿಸುತ್ತಿದ್ದೇನೆ… · Processing";
    case "speaking":
      return "ಉತ್ತರಿಸುತ್ತಿದ್ದೇನೆ… · Speaking";
    case "form_prompt":
      return "ಪ್ರಶ್ನೆ… · Asking next field";
    case "form_confirm":
      return "ದೃಢೀಕರಿಸಿ — ಸರಿ ಅಥವಾ ಮತ್ತೆ ಹೇಳಿ";
    case "form_preview":
      return "ಅರ್ಜಿ ಸಿದ್ಧ · Form ready to print";
    default:
      return "ಸಿದ್ಧ";
  }
}

export function HandsFreeConversation({
  active,
  apiOnline,
  onRequestEnd,
  onTurnChange,
}: HandsFreeConversationProps) {
  const { state: vadState, error: vadError, micLevel, listenOnce, abort, warmupMic } =
    useVadRecorder();

  const [turn, setTurn] = useState<HandsFreeTurn>("idle");
  const [mode, setMode] = useState<Mode>("assist");
  const [lastResult, setLastResult] = useState<PipelineResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [rawHeard, setRawHeard] = useState("");
  const [englishHeard, setEnglishHeard] = useState("");
  const [formSession, setFormSession] = useState<FormSession | null>(null);

  const onEndRef = useRef(onRequestEnd);
  onEndRef.current = onRequestEnd;
  const onTurnRef = useRef(onTurnChange);
  onTurnRef.current = onTurnChange;
  const playAbortRef = useRef<AbortController | null>(null);
  const listenOnceRef = useRef(listenOnce);
  listenOnceRef.current = listenOnce;
  const warmupMicRef = useRef(warmupMic);
  warmupMicRef.current = warmupMic;

  useEffect(() => {
    if (!active || apiOnline === false) {
      abort();
      playAbortRef.current?.abort();
      window.speechSynthesis?.cancel();
      setTurn("idle");
      return;
    }

    let cancelled = false;
    let session: FormSession | null = null;

    const still = () => !cancelled && active;

    const run = async () => {
      await unlockAudio();
      const micOk = await warmupMicRef.current();
      if (!micOk || !still()) return;

    const setSession = (next: FormSession | null) => {
      session = next;
      setFormSession(next);
    };

    const playReply = async (audioB64: string) => {
      playAbortRef.current?.abort();
      const ac = new AbortController();
      playAbortRef.current = ac;
      setTurn("speaking");
      try {
        await playBase64Wav(audioB64, ac.signal);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    };

    const runFormLoop = async () => {
      while (still()) {
        if (!session) return;

        const fields = askableFields(session.form);
        if (session.fieldIndex >= fields.length) {
          setTurn("form_preview");
          setHint("ಅರ್ಜಿ ಸಿದ್ಧ. ಪ್ರಿಂಟ್ ಮಾಡಬಹುದು.");
          await speakKannadaBrowser(
            "ಅರ್ಜಿ ಸಿದ್ಧ. ಪ್ರಿಂಟ್ ಮಾಡಬಹುದು. ಮುಗಿಸು ಅಥವಾ ಮುಂದುವರಿಸಿ.",
          );
          if (!still()) return;

          setTurn("listening");
          const blob = await listenOnceRef.current();
          if (!still()) return;
          if (blob) {
            try {
              setTurn("thinking");
              const ext = blob.type.includes("ogg") ? "ogg" : "webm";
              const result = await processAudio(blob, `lobby.${ext}`);
              if (isEndSessionCommand(result.kannada_text, result.english_text)) {
                onEndRef.current("Customer ended after form");
                return;
              }
            } catch {
              // return to assist
            }
          }
          return;
        }

        const field = fields[session.fieldIndex];
        setDraft("");
        setRawHeard("");
        setEnglishHeard("");
        setTurn("form_prompt");
        if (field.prompt_kn) {
          await speakKannadaBrowser(field.prompt_kn);
        }
        if (!still()) return;

        setTurn("listening");
        const blob = await listenOnceRef.current();
        if (!still()) return;
        if (!blob) continue;

        setTurn("thinking");
        try {
          const ext = blob.type.includes("ogg") ? "ogg" : "webm";
          const filled = await fillFormFieldAudio(blob, field.type, field.id, `field.${ext}`);
          if (!still()) return;

          const skipSource = `${filled.kannada_text} ${filled.english_text} ${filled.value}`;
          if (isEndSessionCommand(filled.kannada_text, filled.english_text)) {
            onEndRef.current("Customer ended during form");
            return;
          }

          if (!field.required && isSkipCommand(skipSource)) {
            session = {
              ...session,
              fieldIndex: session.fieldIndex + 1,
              values: { ...session.values, [field.id]: "" },
            };
            setSession(session);
            continue;
          }

          const value = filled.value || filled.english_text;
          setRawHeard(filled.kannada_text);
          setEnglishHeard(filled.english_text);
          setDraft(value);
          setTurn("form_confirm");

          await speakKannadaBrowser(
            value ? `${value}. ಸರಿಯೇ? ಸರಿ ಅಥವಾ ಮತ್ತೆ ಹೇಳಿ.` : "ಸರಿಯೇ? ಸರಿ ಅಥವಾ ಮತ್ತೆ ಹೇಳಿ.",
          );
          if (!still()) return;

          setTurn("listening");
          const confirmBlob = await listenOnceRef.current();
          if (!still()) return;
          if (!confirmBlob) continue;

          setTurn("thinking");
          const confirmFill = await fillFormFieldAudio(
            confirmBlob,
            "text",
            "confirm",
            `confirm.${ext}`,
          );
          if (!still()) return;

          const parts = [
            confirmFill.kannada_text,
            confirmFill.english_text,
            confirmFill.value,
          ];
          if (isEndSessionCommand(...parts)) {
            onEndRef.current("Customer ended during confirm");
            return;
          }
          if (isRejectCommand(...parts)) {
            continue;
          }

          const finalValue = normalizeFormValue(value, field.type, field.id) || value;
          if (field.required && !finalValue.trim()) {
            setError("ಈ ಕ್ಷೇತ್ರ ಅಗತ್ಯ · Required field");
            continue;
          }

          session = {
            ...session,
            fieldIndex: session.fieldIndex + 1,
            values: { ...session.values, [field.id]: finalValue },
          };
          setSession(session);
          setDraft("");
          setRawHeard("");
          setEnglishHeard("");
        } catch (err) {
          if (!still()) return;
          setError(err instanceof Error ? err.message : "Form fill failed");
        }
      }
    };

    const runAssistLoop = async () => {
      setLastResult(null);
      setError(null);
      setSession(null);
      setMode("assist");

      while (still()) {
        setMode("assist");
        setError(null);
        setTurn("listening");
        setHint(null);

        const blob = await listenOnceRef.current();
        if (!still()) return;
        if (!blob) continue;

        setTurn("thinking");
        try {
          const ext = blob.type.includes("ogg") ? "ogg" : "webm";
          const result = await processAudio(blob, `lobby.${ext}`);
          if (!still()) return;

          if (result.error) {
            setError(result.error);
            continue;
          }

          setLastResult(result);

          if (isEndSessionCommand(result.kannada_text, result.english_text)) {
            onEndRef.current("Customer said goodbye");
            return;
          }

          if (result.audio_b64) {
            await playReply(result.audio_b64);
          }
          if (!still()) return;

          if (result.route === "transactional" && result.form_id) {
            try {
              const detail = await fetchForm(result.form_id);
              if (!still()) return;
              session = {
                form: detail,
                fieldIndex: 0,
                values: autoFilledValues(detail),
              };
              setSession(session);
              setMode("form");
              setHint(`ಅರ್ಜಿ: ${detail.title_kn}`);
              await runFormLoop();
              if (!still()) return;
              setSession(null);
              setMode("assist");
              setHint("ಮತ್ತೆ ಕೇಳಬಹುದು · Ask another question");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not open form");
            }
          }
        } catch (err) {
          if (!still()) return;
          setError(err instanceof Error ? err.message : "Pipeline failed");
        }
      }
    };

      await runAssistLoop();
    };

    void run();

    return () => {
      cancelled = true;
      abort();
      playAbortRef.current?.abort();
      window.speechSynthesis?.cancel();
    };
  }, [active, apiOnline, abort]);

  useEffect(() => {
    onTurnRef.current?.(turn);
  }, [turn]);

  const micPct = Math.min(100, Math.round(micLevel * 400));
  const form = formSession?.form ?? null;
  const fieldIndex = formSession?.fieldIndex ?? 0;
  const values = formSession?.values ?? {};
  const askFields = form ? askableFields(form) : [];
  const currentField = askFields[fieldIndex] ?? null;

  return (
    <div className="handsfree-panel">
      <div className={`handsfree-status turn-${turn}`} aria-live="polite">
        <span className="handsfree-pulse" aria-hidden />
        <p className="handsfree-status-text">{statusLabel(turn, mode)}</p>
        {hint && <p className="handsfree-hint">{hint}</p>}
        {vadState === "speech" && <p className="handsfree-hint">ಮಾತನಾಡುತ್ತಿದ್ದೀರಿ…</p>}
        {turn === "listening" && (
          <div className="handsfree-mic-meter" aria-hidden>
            <div className="handsfree-mic-fill" style={{ width: `${micPct}%` }} />
          </div>
        )}
      </div>

      {(error || vadError) && <p className="api-warning">{error ?? vadError}</p>}

      {mode === "assist" && lastResult && (
        <section className="handsfree-result panel">
          <p className="kannada-text">{lastResult.kannada_text || "—"}</p>
          <p className="muted">{lastResult.english_text}</p>
          <p className="response-text">{lastResult.response_text}</p>
          <div className="result-meta">
            <span className="badge intent-badge">{lastResult.intent}</span>
            <span className="badge route-badge">{lastResult.route}</span>
          </div>
          {lastResult.route === "transactional" && lastResult.form_id && (
            <p className="handsfree-hint">ಅರ್ಜಿ ತೆರೆಯಲಾಗುತ್ತಿದೆ… · Opening form</p>
          )}
        </section>
      )}

      {mode === "form" && form && (
        <section className="handsfree-form panel">
          <h2>{form.title_kn}</h2>
          <p className="muted">{form.title_en}</p>
          {turn !== "form_preview" && currentField && (
            <>
              <p className="form-step-label">
                {fieldIndex + 1} / {askFields.length} · {currentField.label_kn}
              </p>
              <p className="form-prompt">{currentField.prompt_kn}</p>
              {(rawHeard || draft) && (
                <div className="form-confirm">
                  {rawHeard && (
                    <p className="muted">
                      Heard: <strong>{rawHeard}</strong>
                    </p>
                  )}
                  {englishHeard && (
                    <p className="muted">
                      English: <strong>{englishHeard}</strong>
                    </p>
                  )}
                  <p>
                    Form value: <strong>{draft || "—"}</strong>
                  </p>
                </div>
              )}
            </>
          )}
          {turn === "form_preview" && (
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
              <div className="form-preview-actions no-print">
                <button type="button" className="primary-btn" onClick={() => window.print()}>
                  Print / Save PDF
                </button>
              </div>
            </article>
          )}
          {Object.keys(values).length > 0 && turn !== "form_preview" && (
            <aside className="form-filled-so-far">
              <h3>Filled so far</h3>
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
        </section>
      )}

      <p className="handsfree-footer muted">
        ಹಸ್ತರಹಿತ · Hands-free · ಹೇಳಿ &quot;ಮುಗಿಸು&quot; to end
      </p>
    </div>
  );
}
