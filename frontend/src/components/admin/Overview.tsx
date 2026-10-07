import { useCallback, useEffect, useMemo, useState } from "react";
import {
  endKioskSessionAsAdmin,
  fetchAdminHistory,
  fetchFormSubmissions,
  fetchKioskStatus,
  fetchKioskStatusLite,
  fetchSystemHealth,
  startKiosk,
  stopKiosk,
  type FormSubmissionItem,
  type HistoryItem,
  type KioskStatus,
  type SystemHealth,
} from "../../api/client";
import { startVisibilityAwarePoll } from "../../utils/polling";
import {
  Badge,
  Card,
  Empty,
  ErrorNote,
  Icon,
  IntentBadge,
  intentLabel,
  isToday,
  needsAttention,
  seconds,
  timeOnly,
} from "./shared";
import type { AdminView } from "./views";

interface OverviewProps {
  apiOnline: boolean | null;
  onNavigate: (view: AdminView) => void;
  onOpenLobby: () => void;
}

function lobbyState(s: KioskStatus | null): { label: string; kn: string; tone: "live" | "busy" | "idle" | "off" } {
  if (!s) return { label: "Loading…", kn: "", tone: "off" };
  if (!s.running) return { label: "Lobby closed", kn: "ಲಾಬಿ ಮುಚ್ಚಿದೆ", tone: "off" };
  if (s.phase === "conversation") return { label: "Helping a customer", kn: "ಗ್ರಾಹಕರಿಗೆ ಸಹಾಯ", tone: "busy" };
  if (s.phase === "greeting") return { label: "Greeting a customer", kn: "ಸ್ವಾಗತಿಸುತ್ತಿದೆ", tone: "busy" };
  return { label: "Open — waiting for customer", kn: "ಗ್ರಾಹಕರಿಗಾಗಿ ಕಾಯುತ್ತಿದೆ", tone: "live" };
}

