import { useCallback, useEffect, useRef, useState } from "react";
import { RecordButton } from "./RecordButton";
import { PipelineProgress } from "./PipelineProgress";
import { ResultPanel } from "./ResultPanel";
import { HistoryPanel } from "./HistoryPanel";
import { FormsPanel } from "./FormsPanel";
import { useAudioRecorder } from "../hooks/useAudioRecorder";
import { usePipeline } from "../hooks/usePipeline";

type AppView = "idle" | "recording" | "processing" | "result" | "error";
type DeskTab = "assist" | "forms" | "history";

interface DeskWorkbenchProps {
  apiOnline: boolean | null;
  initialTab?: DeskTab;
  /** Compact chrome for lobby agent conversation. */
  lobbyMode?: boolean;
  showHistoryTab?: boolean;
  onTabChange?: (tab: DeskTab) => void;
}

export function DeskWorkbench({
  apiOnline,
  initialTab = "assist",
  lobbyMode = false,
  showHistoryTab = !lobbyMode,
  onTabChange,
}: DeskWorkbenchProps) {
  const { state: recorderState, error: recorderError, startRecording, stopRecording } =
    useAudioRecorder();
  const { pipelineState, result, error: pipelineError, runPipeline, reset } = usePipeline();
  const [localError, setLocalError] = useState<string | null>(null);
  const [tab, setTab] = useState<DeskTab>(initialTab);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [pendingFormId, setPendingFormId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

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
  const isBusy = view === "processing";

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

  const handleFillForm = useCallback((formId: string) => {
    setPendingFormId(formId);
    setTab("forms");
    onTabChange?.("forms");
  }, [onTabChange]);

  const selectTab = useCallback((next: DeskTab) => {
    setTab(next);
    onTabChange?.(next);
  }, [onTabChange]);

  return (
    <div className={`desk-workbench ${lobbyMode ? "desk-lobby" : ""}`}>
      {!lobbyMode && (
        <nav className="desk-tabs" aria-label="Desk tools">
          <button
            type="button"
            className={tab === "assist" ? "active" : ""}
            onClick={() => selectTab("assist")}
          >
            Assist
          </button>
          <button
            type="button"
            className={tab === "forms" ? "active" : ""}
            onClick={() => selectTab("forms")}
          >
            Forms
          </button>
          {showHistoryTab && (
            <button
              type="button"
              className={tab === "history" ? "active" : ""}
              onClick={() => selectTab("history")}
            >
              History
            </button>
          )}
        </nav>
      )}

      {tab === "assist" && (
        <>
          {!lobbyMode && (
            <header className="header">
              <h1>Ask how to bank — in Kannada</h1>
              <p className="subtitle">
                Record a question and get spoken guidance on banking tasks.
              </p>
            </header>
          )}
          {lobbyMode && (
            <p className="lobby-assist-hint">
              ಕನ್ನಡದಲ್ಲಿ ನಿಮ್ಮ ಪ್ರಶ್ನೆ ಹೇಳಿ. ಅರ್ಜಿಗಾಗಿ <strong>ಅರ್ಜಿ · Form</strong> ಆಯ್ಕೆ ಮಾಡಿ.
            </p>
          )}

          <div className="main">
            {(view === "idle" || view === "recording") && (
              <section className="input-section">
                <RecordButton
                  recorderState={recorderState}
                  disabled={isBusy || apiOnline === false}
                  onStart={handleStartRecording}
                  onStop={handleStopRecording}
                />
                {!lobbyMode && (
                  <>
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
                  </>
                )}
                {view === "recording" && (
                  <p className="recording-hint">Recording… click Stop when finished.</p>
                )}
              </section>
            )}

            {view === "processing" && <PipelineProgress />}

            {view === "result" && result && (
              <ResultPanel
                result={result}
                onAskAnother={handleAskAnother}
                onViewHistory={
                  showHistoryTab ? () => setTab("history") : undefined
                }
                onFillForm={handleFillForm}
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
          </div>
        </>
      )}

      {tab === "forms" && (
        <div className="main">
          <FormsPanel
            apiOnline={apiOnline}
            initialFormId={pendingFormId}
            onConsumedInitialForm={() => setPendingFormId(null)}
          />
        </div>
      )}

      {tab === "history" && showHistoryTab && (
        <div className="main">
          <HistoryPanel refreshKey={historyRefresh} />
        </div>
      )}
    </div>
  );
}
