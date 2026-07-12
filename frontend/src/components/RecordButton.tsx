import type { RecorderState } from "../hooks/useAudioRecorder";

interface RecordButtonProps {
  recorderState: RecorderState;
  disabled?: boolean;
  onStart: () => void;
  onStop: () => void;
}

export function RecordButton({ recorderState, disabled, onStart, onStop }: RecordButtonProps) {
  const isRecording = recorderState === "recording";

  return (
    <button
      type="button"
      className={`record-btn ${isRecording ? "recording" : ""}`}
      disabled={disabled}
      onClick={isRecording ? onStop : onStart}
      aria-label={isRecording ? "Stop recording" : "Start recording"}
    >
      <span className="record-btn-icon">{isRecording ? "■" : "🎙"}</span>
      <span className="record-btn-label">{isRecording ? "Stop Recording" : "Record"}</span>
    </button>
  );
}