export function Overview({ apiOnline, onNavigate, onOpenLobby }: OverviewProps) {
  const [status, setStatus] = useState<KioskStatus | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [forms, setForms] = useState<FormSubmissionItem[]>([]);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [healthErr, setHealthErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const loadStatus = useCallback(async (full: boolean) => {
    try {
      if (full) setStatus(await fetchKioskStatus());
      else {
        const lite = await fetchKioskStatusLite();
        setStatus((prev) => ({ ...lite, sessions: prev?.sessions ?? [] }));
      }
    } catch {
      /* banner via apiOnline */
    }
  }, []);
  const loadActivity = useCallback(async () => {
    try {
      setHistory(await fetchAdminHistory(200));
    } catch {
      /* keep last */
    }
  }, []);
  const loadForms = useCallback(async () => {
    try {
      setForms(await fetchFormSubmissions(200));
    } catch {
      /* keep last */
    }
  }, []);
  const loadHealth = useCallback(async () => {
    try {
      setHealth(await fetchSystemHealth());
      setHealthErr(false);
    } catch {
      setHealthErr(true);
    }
  }, []);

  useEffect(() => {
    void loadStatus(true);
    void loadActivity();
    void loadForms();
    void loadHealth();
    const stops = [
      startVisibilityAwarePoll(() => loadStatus(false), 5000, 20000),
      startVisibilityAwarePoll(() => loadStatus(true), 20000, 60000),
      startVisibilityAwarePoll(() => loadActivity(), 15000, 60000),
      startVisibilityAwarePoll(() => loadForms(), 30000, 90000),
      startVisibilityAwarePoll(() => loadHealth(), 20000, 60000),
    ];
    return () => stops.forEach((stop) => stop());
  }, [loadStatus, loadActivity, loadForms, loadHealth]);

  const act = async (fn: () => Promise<KioskStatus>, ok: string) => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await fn());
      setToast(ok);
      window.setTimeout(() => setToast(null), 2600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const today = useMemo(() => history.filter((h) => isToday(h.created_at)), [history]);
  const kpi = useMemo(() => {
    const requests = today.length;
    const attention = today.filter(needsAttention).length;
    const times = today.map((h) => h.total_time_s).filter((t): t is number => typeof t === "number");
    const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
    return {
      visits: (status?.sessions ?? []).filter((s) => isToday(s.started_at)).length,
      requests,
      understood: requests ? Math.round(((requests - attention) / requests) * 100) : null,
      attention,
      avg,
      forms: forms.filter((f) => isToday(f.created_at)).length,
    };
  }, [today, status?.sessions, forms]);

  // What customers ask for — today, or the most recent turns if today is empty.
  const mixSource = today.length ? today : history.slice(0, 100);
  const mix = useMemo(() => {
    const counts = new Map<string, number>();
    for (const h of mixSource) counts.set(h.intent || "—", (counts.get(h.intent || "—") ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [mixSource]);
  const mixMax = mix[0]?.[1] ?? 1;

  const state = lobbyState(status);
  const running = status?.running ?? false;
  const inSession = Boolean(status?.current_session_id);
  const remote = health?.tts?.remote;
  const ttsHost = (() => {
    try {
      return remote?.url ? new URL(remote.url).host : "local";
    } catch {
      return remote?.url ?? "local";
    }
  })();

  return (
    <div className="ac-page">
      {error && <ErrorNote message={error} />}
      {toast && <p className="ac-toast">{toast}</p>}

      {/* Lobby control */}
      <section className={`ac-lobby ac-lobby--${state.tone}`} aria-label="Lobby control">
        <div className="ac-lobby-state">
          <span className="ac-lobby-dot" aria-hidden />
          <div>
            <p className="ac-eyebrow">Customer lobby</p>
            <h2 className="ac-lobby-title">{state.label}</h2>
            {state.kn && <p className="ac-lobby-kn kn">{state.kn}</p>}
            <div className="ac-lobby-meta">
              {running && <span>Opened {timeOnly(status?.started_at)}</span>}
              {status?.person_present && <Badge tone="green">Customer at counter</Badge>}
              {inSession && <Badge tone="blue">Session in progress</Badge>}
            </div>
          </div>
        </div>
        <div className="ac-lobby-actions">
          {!running ? (
            <button
              type="button"
              className="ac-btn ac-btn--gold ac-btn--lg"
              disabled={busy || apiOnline === false || !status}
              onClick={() => void act(startKiosk, "Lobby is open — ready for customers")}
            >
              {busy ? "Opening…" : "Open lobby"}
            </button>
          ) : (
            <>
              {inSession && (
                <button
                  type="button"
                  className="ac-btn ac-btn--outline"
                  disabled={busy}
                  onClick={() => void act(() => endKioskSessionAsAdmin("Ended by admin"), "Customer session ended")}
                >
                  End session
                </button>
              )}
              <button
                type="button"
                className="ac-btn ac-btn--danger"
                disabled={busy}
                onClick={() => void act(stopKiosk, "Lobby closed")}
              >
                {busy ? "Closing…" : "Close lobby"}
              </button>
            </>
          )}
          <button type="button" className="ac-btn ac-btn--ghost" onClick={onOpenLobby}>
            <Icon name="external" size={16} /> Customer screen
          </button>
        </div>
      </section>

      {/* Today */}
      <div className="ac-kpis" aria-label="Today">
        <article className="ac-kpi">
          <span className="ac-kpi-label">Visits today</span>
          <strong className="ac-kpi-value">{kpi.visits}</strong>
          <span className="ac-kpi-sub kn">ಇಂದಿನ ಭೇಟಿಗಳು</span>
        </article>
        <article className="ac-kpi">
          <span className="ac-kpi-label">Requests today</span>
          <strong className="ac-kpi-value">{kpi.requests}</strong>
          <span className="ac-kpi-sub">spoken by customers</span>
        </article>
        <button type="button" className="ac-kpi ac-kpi--link" onClick={() => onNavigate("conversations")}>
          <span className="ac-kpi-label">Understood first time</span>
          <strong className={`ac-kpi-value ${kpi.understood !== null && kpi.understood < 80 ? "is-warn" : ""}`}>
            {kpi.understood === null ? "—" : `${kpi.understood}%`}
          </strong>
          <span className="ac-kpi-sub">
            {kpi.attention ? `${kpi.attention} need attention →` : "no problems today"}
          </span>
        </button>
        <article className="ac-kpi">
          <span className="ac-kpi-label">Avg. response</span>
          <strong className="ac-kpi-value">{seconds(kpi.avg)}</strong>
          <span className="ac-kpi-sub">speech → answer text</span>
        </article>
        <button type="button" className="ac-kpi ac-kpi--link" onClick={() => onNavigate("forms")}>
          <span className="ac-kpi-label">Forms today</span>
          <strong className="ac-kpi-value">{kpi.forms}</strong>
          <span className="ac-kpi-sub">submitted by voice →</span>
        </button>
      </div>

      <div className="ac-grid ac-grid--2-1">
        {/* Live activity */}
        <Card
          title="Live activity"
          titleKn="ಇತ್ತೀಚಿನ ಮಾತುಗಳು"
          flush
          actions={
            <button type="button" className="ac-btn ac-btn--ghost ac-btn--sm" onClick={() => onNavigate("conversations")}>
              View all →
            </button>
          }
        >
          {history.length === 0 ? (
            <Empty icon="💬" title="No conversations yet" hint="Customer requests appear here as they happen." />
          ) : (
            <ul className="ac-feed">
              {history.slice(0, 8).map((h) => (
                <li key={String(h.id)} className={needsAttention(h) ? "is-attention" : ""}>
                  <span className="ac-feed-time">{timeOnly(h.created_at)}</span>
                  <div className="ac-feed-main">
                    <p className="ac-feed-said kn">{h.kannada_text || "—"}</p>
                    <p className="ac-feed-en">{h.english_text}</p>
                  </div>
                  <IntentBadge intent={h.intent} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="ac-stack">
          {/* System health */}
          <Card title="System health" titleKn="ವ್ಯವಸ್ಥೆಯ ಸ್ಥಿತಿ">
            <ul className="ac-health">
              <li>
                <span className={`ac-health-dot ${apiOnline ? "is-ok" : apiOnline === false ? "is-bad" : ""}`} />
                <span className="ac-health-name">Kiosk service</span>
                <span className="ac-health-val">{apiOnline ? "Online" : apiOnline === false ? "Offline" : "…"}</span>
              </li>
              <li>
                <span className={`ac-health-dot ${health?.pipeline_worker ? "is-ok" : healthErr ? "is-bad" : ""}`} />
                <span className="ac-health-name">Speech understanding</span>
                <span className="ac-health-val">{health ? (health.pipeline_worker ? "Ready" : "Starting") : healthErr ? "Unknown" : "…"}</span>
              </li>
              <li>
                <span
                  className={`ac-health-dot ${
                    remote?.configured ? (remote.ready ? "is-ok" : remote.healthy ? "is-warn" : "is-bad") : health?.tts?.ready ? "is-ok" : ""
                  }`}
                />
                <span className="ac-health-name">Voice (TTS) · {ttsHost}</span>
                <span className="ac-health-val">
                  {!health
                    ? healthErr
                      ? "Unknown"
                      : "…"
                    : remote?.configured
                      ? remote.ready
                        ? "Ready"
                        : remote.healthy
                          ? "Warming up"
                          : "Unreachable"
                      : health.tts?.ready
                        ? "Ready"
                        : "Not ready"}
                </span>
              </li>
              <li>
                <span className="ac-health-dot is-ok" />
                <span className="ac-health-name">Assistant voice</span>
                <span className="ac-health-val">{health?.tts?.speaker ?? "—"}</span>
              </li>
            </ul>
          </Card>

          {/* What customers ask */}
          <Card title="What customers ask" titleKn={today.length ? "ಇಂದು" : "ಇತ್ತೀಚೆಗೆ"}>
            {mix.length === 0 ? (
              <Empty icon="📊" title="No requests yet" />
            ) : (
              <ul className="ac-bars">
                {mix.slice(0, 7).map(([intent, n]) => {
                  const l = intentLabel(intent);
                  return (
                    <li key={intent}>
                      <span className="ac-bars-label">{l.en}</span>
                      <span className="ac-bars-track">
                        <span className={`ac-bars-fill ac-bars-fill--${l.tone}`} style={{ width: `${(n / mixMax) * 100}%` }} />
                      </span>
                      <span className="ac-bars-num">{n}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
