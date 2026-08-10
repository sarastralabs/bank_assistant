import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  beginKioskSession,
  endKioskSession,
  fetchGreetingCatalog,
  fetchKioskGreetAudio,
  fetchKioskStatus,
  reportKioskPresence,
  setKioskPhase,
  type KioskStatus,
} from "../api/client";
import { usePresence } from "../hooks/usePresence";
import {
  greetingForNowFallback,
  pickRandomFromCatalog,
  slotForHour,
  type Greeting,
  type GreetingCatalogSlot,
} from "../utils/greetings";
import { playBase64Wav, preloadBrowserVoices, speakKannadaBrowser, unlockAudio } from "../utils/playAudio";
import { HandsFreeConversation, type HandsFreeTurn } from "./HandsFreeConversation";
import { LobbyBot, type MascotMood } from "./LobbyBot";

interface AgentLobbyProps {
  apiOnline: boolean | null;
}

/**
 * Instant greet — speak right away.
 * Never kick off live TTS generate here (that steals the GPU from the reply pipeline).
 * Use cached WAV if already warm; otherwise browser TTS.
 */
async function playTimeGreeting(greet: Greeting): Promise<"mms" | "browser" | "parler"> {
  try {
    const peek = await Promise.race([
      fetchKioskGreetAudio({
        slot: greet.slot,
        hour: new Date().getHours(),
        variant: greet.variant,
        random: false,
        generate: false,
      }),
      new Promise<null>((r) => window.setTimeout(() => r(null), 80)),
    ]);
    if (peek && peek.audio_b64 && peek.cached) {
      await unlockAudio();
      await playBase64Wav(peek.audio_b64);
      return "parler";
    }
  } catch {
    // fall through to browser voice
  }

  await speakKannadaBrowser(greet.line_kn);
  return "browser";
}

/** Pick greeting locally — no network wait. */
function pickGreetingNow(catalog: GreetingCatalogSlot[] | null): Greeting {
  if (catalog?.length) return pickRandomFromCatalog(catalog);
  return greetingForNowFallback();
}

