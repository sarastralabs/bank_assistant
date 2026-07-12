import { useCallback, useState } from "react";
import { processAudio, type PipelineResult } from "../api/client";

export type PipelineState = "idle" | "processing" | "result" | "error";

interface UsePipelineResult {
  pipelineState: PipelineState;
  result: PipelineResult | null;
  error: string | null;
  runPipeline: (audioBlob: Blob, filename?: string) => Promise<void>;
  reset: () => void;
}

export function usePipeline(): UsePipelineResult {
  const [pipelineState, setPipelineState] = useState<PipelineState>("idle");
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runPipeline = useCallback(async (audioBlob: Blob, filename = "recording.webm") => {
    setPipelineState("processing");
    setError(null);
    setResult(null);

    try {
      const data = await processAudio(audioBlob, filename);
      if (data.error) {
        setError(data.error);
        setPipelineState("error");
        return;
      }
      setResult(data);
      setPipelineState("result");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pipeline request failed");
      setPipelineState("error");
    }
  }, []);

  const reset = useCallback(() => {
    setPipelineState("idle");
    setResult(null);
    setError(null);
  }, []);

  return { pipelineState, result, error, runPipeline, reset };
}
