import { useCallback, useRef, useState } from "react";
import { getSharedAudioContext } from "../utils/playAudio";

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
  /** Fired after mic/stream is ready, before VAD wait loop. */
  onMicReady?: () => void;
}

const DEFAULTS: Required<Omit<VadListenOptions, "onMicReady">> = {
  // Longer end-of-speech wait — 1500ms gives enough time to finish a Kannada sentence
  silenceMs: 1500,
  minSpeechMs: 400,
  maxWaitMs: 25000,
  maxUtteranceMs: 18000,
  // Very low threshold for quiet laptop mics — RMS values around 0.005 are normal
  speechThreshold: 0.004,
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
  const [micLevel, setMicLevel] = useState(0);
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
    releaseMic();
    setState("idle");
  }, [releaseMic]);

  /** Request mic once so the browser prompt appears before hands-free listening. */
  const warmupMic = useCallback(async (): Promise<boolean> => {
    setError(null);
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
      return true;
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone permission denied — allow mic for this site in the browser bar."
          : err instanceof Error
            ? err.message
            : "Microphone error";
      setError(message);
      setState("error");
      return false;
    }
  }, []);

  const listenOnce = useCallback(
    async (opts: VadListenOptions = {}): Promise<Blob | null> => {
      const cfg = { ...DEFAULTS, ...opts };
      abort();
      setError(null);

      const ac = new AbortController();
      abortRef.current = ac;

      let recorder: MediaRecorder | null = null;
      let raf = 0;

      const cleanup = () => {
        if (raf) cancelAnimationFrame(raf);
        try {
          if (recorder && recorder.state !== "inactive") recorder.stop();
        } catch {
          // ignore
        }
        setMicLevel(0);
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

        cfg.onMicReady?.();
        setState("listening");

        const audioCtx = await getSharedAudioContext();
        if (!audioCtx) {
          throw new Error("Audio not available — tap the screen once, then try again.");
        }
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

        const startedAt = performance.now();
        let speechStartedAt: number | null = null;
        let lastLoudAt: number | null = null;
        let speaking = false;
        // Track average noise during calibration (not max — max lets one spike ruin the threshold)
        let noiseFloorSum = 0;
        let noiseFloorSamples = 0;
        let noiseFloor = cfg.speechThreshold * 0.5;
        let calibrated = false;

        const blob = await new Promise<Blob | null>((resolve) => {
          const tick = () => {
            if (ac.signal.aborted) {
              resolve(null);
              return;
            }
            const now = performance.now();
            const level = rmsFromAnalyser(analyser, timeBuf);
            setMicLevel(level);

            // Calibrate noise floor over first 600ms using AVERAGE (not max)
            if (!calibrated && now - startedAt < 600) {
              noiseFloorSum += level;
              noiseFloorSamples += 1;
            } else if (!calibrated) {
              calibrated = true;
              const avgNoise = noiseFloorSamples > 0
                ? noiseFloorSum / noiseFloorSamples
                : 0;
              // Noise floor = avg background + small margin
              // Cap at 0.006 so quiet mics (RMS 0.005 when speaking) still trigger
              const computed = avgNoise * 1.2;
              noiseFloor = Math.min(
                Math.max(cfg.speechThreshold, computed),
                0.006   // hard cap — never block speech on quiet mics
              );
              console.log(`[VAD] calibrated: avgNoise=${avgNoise.toFixed(5)} computed=${computed.toFixed(5)} noiseFloor=${noiseFloor.toFixed(5)}`);
            }

            const threshold = calibrated
              ? noiseFloor
              : cfg.speechThreshold;

            // HYSTERESIS: use higher threshold to START speech, lower to SUSTAIN
            // This prevents ambient noise from keeping lastLoudAt alive after speech ends.
            // startThreshold: must be clearly above noise to trigger speech
            // sustainThreshold: once speaking, only update lastLoudAt if still clearly audible
            const startThreshold = threshold;
            const sustainThreshold = threshold * 2.5; // 2.5x — clearly above noise

            const loudToStart = level >= startThreshold;
            const loudToSustain = level >= sustainThreshold;

            if (!speaking) {
              if (loudToStart) {
                speaking = true;
                speechStartedAt = now;
                lastLoudAt = now;
                setState("speech");
                console.log(`[VAD] speech started level=${level.toFixed(5)} startThreshold=${startThreshold.toFixed(5)} sustainThreshold=${sustainThreshold.toFixed(5)}`);
              } else if (now - startedAt > cfg.maxWaitMs) {
                console.log(`[VAD] maxWaitMs exceeded — no speech detected`);
                if (recorder && recorder.state !== "inactive") {
                  recorder.onstop = () => resolve(null);
                  recorder.stop();
                } else {
                  resolve(null);
                }
                return;
              }
            } else {
              // Only extend lastLoudAt if clearly louder than noise (sustainThreshold)
              if (loudToSustain) lastLoudAt = now;
              const speechMs = now - (speechStartedAt ?? now);
              const silenceMs = now - (lastLoudAt ?? now);
              const hitMax = speechMs >= cfg.maxUtteranceMs;
              const hitEnd =
                speechMs >= cfg.minSpeechMs && silenceMs >= cfg.silenceMs;

              // Log every 500ms while speaking so we can see silence accumulating
              if (Math.floor(speechMs / 500) !== Math.floor((speechMs - 16) / 500)) {
                console.log(`[VAD] speaking: speechMs=${speechMs.toFixed(0)} silenceMs=${silenceMs.toFixed(0)} level=${level.toFixed(5)} loud=${loudToSustain}`);
              }

              if (hitMax || hitEnd) {
                console.log(`[VAD] done: speechMs=${speechMs.toFixed(0)} silenceMs=${silenceMs.toFixed(0)} hitEnd=${hitEnd} hitMax=${hitMax}`);
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
        setMicLevel(0);
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

  return { state, error, micLevel, listenOnce, abort, releaseMic, warmupMic };
}
