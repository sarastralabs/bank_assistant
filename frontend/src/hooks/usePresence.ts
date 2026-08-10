import { useCallback, useEffect, useRef, useState } from "react";

export type PresenceState = "unknown" | "absent" | "present";

interface UsePresenceOptions {
  enabled: boolean;
  presentHoldMs?: number;
  absentHoldMs?: number;
  onPresent?: () => void;
  onAbsent?: () => void;
}

type FaceDetectorLike = {
  detect: (source: HTMLVideoElement) => Promise<Array<unknown>>;
};

function centerVariance(data: Uint8ClampedArray, w: number, h: number): number {
  const x0 = Math.floor(w * 0.25);
  const x1 = Math.floor(w * 0.75);
  const y0 = Math.floor(h * 0.15);
  const y1 = Math.floor(h * 0.85);
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * w + x) * 4;
      const gray = (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
      sum += gray;
      sumSq += gray * gray;
      n += 1;
    }
  }
  if (n < 10) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

function frameMotion(a: Uint8ClampedArray, b: Uint8ClampedArray, step = 16): number {
  if (a.length !== b.length) return 0;
  let diff = 0;
  let samples = 0;
  for (let i = 0; i < a.length; i += step) {
    diff += Math.abs(a[i]! - b[i]!);
    samples += 1;
  }
  return samples ? diff / samples : 0;
}

/**
 * Presence for the lobby agent: person standing still still counts.
 * Uses FaceDetector when available, else center-frame texture + motion.
 * Not biometric ID — no face storage.
 */
export function usePresence({
  enabled,
  presentHoldMs = 800,
  absentHoldMs = 6000,
  onPresent,
  onAbsent,
}: UsePresenceOptions) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const prevDataRef = useRef<Uint8ClampedArray | null>(null);
  const presentSinceRef = useRef<number | null>(null);
  const absentSinceRef = useRef<number | null>(null);
  const lastReportedRef = useRef<PresenceState>("unknown");
  const faceDetectorRef = useRef<FaceDetectorLike | null>(null);
  const faceTickRef = useRef(0);
  const faceHitRef = useRef(false);

  const [presence, setPresence] = useState<PresenceState>("unknown");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [motionScore, setMotionScore] = useState(0);
  const [occupancyScore, setOccupancyScore] = useState(0);
  const [detectorMode, setDetectorMode] = useState<"face" | "scene">("scene");
  const [cameraRetry, setCameraRetry] = useState(0);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    prevDataRef.current = null;
    presentSinceRef.current = null;
    absentSinceRef.current = null;
    lastReportedRef.current = "unknown";
    faceDetectorRef.current = null;
    faceHitRef.current = false;
    if (videoRef.current) videoRef.current.srcObject = null;
    setPresence("unknown");
    setMotionScore(0);
    setOccupancyScore(0);
  }, []);

  const retryCamera = useCallback(() => {
    stopCamera();
    setCameraError(null);
    setCameraRetry((n) => n + 1);
  }, [stopCamera]);

  useEffect(() => {
    if (!enabled) {
      stopCamera();
      setCameraError(null);
      return;
    }

    let cancelled = false;
    let raf = 0;

    const friendlyCameraError = (err: unknown): string => {
      const name = err instanceof DOMException ? err.name : "";
      const msg = err instanceof Error ? err.message : String(err);
      if (
        name === "NotReadableError" ||
        /Could not start video source/i.test(msg) ||
        /Device in use/i.test(msg)
      ) {
        return "Camera is busy — close other Agent tabs, Teams, or Zoom, then click Retry camera.";
      }
      if (name === "NotAllowedError" || /Permission/i.test(msg)) {
        return "Camera permission blocked — allow camera for this site in the browser address bar.";
      }
      if (name === "NotFoundError") {
        return "No camera found — plug in a webcam and retry.";
      }
      return msg || "Camera unavailable";
    };

    const openCamera = async (): Promise<MediaStream> => {
      try {
        return await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
      } catch {
        // Fallback: any camera, no constraints (helps when ideal size fails)
        return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
    };

    const start = async () => {
      try {
        // Prefer face detection when Chromium exposes it
        const FD = (window as unknown as { FaceDetector?: new (o?: object) => FaceDetectorLike })
          .FaceDetector;
        if (FD) {
          try {
            faceDetectorRef.current = new FD({ fastMode: true, maxDetectedFaces: 1 });
            setDetectorMode("face");
          } catch {
            faceDetectorRef.current = null;
            setDetectorMode("scene");
          }
        } else {
          setDetectorMode("scene");
        }

        const stream = await openCamera();
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        // Camera permission often allows AudioContext unlock for auto-greet
        try {
          const { unlockAudio } = await import("../utils/playAudio");
          await unlockAudio();
        } catch {
          // ignore
        }
        setCameraError(null);
      } catch (err) {
        setCameraError(friendlyCameraError(err));
        return;
      }

      const sample = () => {
        if (cancelled) return;
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || video.readyState < 2) {
          raf = window.requestAnimationFrame(sample);
          return;
        }

        const w = 96;
        const h = 72;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          raf = window.requestAnimationFrame(sample);
          return;
        }
        ctx.drawImage(video, 0, 0, w, h);
        const frame = ctx.getImageData(0, 0, w, h).data;
        const copy = new Uint8ClampedArray(frame);

        const motion = prevDataRef.current ? frameMotion(prevDataRef.current, copy) : 0;
        const variance = centerVariance(copy, w, h);
        prevDataRef.current = copy;

        // Run face detect every ~10 frames (async, non-blocking)
        faceTickRef.current += 1;
        if (faceDetectorRef.current && faceTickRef.current % 10 === 0) {
          void faceDetectorRef.current
            .detect(video)
            .then((faces) => {
              faceHitRef.current = faces.length > 0;
            })
            .catch(() => {
              faceHitRef.current = false;
            });
        }

        const face = faceHitRef.current;
        // Variance ~ person/texture in center; empty wall is usually lower
        const textured = variance > 350;
        const moving = motion > 8;
        const occupied = face || textured || moving;

        setMotionScore(Math.round(motion));
        setOccupancyScore(face ? 100 : Math.round(Math.min(99, variance / 10)));

        const now = Date.now();
        if (occupied) {
          absentSinceRef.current = null;
          if (presentSinceRef.current == null) presentSinceRef.current = now;
          if (now - presentSinceRef.current >= presentHoldMs) {
            if (lastReportedRef.current !== "present") {
              lastReportedRef.current = "present";
              setPresence("present");
              onPresent?.();
            }
          }
        } else if (lastReportedRef.current === "present") {
          if (absentSinceRef.current == null) absentSinceRef.current = now;
          if (now - absentSinceRef.current >= absentHoldMs) {
            lastReportedRef.current = "absent";
            presentSinceRef.current = null;
            setPresence("absent");
            onAbsent?.();
          }
        } else {
          presentSinceRef.current = null;
          if (absentSinceRef.current == null) absentSinceRef.current = now;
          if (now - absentSinceRef.current >= 1000 && lastReportedRef.current !== "absent") {
            lastReportedRef.current = "absent";
            setPresence("absent");
            onAbsent?.();
          }
        }

        raf = window.requestAnimationFrame(sample);
      };

      raf = window.requestAnimationFrame(sample);
    };

    void start();

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
      stopCamera();
    };
  }, [enabled, presentHoldMs, absentHoldMs, onPresent, onAbsent, stopCamera, cameraRetry]);

  return {
    videoRef,
    canvasRef,
    presence,
    cameraError,
    motionScore,
    occupancyScore,
    detectorMode,
    stopCamera,
    retryCamera,
  };
}
