import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  beginKioskSession,
  endKioskSession,
  fetchGreetingCatalog,
  fetchKioskGreetAudio,
  fetchKioskStatus,
  fetchKioskStatusLite,
  reportKioskPresence,
  setKioskPhase,
  type KioskStatus,
} from "../api/client";

import { usePresence } from "../hooks/usePresence";
import { startVisibilityAwarePoll } from "../utils/polling";

import {
  greetingForNowFallback,
  pickRandomFromCatalog,
  slotForHour,
  type Greeting,
  type GreetingCatalogSlot,
} from "../utils/greetings";

import {
  playBase64Wav,
  preloadBrowserVoices,
  speakKannada,
  speakKannadaBrowser,
  unlockAudio,
} from "../utils/playAudio";

import { HandsFreeConversation, type HandsFreeTurn } from "./HandsFreeConversation";

import { LobbyBot, type MascotMood } from "./LobbyBot";
import { SpeakGuideCard } from "./SpeakGuideCard";

interface AgentLobbyProps {
  apiOnline: boolean | null;
}

type GreetVia = "cached" | "browser" | "api";

/** Warm Parler greeting WAV on disk for the next customer (fire-and-forget). */
function warmGreetingCache(greet: Greeting): void {
  if (greet.variant === undefined) return;
  void fetchKioskGreetAudio({
    slot: greet.slot,
    variant: greet.variant,
    random: false,
    generate: true,
  }).catch(() => undefined);
}

/**
 * Speak full time-of-day greeting via deployed Parler TTS only.
 * 1) Cached Parler WAV  2) Live /api/speak-kannada (remote Suresh)
 * Browser voice only if API/TTS is completely unavailable.
 */
async function playTimeGreeting(
  greet: Greeting,
  apiOnline: boolean | null,
): Promise<GreetVia> {
  await unlockAudio();

  if (greet.variant !== undefined) {
    try {
      const data = await fetchKioskGreetAudio({
        slot: greet.slot,
        hour: new Date().getHours(),
        variant: greet.variant,
        random: false,
        generate: false,
      });
      if (data.audio_b64 && data.cached) {
        await playBase64Wav(data.audio_b64);
        return "cached";
      }
    } catch {
      // fall through to live Parler
    }
  }

  if (apiOnline !== false) {
    try {
      await speakKannada(greet.line_kn, undefined, apiOnline);
      warmGreetingCache(greet);
      return "api";
    } catch {
      // fall through
    }
  }

  const browserOk = await speakKannadaBrowser(greet.line_kn);
  if (browserOk) {
    warmGreetingCache(greet);
    return "browser";
  }

  return "browser";
}

function greetViaLabel(via: GreetVia): string {
  if (via === "cached" || via === "api") return "ಕನ್ನಡ ಧ್ವನಿ ಸಿದ್ಧವಾಗಿದೆ";
  return "ಬದಲಿ ಕನ್ನಡ ಧ್ವನಿ ಸಿದ್ಧವಾಗಿದೆ";
}

/** Pick greeting locally — no network wait. */
function pickGreetingNow(catalog: GreetingCatalogSlot[] | null): Greeting {
  if (catalog?.length) return pickRandomFromCatalog(catalog);
  return greetingForNowFallback();
}

