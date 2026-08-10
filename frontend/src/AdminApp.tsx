import { useEffect, useState } from "react";
import { checkHealth, fetchAdminMe } from "./api/client";
import { clearAdminSession, isAdminLoggedIn } from "./auth/adminSession";
import { AdminLogin } from "./components/AdminLogin";
import { AdminPanel } from "./components/AdminPanel";

const LOBBY_URL =
  (import.meta.env.VITE_AGENT_URL as string | undefined)?.replace(/\/$/, "") ||
  "http://127.0.0.1:5173";

/** Staff admin React app — lobby control for the voice banking assistant. */
export function AdminApp() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [adminAuthed, setAdminAuthed] = useState(() => isAdminLoggedIn());
  const [adminChecking, setAdminChecking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const probe = () => {
      checkHealth().then((ok) => {
        if (cancelled) return;
        setConnected(ok);
        if (!ok && attempts < 10) {
          attempts += 1;
          window.setTimeout(probe, 1500);
        }
      });
    };
    probe();
    const id = window.setInterval(() => {
      checkHealth().then((ok) => {
        if (!cancelled) setConnected(ok);
      });
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!isAdminLoggedIn()) {
      setAdminAuthed(false);
      return;
    }
    let cancelled = false;
    setAdminChecking(true);
    fetchAdminMe().then((me) => {
      if (cancelled) return;
      if (me) setAdminAuthed(true);
      else {
        clearAdminSession();
        setAdminAuthed(false);
      }
      setAdminChecking(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={`adm-root${!adminAuthed && !adminChecking ? " adm-root--gate" : ""}`}>
      <div className="adm-bg" aria-hidden />
      <div className="adm-bg-glow" aria-hidden />
      <header className="adm-top">
        <div className="adm-brand">
          <span className="adm-mark">ಕ</span>
          <div>
            <p className="adm-brand-title">ಕನ್ನಡ ವಾಯ್ಸ್ ಬ್ಯಾಂಕಿಂಗ್</p>
            <p className="adm-brand-sub">Staff console · ಸಿಬ್ಬಂದಿ</p>
          </div>
        </div>
        <span
          className={`adm-status-pill ${connected ? "on" : connected === false ? "off" : ""}`}
          title={connected ? "Service connected" : connected === false ? "Service unavailable" : "Checking…"}
        >
          <span className="adm-status-dot" aria-hidden />
          {connected ? "Connected" : connected === false ? "Offline" : "Connecting…"}
        </span>
      </header>

      <main className={`adm-main${!adminAuthed && !adminChecking ? " adm-main--gate" : ""}`}>
        {adminChecking ? (
          <p className="muted adm-checking">Verifying session…</p>
        ) : adminAuthed ? (
          <AdminPanel
            apiOnline={connected}
            onOpenLobby={() => window.open(LOBBY_URL, "_blank", "noopener,noreferrer")}
            onLogout={() => setAdminAuthed(false)}
          />
        ) : (
          <AdminLogin apiOnline={connected} onSuccess={() => setAdminAuthed(true)} />
        )}
      </main>
    </div>
  );
}
