import { useCallback, useEffect, useMemo, useState } from "react";
import {
  adminLogout,
  endKioskSessionAsAdmin,
  fetchKioskStatus,
  startKiosk,
  stopKiosk,
  type KioskStatus,
} from "../api/client";
import { getAdminUsername } from "../auth/adminSession";

interface AdminPanelProps {
  apiOnline: boolean | null;
  onOpenLobby: () => void;
  onLogout: () => void;
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case "idle":
      return "Waiting";
    case "greeting":
      return "Greeting";
    case "conversation":
      return "In conversation";
    case "stopped":
      return "Closed";
    case "ended":
      return "Completed";
    default:
      return phase.charAt(0).toUpperCase() + phase.slice(1);
  }
}

function friendlyEvent(event: string | null | undefined): string {
  if (!event) return "—";
  const known: Record<string, string> = {
    "Admin started agent kiosk": "Lobby opened",
    "Admin stopped agent kiosk": "Lobby closed",
    "Ended by admin": "Session ended by staff",
    "Ended on agent screen": "Customer finished at counter",
  };
  return known[event] ?? event.replace(/agent kiosk/gi, "lobby").replace(/^Admin /i, "");
}

function friendlyNote(note: string): string {
  if (!note) return "";
  const known: Record<string, string> = {
    "Ended on agent screen": "Customer left counter",
    "Ended by admin": "Ended by staff",
  };
  return known[note] ?? note;
}

/**
 * Staff lobby console — start/stop the voice agent and monitor customers.
 */
export function AdminPanel({ apiOnline, onOpenLobby, onLogout }: AdminPanelProps) {
  const [status, setStatus] = useState<KioskStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const username = getAdminUsername() ?? "Staff";

  const refresh = useCallback(async () => {
    try {
      const s = await fetchKioskStatus();
      setStatus(s);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh status");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2800);
  };

  const handleStart = async () => {
    setBusy(true);
    try {
      setStatus(await startKiosk());
      flash("Lobby is open — ready for customers");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start lobby");
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    setBusy(true);
    try {
      setStatus(await stopKiosk());
      flash("Lobby closed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not close lobby");
    } finally {
      setBusy(false);
    }
  };

  const handleEndSession = async () => {
    setBusy(true);
    try {
      setStatus(await endKioskSessionAsAdmin("Ended by admin"));
      flash("Customer session ended");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not end session");
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    await adminLogout();
    onLogout();
  };

  const running = status?.running ?? false;
  const phase = status?.phase ?? "stopped";
  const sessions = status?.sessions ?? [];
  const activeSession = Boolean(status?.current_session_id);

  const hint = useMemo(() => {
    if (!running) return "Open the lobby when your counter is ready for customers.";
    if (phase === "idle") return "Waiting for a customer at the camera.";
    if (phase === "greeting") return "Welcoming the customer in Kannada.";
    if (phase === "conversation") return "Voice assistant is helping the customer.";
    return friendlyEvent(status?.last_event);
  }, [running, phase, status?.last_event]);

  const customerLabel = useMemo(() => {
    if (!running) return "Lobby closed";
    if (status?.person_present) return "Customer present";
    if (activeSession) return "Session active";
    return "Waiting for customer";
  }, [running, status?.person_present, activeSession]);

  return (
    <div className="adm-desk">
      <header className="adm-desk-head">
        <div>
          <p className="adm-eyebrow">Welcome, {username}</p>
          <h1>Lobby control</h1>
        </div>
        <button type="button" className="ghost-btn adm-logout" onClick={() => void handleLogout()}>
          Sign out
        </button>
      </header>

      {apiOnline === false && (
        <p className="api-warning">Cannot reach the banking service. Check that the server is running.</p>
      )}
      {error && <p className="api-warning">{error}</p>}
      {toast && <p className="adm-toast">{toast}</p>}

      <section className={`adm-hero ${running ? "is-live" : "is-idle"}`}>
        <div className="adm-hero-visual" aria-hidden>
          <span className={`adm-hero-ring ${running ? "on" : "off"}`} />
          <span className="adm-hero-mark">ಕ</span>
        </div>
        <div className="adm-hero-body">
          <p className={`adm-hero-state ${running ? "live" : "idle"}`}>
            {running ? "Lobby open" : "Lobby closed"}
          </p>
          <p className="adm-hero-hint">{hint}</p>
          {running && (
            <div className="adm-hero-tags">
              <span className="adm-tag">{phaseLabel(phase)}</span>
              {status?.person_present && <span className="adm-tag accent">At counter</span>}
            </div>
          )}
        </div>
      </section>

      <section className="adm-actions">
        {!running ? (
          <>
            <button
              type="button"
              className="primary-btn adm-action-main"
              disabled={busy || apiOnline === false}
              onClick={() => void handleStart()}
            >
              {busy ? "Opening…" : "Open lobby"}
            </button>
            <button type="button" className="secondary-btn" onClick={onOpenLobby}>
              Preview lobby screen
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="danger-btn adm-action-main"
              disabled={busy}
              onClick={() => void handleStop()}
            >
              {busy ? "Closing…" : "Close lobby"}
            </button>
            {activeSession && (
              <button
                type="button"
                className="secondary-btn"
                disabled={busy}
                onClick={() => void handleEndSession()}
              >
                End customer session
              </button>
            )}
            <button type="button" className="ghost-btn" onClick={onOpenLobby}>
              Open lobby screen
            </button>
          </>
        )}
      </section>

      {!running && (
        <section className="adm-steps" aria-label="Getting started">
          <h2>Quick start</h2>
          <ol>
            <li>
              <span className="adm-step-num">1</span>
              <span>Open the lobby when the counter is ready</span>
            </li>
            <li>
              <span className="adm-step-num">2</span>
              <span>Show the lobby screen on the customer-facing display</span>
            </li>
            <li>
              <span className="adm-step-num">3</span>
              <span>The voice assistant greets customers when they approach</span>
            </li>
          </ol>
        </section>
      )}

      <section className="adm-overview">
        <article className="adm-overview-card">
          <span>Shift opened</span>
          <strong>{formatTime(status?.started_at ?? null)}</strong>
        </article>
        <article className="adm-overview-card">
          <span>Customer</span>
          <strong>{customerLabel}</strong>
        </article>
        <article className="adm-overview-card">
          <span>Last activity</span>
          <strong>{friendlyEvent(status?.last_event)}</strong>
        </article>
      </section>

      {sessions.length > 0 && (
        <section className="adm-history">
          <div className="adm-history-head">
            <h2>Today&apos;s visits</h2>
            <span>{sessions.length}</span>
          </div>
          <ul>
            {sessions.slice(0, 8).map((s) => (
              <li key={s.id}>
                <span className={`adm-history-badge ${s.ended_at ? "done" : "active"}`}>
                  {s.ended_at ? "Completed" : phaseLabel(s.phase)}
                </span>
                <span className="adm-history-time">{formatTime(s.started_at)}</span>
                {s.note && <span className="adm-history-note">{friendlyNote(s.note)}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
