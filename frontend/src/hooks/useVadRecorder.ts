import { useCallback, useRef, useState } from "react";

export type VadListenState =
  | "idle"
  | "listening"
  | "speech"
  | "processing_local"
  | "error";

export interface VadListenOptions {
  /** Silence after speech before cutting the turn (ms). */
  silenceMs?: number;
  /** Minimum speech duration to accept (ms). */
  minSpeechMs?: number;
  /** Max wait for user to start speaking (ms). */
  maxWaitMs?: number;
  /** Max utterance length (ms). */
  maxUtteranceMs?: number;
  /** RMS threshold 0–1-ish (Analyser average / 255). */
  speechThreshold?: number;
}

const DEFAULTS: Required<VadListenOptions> = {
  // Shorter end-of-speech wait → snappier turn-taking (was 1200)
  silenceMs: 700,
  minSpeechMs: 350,
  maxWaitMs: 25000,
  maxUtteranceMs: 18000,
  speechThreshold: 0.045,
};

function pickMimeType(): string | undefined {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

function rmsFromAnalyser(analyser: AnalyserNode, buf: Uint8Array): number {
  analyser.getByteTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / buf.length);
}

/**
 * Energy-based VAD: wait for speech → record until silence → return blob.
 * Reuses one mic MediaStream across turns to avoid getUserMedia delay.
 */
export function useVadRecorder() {
  const [state, setState] = useState<VadListenState>("idle");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const sharedStreamRef = useRef<MediaStream | null>(null);

  const releaseMic = useCallback(() => {
    sharedStreamRef.current?.getTracks().forEach((t) => t.stop());
    sharedStreamRef.current = null;
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    cleanupRef.current?.();
    cleanupRef.current = null;
    setState("idle");
  }, []);

  const listenOnce = useCallback(
    async (opts: VadListenOptions = {}): Promise<Blob | null> => {
      const cfg = { ...DEFAULTS, ...opts };
      abort();
      setError(null);

      const ac = new AbortController();
      abortRef.current = ac;

      let audioCtx: AudioContext | null = null;
      let recorder: MediaRecorder | null = null;
      let raf = 0;

      const cleanup = () => {
        if (raf) cancelAnimationFrame(raf);
        try {
          if (recorder && recorder.state !== "inactive") recorder.stop();
        } catch {
          // ignore
        }
        void audioCtx?.close().catch(() => undefined);
        cleanupRef.current = null;
      };
      cleanupRef.current = cleanup;

      try {
        let stream = sharedStreamRef.current;
        if (!stream || !stream.getAudioTracks().some((t) => t.readyState === "live")) {
          sharedStreamRef.current?.getTracks().forEach((t) => t.stop());
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
          sharedStreamRef.current = stream;
        }
        if (ac.signal.aborted) {
          cleanup();
          return null;
        }

        audioCtx = new AudioContext();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        const timeBuf = new Uint8Array(analyser.fftSize);

        const chunks: Blob[] = [];
        const mimeType = pickMimeType();
        recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };
        recorder.start(200);
        setState("listening");

        const startedAt = performance.now();
        let speechStartedAt: number | null = null;
        let lastLoudAt: number | null = null;
        let speaking = false;

        const blob = await new Promise<Blob | null>((resolve) => {
          const tick = () => {
            if (ac.signal.aborted) {
              resolve(null);
              return;
            }
            const now = performance.now();
            const level = rmsFromAnalyser(analyser, timeBuf);
            const loud = level >= cfg.speechThreshold;

            if (!speaking) {
              if (loud) {
                speaking = true;
                speechStartedAt = now;
                lastLoudAt = now;
                setState("speech");
              } else if (now - startedAt > cfg.maxWaitMs) {
                if (recorder && recorder.state !== "inactive") {
                  recorder.onstop = () => resolve(null);
                  recorder.stop();
                } else {
                  resolve(null);
                }
                return;
              }
            } else {
              if (loud) lastLoudAt = now;
              const speechMs = now - (speechStartedAt ?? now);
              const silenceMs = now - (lastLoudAt ?? now);
              const hitMax = speechMs >= cfg.maxUtteranceMs;
              const hitEnd =
                speechMs >= cfg.minSpeechMs && silenceMs >= cfg.silenceMs;
              if (hitMax || hitEnd) {
                setState("processing_local");
                if (recorder && recorder.state !== "inactive") {
                  recorder.onstop = () => {
                    const type = recorder?.mimeType || "audio/webm";
                    const out = new Blob(chunks, { type });
                    resolve(out.size > 0 ? out : null);
                  };
                  recorder.stop();
                } else {
                  resolve(null);
                }
                return;
              }
            }
            raf = requestAnimationFrame(tick);
          };
          raf = requestAnimationFrame(tick);
        });

        cleanup();
        if (ac.signal.aborted) {
          setState("idle");
          return null;
        }
        setState("idle");
        return blob;
      } catch (err) {
        cleanup();
        releaseMic();
        if (ac.signal.aborted) {
          setState("idle");
          return null;
        }
        const message =
          err instanceof DOMException && err.name === "NotAllowedError"
            ? "Microphone permission denied"
            : err instanceof Error
              ? err.message
              : "Microphone error";
        setError(message);
        setState("error");
        return null;
      } finally {
        if (abortRef.current === ac) abortRef.current = null;
      }
    },
    [abort, releaseMic],
  );

  return { state, error, listenOnce, abort, releaseMic };
}
