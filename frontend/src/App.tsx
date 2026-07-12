import { useCallback, useEffect, useRef, useState } from "react";
import { checkHealth } from "./api/client";
import { RecordButton } from "./components/RecordButton";
import { PipelineProgress } from "./components/PipelineProgress";
import { ResultPanel } from "./components/ResultPanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { LandingPage } from "./components/LandingPage";
import { useAudioRecorder } from "./hooks/useAudioRecorder";
import { usePipeline } from "./hooks/usePipeline";

type AppView = "idle" | "recording" | "processing" | "result" | "error";
type Tab = "home" | "assist" | "history";

export default function App() {
  const { state: recorderState, error: recorderError, startRecording, stopRecording } =
    useAudioRecorder();
  const { pipelineState, result, error: pipelineError, runPipeline, reset } = usePipeline();
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    checkHealth().then(setApiOnline);
  }, []);

  useEffect(() => {
    if (pipelineState === "result") {
      setHistoryRefresh((n) => n + 1);
    }
  }, [pipelineState]);

  const view: AppView =
    pipelineState === "processing"
      ? "processing"
      : pipelineState === "result"
        ? "result"
        : pipelineState === "error"
          ? "error"
          : recorderState === "recording"
            ? "recording"
            : "idle";

  const displayError = localError ?? pipelineError ?? recorderError;

  const handleStartRecording = useCallback(async () => {
    setLocalError(null);
    setTab("assist");
    await startRecording();
  }, [startRecording]);

  const handleStopRecording = useCallback(async () => {
    const blob = await stopRecording();
    if (!blob) {
      setLocalError("Recording was empty. Please try again.");
      return;
    }
    const ext = blob.type.includes("ogg") ? "ogg" : "webm";
    await runPipeline(blob, `recording.${ext}`);
  }, [stopRecording, runPipeline]);

  const handleFileUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;

      setLocalError(null);
      setTab("assist");
      reset();
      await runPipeline(file, file.name);
    },
    [runPipeline, reset],
  );

  const handleAskAnother = useCallback(() => {
    setLocalError(null);
    reset();
  }, [reset]);

  const isBusy = view === "processing";

  return (
    <div className="app-shell">
      <header className="topbar">
        <button type="button" className="brand brand-btn" onClick={() => setTab("home")}>
          <span className="brand-mark">KB</span>
          <div>
            <p className="brand-name">Kannada Voice Banking</p>
            <p className="brand-tag">How-to guidance · Not live banking</p>
          </div>
        </button>
        <nav className="tabs" aria-label="Main">
          <button
            type="button"
            className={`tab ${tab === "home" ? "active" : ""}`}
            onClick={() => setTab("home")}
          >
            Home
          </button>
          <button
            type="button"
            className={`tab ${tab === "assist" ? "active" : ""}`}
            onClick={() => setTab("assist")}
          >
            Assist
          </button>
          <button
            type="button"
            className={`tab ${tab === "history" ? "active" : ""}`}
            onClick={() => setTab("history")}
          >
            History
          </button>
        </nav>
      </header>

      <div className={`app ${tab === "home" ? "app-wide" : ""}`}>
        {apiOnline === false && (
          <p className="api-warning">API offline — start the backend with uvicorn on port 8000.</p>
        )}

        {tab === "home" && (
          <main className="main">
            <LandingPage
              refreshKey={historyRefresh}
              onStartAssist={() => setTab("assist")}
              onOpenHistory={() => setTab("history")}
            />
          </main>
        )}

        {tab === "assist" && (
          <>
            <header className="header">
              <h1>Ask how to bank — in Kannada</h1>
              <p className="subtitle">
                Record a question and get spoken guidance on what to do next (branch, ATM, forms).
                We do not fetch your real balance or any personal bank details.
              </p>
              <p className="info-banner">
                Informational only — no live account access.
              </p>
            </header>

            <main className="main">
              {(view === "idle" || view === "recording") && (
                <section className="input-section">
                  <RecordButton
                    recorderState={recorderState}
                    disabled={isBusy || apiOnline === false}
                    onStart={handleStartRecording}
                    onStop={handleStopRecording}
                  />

                  <div className="divider">
                    <span>or</span>
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".wav,.ogg,.webm,audio/*"
                    className="file-input-hidden"
                    onChange={handleFileUpload}
                    disabled={isBusy || apiOnline === false}
                  />
                  <button
                    type="button"
                    className="secondary-btn upload-btn"
                    disabled={isBusy || apiOnline === false}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Upload audio file
                  </button>

                  {view === "recording" && (
                    <p className="recording-hint">Recording… click Stop when finished speaking.</p>
                  )}
                </section>
              )}

              {view === "processing" && <PipelineProgress />}

              {view === "result" && result && (
                <ResultPanel
                  result={result}
                  onAskAnother={handleAskAnother}
                  onViewHistory={() => setTab("history")}
                />
              )}

              {view === "error" && (
                <div className="panel error-panel">
                  <h2>Something went wrong</h2>
                  <p>{displayError ?? "An unknown error occurred."}</p>
                  <button type="button" className="secondary-btn" onClick={handleAskAnother}>
                    Try again
                  </button>
                </div>
              )}
            </main>
          </>
        )}

        {tab === "history" && (
          <main className="main">
            <HistoryPanel refreshKey={historyRefresh} />
          </main>
        )}
      </div>
    </div>
  );
}
