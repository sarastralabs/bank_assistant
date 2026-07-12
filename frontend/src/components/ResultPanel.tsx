import { useEffect, useRef } from "react";
import { base64ToAudioUrl, type PipelineResult } from "../api/client";

interface ResultPanelProps {
  result: PipelineResult;
  onAskAnother: () => void;
  onViewHistory?: () => void;
}

export function ResultPanel({ result, onAskAnother, onViewHistory }: ResultPanelProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!result.audio_b64) return;

    const url = base64ToAudioUrl(result.audio_b64);
    audioUrlRef.current = url;

    const audio = audioRef.current;
    if (audio) {
      audio.src = url;
      audio.play().catch(() => {
        // Autoplay may be blocked; user can press play manually.
      });
    }

    return () => {
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
    };
  }, [result.audio_b64]);

  const confidencePct = Math.round(result.confidence * 100);
  const times = result.stage_times;

  return (
    <div className="panel result-panel">
      <h2>Response</h2>

      <div className="result-block">
        <h3>You said (Kannada)</h3>
        <p className="kannada-text">{result.kannada_text || "(empty)"}</p>
      </div>

      <div className="result-block">
        <h3>Translation (English)</h3>
        <p>{result.english_text || "(empty)"}</p>
      </div>

      <div className="result-meta">
        <span className="badge intent-badge">{result.intent}</span>
        <span className="badge">{confidencePct}% confidence</span>
        <span className="badge route-badge">{result.route}</span>
      </div>

      <div className="result-block">
        <h3>Guidance (English)</h3>
        <p className="response-text">{result.response_text}</p>
        <p className="muted result-note">
          How-to information only — not your live account data.
        </p>
      </div>

      {result.audio_b64 && (
        <div className="result-block">
          <h3>Kannada Voice Response</h3>
          <audio ref={audioRef} controls className="audio-player" />
        </div>
      )}

      <p className="timings muted">
        STT {times.stt ?? "?"}s · Translation {times.translation ?? "?"}s · NLU{" "}
        {times.nlu_router ?? "?"}s · TTS {times.tts ?? "?"}s · Total {result.total_time_s}s
      </p>

      <div className="result-actions">
        <button type="button" className="secondary-btn" onClick={onAskAnother}>
          Ask another question
        </button>
        {onViewHistory && (
          <button type="button" className="ghost-btn" onClick={onViewHistory}>
            View in History
          </button>
        )}
      </div>
    </div>
  );
}