/** End a leftover session so the next customer gets a full greeting. */
async function ensureIdleForNewCustomer(phase: string): Promise<KioskStatus | null> {
  if (phase !== "conversation" && phase !== "greeting") return null;
  return endKioskSession("New customer — session reset");
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
  const formModeActive = useRef(false);
  const statusRef = useRef(status);
  const statusFailures = useRef(0);
  const hasLoadedStatus = useRef(false);
  const statusGraceUntil = useRef(Date.now() + 60_000);
  const presenceRef = useRef<"unknown" | "absent" | "present">("unknown");
  statusRef.current = status;

  const mapTurnToMood = (turn: HandsFreeTurn): MascotMood => {
    switch (turn) {
      case "listening":
      case "form_confirm":
        return "listening";
      case "thinking":
      case "preparing":
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
      const s = await fetchKioskStatusLite();
      setStatus((prev) => {
        // Keep greeting UI mid-speech, but never revert once server reached conversation
        if (
          greetingStarted.current &&
          prev?.phase === "greeting" &&
          s.phase !== "conversation"
        ) {
          return { ...s, phase: "greeting", person_present: true, sessions: prev?.sessions ?? [] };
        }
        if (s.phase === "conversation") {
          greetingStarted.current = false;
        }
        return { ...s, sessions: prev?.sessions ?? [] };
      });
      hasLoadedStatus.current = true;
      statusFailures.current = 0;
      setError(null);
      return s;
    } catch (err) {
      if (!hasLoadedStatus.current && Date.now() < statusGraceUntil.current) return null;
      statusFailures.current += 1;
      if (statusFailures.current >= 3) {
        setError(err instanceof Error ? err.message : "Lobby status failed");
      }
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh();
    return startVisibilityAwarePoll(() => {
      void refresh();
    }, 4000, 20000);
  }, [refresh]);

  const statusLoading = status === null;
  const running = status?.running ?? false;
  const phase = status?.phase ?? "stopped";
  const inSession = phase === "greeting" || phase === "conversation";

  const goToConversation = useCallback(async () => {
    try {
      const next = await setKioskPhase("conversation");
      greetingStarted.current = false;
      setStatus(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start conversation");
      throw err;
    }
  }, []);

  const runGreetingFlow = useCallback(async () => {
    const greet = pickGreetingNow(greetCatalog);
    setActiveGreet(greet);
    setGreetStatus(`👋 ${greet.title_kn} — ಸ್ವಾಗತಿಸುತ್ತಿದ್ದೇನೆ…`);
    await unlockAudio();
    try {
      const via = await playTimeGreeting(greet, apiOnline);
      setGreetStatus(greetViaLabel(via));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kannada greeting failed");
      await unlockAudio();
      await speakKannadaBrowser(greet.line_kn);
    } finally {
      window.setTimeout(() => setGreetStatus(null), 1200);
    }
    await goToConversation();
  }, [greetCatalog, goToConversation, apiOnline]);

  const handlePresent = useCallback(() => {
    void (async () => {
      if (greetingStarted.current) return;

      try {
        let runningNow = statusRef.current?.running ?? false;
        let phaseNow = statusRef.current?.phase ?? "stopped";

        const live = await fetchKioskStatus();
        setStatus(live);
        runningNow = live.running;
        phaseNow = live.phase;

        if (!runningNow || greetingStarted.current) return;

        // Stale session from a previous customer / closed tab / other device
        if (phaseNow === "conversation" || phaseNow === "greeting") {
          const reset = await ensureIdleForNewCustomer(phaseNow);
          if (reset) {
            setStatus(reset);
            phaseNow = reset.phase;
          }
        }

        if (phaseNow !== "idle" || greetingStarted.current) return;

        greetingStarted.current = true;

        await unlockAudio();
        try {
          await navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => {
            s.getTracks().forEach((t) => t.stop());
          });
        } catch {
          // Mic prompt may appear again in conversation
        }

        const greet = pickGreetingNow(greetCatalog);
        setActiveGreet(greet);
        setGreetStatus("ಧ್ವನಿ ಸಿದ್ಧಪಡಿಸಲಾಗುತ್ತಿದೆ… · Preparing greeting voice");
        setStatus((prev) =>
          prev ? { ...prev, phase: "greeting", person_present: true } : prev,
        );

        await unlockAudio();

        const speakPromise = playTimeGreeting(greet, apiOnline).then((via) => {
          setGreetStatus(greetViaLabel(via));
          window.setTimeout(() => setGreetStatus(null), 1200);
        });

        void reportKioskPresence(true).catch(() => undefined);

        try {
          const sessionStatus = await beginKioskSession();
          setStatus(sessionStatus);
        } catch (err) {
          greetingStarted.current = false;
          setError(err instanceof Error ? err.message : "Could not start session");
          return;
        }

        try {
          await speakPromise;
        } catch (err) {
          setError(err instanceof Error ? err.message : "Greeting voice failed");
          await speakKannadaBrowser(greet.line_kn);
        }

        await goToConversation();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Presence update failed");
        greetingStarted.current = false;
      }
    })();
  }, [greetCatalog, goToConversation, apiOnline]);

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

  presenceRef.current = presence;

  // Clear stuck sessions when lobby opens with nobody in frame (e.g. second device / refresh)
  useEffect(() => {
    if (!running || greetingStarted.current) return;
    if (phase !== "conversation" && phase !== "greeting") return;
    if (presence !== "absent") return;

    const t = window.setTimeout(() => {
      if (!greetingStarted.current && presenceRef.current === "absent") {
        void endKioskSession("Reset for next customer").then((s) => {
          setStatus(s);
          greetingStarted.current = false;
        });
      }
    }, 2500);

    return () => window.clearTimeout(t);
  }, [running, phase, presence]);

  useEffect(() => {
    if (!running || !inSession) {
      if (leaveTimer.current) {
        window.clearTimeout(leaveTimer.current);
        leaveTimer.current = null;
      }
      return;
    }
    if (presence === "absent" && !formModeActive.current) {
      leaveTimer.current = window.setTimeout(() => {
        void endKioskSession("Customer left camera view").then((s) => {
          setStatus(s);
          greetingStarted.current = false;
          formModeActive.current = false;
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
    if (phase === "idle" || phase === "stopped") greetingStarted.current = false;
  }, [running, phase]);

  const handleManualStart = async () => {
    try {
      await unlockAudio();
      await navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => {
        s.getTracks().forEach((t) => t.stop());
      });

      let phaseNow = statusRef.current?.phase ?? "idle";
      if (phaseNow === "conversation" || phaseNow === "greeting") {
        const reset = await ensureIdleForNewCustomer(phaseNow);
        if (reset) {
          setStatus(reset);
          phaseNow = reset.phase;
        }
      }

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
      formModeActive.current = false;
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

  if (statusLoading) {
    return (
      <div className="lobby-shell lobby-waiting lobby-phase-idle lobby-v2">
        <div className="lobby-ambient" aria-hidden>
          <span className="lobby-ambient-orb lobby-ambient-orb--1" />
          <span className="lobby-ambient-orb lobby-ambient-orb--2" />
        </div>
        <div className="lobby-waiting-stage">
          <div className="lobby-waiting-bot-wrap">
            <LobbyBot mood="waiting" />
          </div>
          <div className="lobby-waiting-card lobby-loading-card">
            <div className="lobby-brand-lockup">
              <span className="lobby-brand-mark kn" aria-hidden>
                ಕ
              </span>
              <p className="lobby-brand kn">ಕನ್ನಡ ಧ್ವನಿ ಬ್ಯಾಂಕಿಂಗ್</p>
            </div>
            <div className="spinner" role="status" aria-label="Loading lobby status" />
            <h1 className="kn">ಮಾಹಿತಿ ಪಡೆಯಲಾಗುತ್ತಿದೆ…</h1>
            <p className="lobby-waiting-en">Connecting to counter service…</p>
          </div>
        </div>
      </div>
    );
  }

  if (!running) {
    return (
      <div className="lobby-shell lobby-waiting lobby-phase-idle lobby-v2">
        <div className="lobby-ambient" aria-hidden>
          <span className="lobby-ambient-orb lobby-ambient-orb--1" />
          <span className="lobby-ambient-orb lobby-ambient-orb--2" />
        </div>
        <div className="lobby-waiting-stage">
          <div className="lobby-waiting-bot-wrap">
            <span className="lobby-pulse-ring" aria-hidden />
            <LobbyBot mood="waiting" />
          </div>
          <div className="lobby-waiting-card">
            <div className="lobby-brand-lockup">
              <span className="lobby-brand-mark kn" aria-hidden>
                ಕ
              </span>
              <p className="lobby-brand kn">ಕನ್ನಡ ಧ್ವನಿ ಬ್ಯಾಂಕಿಂಗ್</p>
            </div>
            <h1 className="kn">ಕೌಂಟರ್ ಮುಚ್ಚಿದೆ</h1>
            <p className="lobby-waiting-kn kn">
              ದಯವಿಟ್ಟು ಸಿಬ್ಬಂದಿಯವರು ಈ ಕೌಂಟರ್ ತೆರೆಯುವವರೆಗೆ ಕಾಯಿರಿ.
            </p>
            <p className="lobby-waiting-en">Lobby closed — waiting for staff to open the counter.</p>
            {apiOnline === false && <p className="api-warning">Service offline</p>}
            {error && <p className="api-warning">{error}</p>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`lobby-shell lobby-fit lobby-v2 lobby-phase-${phase} slot-${activeGreet.slot}`}>
      <div className="lobby-ambient" aria-hidden>
        <span className="lobby-ambient-orb lobby-ambient-orb--1" />
        <span className="lobby-ambient-orb lobby-ambient-orb--2" />
      </div>
      <header className="lobby-top">
        <div className="lobby-brand-lockup">
          <span className="lobby-brand-mark kn" aria-hidden>
            ಕ
          </span>
          <div>
            <p className="lobby-brand kn">ಕನ್ನಡ ಧ್ವನಿ ಬ್ಯಾಂಕಿಂಗ್</p>
            <p className="lobby-phase">
              {phase === "idle" && "ಸಿದ್ಧ · Waiting for customer"}
              {phase === "greeting" && `${activeGreet.title_kn}…`}
              {phase === "conversation" && "ಕೈ ಬಳಸದೆ · Hands-free"}
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

      {(error || apiOnline === false || (cameraError && phase === "conversation")) && (
        <div className="lobby-alert" role="status">
          <p className="lobby-alert-text">
            {apiOnline === false
              ? "API offline — check server on port 8000 and refresh (or wait if processing audio)"
              : (error ?? cameraError)}
          </p>
          {cameraError && (
            <button type="button" className="lobby-alert-btn" onClick={retryCamera}>
              Retry camera
            </button>
          )}
        </div>
      )}

      {/* During greeting the status is shown once, in the stage below. */}
      {greetStatus && phase !== "greeting" && <p className="lobby-greet-status">{greetStatus}</p>}

      <div className={`lobby-body lobby-body-${phase}`}>
        {(phase === "idle" || phase === "greeting") && (
          <>
            <main className={`lobby-stage lobby-stage-${phase}`}>
              <div className="lobby-hero-bot">
                {phase === "idle" && <span className="lobby-pulse-ring" aria-hidden />}
                <LobbyBot
                  mood={phase === "greeting" ? "greeting" : "ready"}
                  className="lobby-bot-hero"
                />
              </div>
              <div className="lobby-invite">
                <p className="lobby-invite-kicker">{slotLabel}</p>
                <h1>{activeGreet.title_kn}</h1>
                {phase === "idle" ? (
                  <>
                    <p className="lobby-invite-kn">ಕ್ಯಾಮೆರಾದ ಎದುರು ನಿಂತು ಪ್ರಾರಂಭಿಸಿ</p>
                    <p className="lobby-invite-en">Tap once for sound, then step into view.</p>
                    <button type="button" className="lobby-cta" onClick={() => void handleManualStart()}>
                      ಪ್ರಾರಂಭಿಸಿ · Start
                    </button>
                    {/* Collapsed: opened by default it pushed the robot off-screen on 1080p. */}
                    <SpeakGuideCard compact />
                  </>
                ) : (
                  <>
                    <p className="lobby-invite-kn">{activeGreet.line_kn}</p>
                    <p className="lobby-invite-en">{activeGreet.line_en}</p>
                    <p className="lobby-invite-wait">
                      {greetStatus ?? "ಧ್ವನಿ ಸಿದ್ಧಪಡಿಸಲಾಗುತ್ತಿದೆ — ಕಾಯಿರಿ · Preparing voice — please wait"}
                    </p>
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
                  {presence === "present" ? "ಗ್ರಾಹಕರು ಬಂದಿದ್ದಾರೆ" : "Presence window"}
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
          <div className="convo">
            <aside className="convo-side">
              <LobbyBot mood={convoMood} className="convo-bot" />
              {/* Must stay mounted: presence detection ends the session when the customer leaves. */}
              <div
                className={[
                  "convo-camera",
                  presence === "present" ? "is-live" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <video ref={videoRef} className="lobby-video" playsInline muted autoPlay />
                <canvas ref={canvasRef} className="lobby-canvas-hidden" />
                <span className="convo-camera-badge">
                  {presence === "present" ? "ಕಾಣುತ್ತಿದ್ದೀರಿ · In view" : `Cam · ${detectorMode}`}
                </span>
              </div>
            </aside>
            <main className="convo-main">
              <HandsFreeConversation
                active={phase === "conversation"}
                apiOnline={apiOnline}
                kioskSessionId={status?.current_session_id ?? null}
                skipInitialPrompt
                onRequestEnd={(reason) => void handleEnd(reason)}
                onTurnChange={(turn) => setConvoMood(mapTurnToMood(turn))}
                onFormModeChange={(inForm) => {
                  formModeActive.current = inForm;
                }}
              />
            </main>
          </div>
        )}
      </div>
    </div>
  );
}
