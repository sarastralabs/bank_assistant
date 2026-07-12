import { useEffect, useState } from "react";

const STAGES = ["STT", "Translation", "NLU", "TTS"];

export function PipelineProgress() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="panel processing-panel">
      <div className="spinner" aria-hidden="true" />
      <h2>Processing your query</h2>
      <p className="muted">This usually takes 10–25 seconds on first run.</p>
      <div className="stage-list">
        {STAGES.map((stage, i) => (
          <span key={stage} className="stage-chip">
            {stage}
            {i < STAGES.length - 1 && <span className="stage-arrow">→</span>}
          </span>
        ))}
      </div>
      <p className="elapsed">Elapsed: {elapsed}s</p>
    </div>
  );
}