export function AgentLobby({ apiOnline }: AgentLobbyProps) {
  const [status, setStatus] = useState<KioskStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [greetStatus, setGreetStatus] = useState<string | null>(null);
  const [activeGreet, setActiveGreet] = useState<Greeting>(() => greetingForNowFallback());
  const [greetCatalog, setGreetCatalog] = useState<GreetingCatalogSlot[] | null>(null);
  const [convoMood, setConvoMood] = useState<MascotMood>("listening");
  const greetingStarted = useRef(false);
  const leaveTimer = useRef<number | null>(null);

  const mapTurnToMood = (turn: HandsFreeTurn): MascotMood => {
    switch (turn) {
      case "listening":
      case "form_confirm":
        return "listening";
      case "thinking":
      case "form_prompt":
        return "thinking";
      case "speaking":
        return "speaking";
      default:
        return "ready";
    }
  };

  useEffect(() => {
    preloadBrowserVoices();
    // First click/tap anywhere unlocks Chrome audio for auto-greet
    const unlock = () => {
      void unlockAudio();
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    void fetchGreetingCatalog()
      .then((data) => {
        setGreetCatalog(data.greetings);
        setActiveGreet((prev) => {
          const slot = slotForHour(new Date().getHours());
          if (prev.slot === slot) return prev;
          return greetingForNowFallback();
        });
      })
      .catch(() => undefined);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // Idle headline: time slot title only (not random line every minute)
  useEffect(() => {
    const tick = () => {
      const slot = slotForHour(new Date().getHours());
      const meta = greetCatalog?.find((g) => g.slot === slot);
      setActiveGreet((prev) => ({
        ...prev,
        slot,
        title_kn: meta?.title_kn ?? greetingForNowFallback().title_kn,
        title_en: meta?.title_en ?? greetingForNowFallback().title_en,
        hours: meta?.hours ?? greetingForNowFallback().hours,
      }));
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [greetCatalog]);

  const refresh = useCallback(async () => {
    try {
      const s = await fetchKioskStatus();
      setStatus(s);
      setError(null);
      return s;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lobby status failed");
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(id);
  }, [refresh]);

  const running = status?.running ?? false;
  const phase = status?.phase ?? "stopped";
  const inSession = phase === "greeting" || phase === "conversation";

  const runGreetingFlow = useCallback(async () => {
    const greet = pickGreetingNow(greetCatalog);
    setActiveGreet(greet);
    setGreetStatus(`👋 ${greet.title_kn} — speaking…`);
    // Unlock audio first (camera permission alone is not enough in Chrome)
    await unlockAudio();
    try {
      const via = await playTimeGreeting(greet);
      setGreetStatus(
        via === "browser"
          ? "ಕನ್ನಡ ಧ್ವನಿ · Browser voice"
          : "ಕನ್ನಡ ಧ್ವನಿ · Cached",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kannada greeting failed");
      await unlockAudio();
      await speakKannadaBrowser(greet.line_kn);
    } finally {
      window.setTimeout(() => setGreetStatus(null), 1200);
    }
    try {
      const next = await setKioskPhase("conversation");
      setStatus(next);
    } catch {
      // ignore
    }
  }, [greetCatalog]);

  const handlePresent = useCallback(() => {
    void (async () => {
      if (greetingStarted.current) return;
      try {
        let runningNow = status?.running ?? false;
        let phaseNow = status?.phase ?? "stopped";
        if (!runningNow || phaseNow !== "idle") {
          const live = await fetchKioskStatus();
          setStatus(live);
          runningNow = live.running;
          phaseNow = live.phase;
        }
        if (!(runningNow && phaseNow === "idle") || greetingStarted.current) return;
        greetingStarted.current = true;

        // Mark greeting UI immediately so user sees the line while audio starts
        const greet = pickGreetingNow(greetCatalog);
        setActiveGreet(greet);
        setStatus((prev) =>
          prev ? { ...prev, phase: "greeting", person_present: true } : prev,
        );

        // Voice FIRST — then session bookkeeping
        await unlockAudio();
        const speakPromise = playTimeGreeting(greet).then((via) => {
          setGreetStatus(
            via === "browser"
              ? "ಕನ್ನಡ ಧ್ವನಿ · Browser voice"
              : "ಕನ್ನಡ ಧ್ವನಿ · Cached",
          );
          window.setTimeout(() => setGreetStatus(null), 1200);
        });

        void reportKioskPresence(true).catch(() => undefined);
        void beginKioskSession()
          .then(setStatus)
          .catch((err) => {
            setError(err instanceof Error ? err.message : "Could not start session");
          });

        try {
          await speakPromise;
        } catch (err) {
          setError(err instanceof Error ? err.message : "Greeting voice failed");
          await speakKannadaBrowser(greet.line_kn);
        }

        try {
          const next = await setKioskPhase("conversation");
          setStatus(next);
        } catch {
          // ignore
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Presence update failed");
        greetingStarted.current = false;
      }
    })();
  }, [greetCatalog, status]);

  const handleAbsent = useCallback(() => {
    void reportKioskPresence(false).then(setStatus).catch(() => undefined);
  }, []);

  const { videoRef, canvasRef, presence, cameraError, detectorMode, retryCamera } =
    usePresence({
      enabled: running,
      presentHoldMs: 350,
      onPresent: handlePresent,
      onAbsent: handleAbsent,
    });

  useEffect(() => {
    if (!running || !inSession) {
      if (leaveTimer.current) {
        window.clearTimeout(leaveTimer.current);
        leaveTimer.current = null;
      }
      return;
    }
    if (presence === "absent") {
      leaveTimer.current = window.setTimeout(() => {
        void endKioskSession("Customer left camera view").then((s) => {
          setStatus(s);
          greetingStarted.current = false;
        });
      }, 14000);
    } else if (leaveTimer.current) {
      window.clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
    return () => {
      if (leaveTimer.current) window.clearTimeout(leaveTimer.current);
    };
  }, [presence, running, inSession]);

  useEffect(() => {
    if (!running) greetingStarted.current = false;
  }, [running]);

  const handleManualStart = async () => {
    try {
      await unlockAudio();
      greetingStarted.current = true;
      await reportKioskPresence(true);
      const next = await beginKioskSession();
      setStatus(next);
      await runGreetingFlow();
    } catch (err) {
      greetingStarted.current = false;
      setError(err instanceof Error ? err.message : "Could not start session");
    }
  };

  const handleEnd = async (note = "Ended on agent screen") => {
    try {
      window.speechSynthesis?.cancel();
      const s = await endKioskSession(note);
      setStatus(s);
      greetingStarted.current = false;
      setGreetStatus(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not end session");
    }
  };

  const slotLabel = useMemo(() => {
    const map = {
      morning: "ಬೆಳಗ್ಗೆ · Morning",
      afternoon: "ಮಧ್ಯಾಹ್ನ · Afternoon",
      evening: "ಸಂಜೆ · Evening",
      night: "ರಾತ್ರಿ · Night",
    } as const;
    return map[activeGreet.slot];
  }, [activeGreet.slot]);

  if (!running) {
    return (
      <div className="lobby-shell lobby-waiting lobby-phase-idle">
        <div className="lobby-waiting-stage">
          <LobbyBot mood="waiting" />
          <div className="lobby-waiting-card">
            <div className="lobby-brand-lockup">
              <span className="lobby-brand-mark" aria-hidden>
                ಕ
              </span>
              <p className="lobby-brand">ಕನ್ನಡ ವಾಯ್ಸ್ ಬ್ಯಾಂಕಿಂಗ್</p>
            </div>
            <h1>ಕೌಂಟರ್ ಮುಚ್ಚಿದೆ</h1>
            <p className="lobby-waiting-kn">
              ದಯವಿಟ್ಟು ಸಿಬ್ಬಂದಿ ಈ ಕೌಂಟರ್ ತೆರೆಯುವವರೆಗೆ ಕಾಯಿರಿ.
            </p>
            <p className="lobby-waiting-en">Lobby closed — waiting for staff to open the counter.</p>
            <p className="demo-pill">Demo mode</p>
            {apiOnline === false && <p className="api-warning">Service offline</p>}
            {error && <p className="api-warning">{error}</p>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`lobby-shell lobby-fit lobby-phase-${phase} slot-${activeGreet.slot}`}>
      <header className="lobby-top">
        <div className="lobby-brand-lockup">
          <span className="lobby-brand-mark" aria-hidden>
            ಕ
          </span>
          <div>
            <p className="lobby-brand">ಕನ್ನಡ ವಾಯ್ಸ್ ಬ್ಯಾಂಕಿಂಗ್</p>
            <p className="lobby-phase">
              {phase === "idle" && "ಸಿದ್ಧ · Waiting for customer"}
              {phase === "greeting" && `${activeGreet.title_kn}…`}
              {phase === "conversation" && "Hands-free · ಹಸ್ತರಹಿತ"}
            </p>
          </div>
        </div>
        <div className="lobby-top-actions">
          <span className="lobby-chip">{slotLabel}</span>
          {inSession && (
            <button type="button" className="danger-btn lobby-end-btn" onClick={() => void handleEnd()}>
              End
            </button>
          )}
        </div>
      </header>

      {(error || (cameraError && phase === "conversation")) && (
        <div className="lobby-alert" role="status">
          <p className="lobby-alert-text">{error ?? cameraError}</p>
          {cameraError && (
            <button type="button" className="lobby-alert-btn" onClick={retryCamera}>
              Retry camera
            </button>
          )}
        </div>
      )}
      {greetStatus && <p className="lobby-greet-status">{greetStatus}</p>}

      <div className={`lobby-body lobby-body-${phase}`}>
        {(phase === "idle" || phase === "greeting") && (
          <>
            <main className={`lobby-stage lobby-stage-${phase}`}>
              <LobbyBot
                mood={phase === "greeting" ? "greeting" : "ready"}
                className="lobby-bot-hero"
              />
              <div className="lobby-invite">
                <p className="lobby-invite-kicker">{slotLabel}</p>
                <h1>{activeGreet.title_kn}</h1>
                {phase === "idle" ? (
                  <>
                    <p className="lobby-invite-kn">ಕ್ಯಾಮೆರಾ ಎದುರು ನಿಂತು ಪ್ರಾರಂಭಿಸಿ</p>
                    <p className="lobby-invite-en">Tap once for sound, then step into view.</p>
                    <button type="button" className="lobby-cta" onClick={() => void handleManualStart()}>
                      ಪ್ರಾರಂಭಿಸಿ · Start
                    </button>
                  </>
                ) : (
                  <>
                    <p className="lobby-invite-kn">{activeGreet.line_kn}</p>
                    <p className="lobby-invite-en">{activeGreet.line_en}</p>
                  </>
                )}
              </div>
            </main>

            <aside className="lobby-presence">
              <div
                className={[
                  "lobby-camera-wrap lobby-camera-presence",
                  presence === "present" ? "lobby-camera-live" : "",
                  cameraError ? "is-error" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <video ref={videoRef} className="lobby-video" playsInline muted autoPlay />
                <canvas ref={canvasRef} className="lobby-canvas-hidden" />
                <div className="lobby-camera-veil" aria-hidden />
                <div className="lobby-camera-badge">
                  {presence === "present" ? "Detected" : cameraError ? "Offline" : "Looking…"}
                </div>
              </div>
              <div className="lobby-presence-meta">
                <p className="lobby-presence-title">
                  {presence === "present" ? "ಗ್ರಾಹಕರು ಕಂಡುಬಂದರು" : "Presence window"}
                </p>
                <p className="lobby-presence-hint">
                  {cameraError
                    ? "Camera busy — close other apps, then retry."
                    : "Stand in this frame to begin the Kannada greeting."}
                </p>
                {cameraError && (
                  <button type="button" className="lobby-alert-btn" onClick={retryCamera}>
                    Retry camera
                  </button>
                )}
              </div>
            </aside>
          </>
        )}

        {phase === "conversation" && (
          <>
            <div
              className={[
                "lobby-camera-wrap lobby-camera-mini",
                presence === "present" ? "lobby-camera-live" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <video ref={videoRef} className="lobby-video" playsInline muted autoPlay />
              <canvas ref={canvasRef} className="lobby-canvas-hidden" />
              <div className="lobby-camera-badge">
                {presence === "present" ? "Detected" : `Cam · ${detectorMode}`}
              </div>
            </div>
            <main className="lobby-conversation">
              <div className="lobby-convo-hero">
                <LobbyBot mood={convoMood} className="lobby-bot-convo" />
              </div>
              <HandsFreeConversation
                active={phase === "conversation"}
                apiOnline={apiOnline}
                onRequestEnd={(reason) => void handleEnd(reason)}
                onTurnChange={(turn) => setConvoMood(mapTurnToMood(turn))}
              />
            </main>
          </>
        )}
      </div>
    </div>
  );
}
