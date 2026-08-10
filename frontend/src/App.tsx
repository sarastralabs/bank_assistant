import { useEffect, useState } from "react";
import { checkHealth } from "./api/client";
import { AgentLobby } from "./components/AgentLobby";

/**
 * Lobby Agent frontend only (port 5173).
 * Admin console runs separately on port 5174.
 */
export default function App() {
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const probe = () => {
      checkHealth().then((ok) => {
        if (cancelled) return;
        setApiOnline(ok);
        if (!ok && attempts < 10) {
          attempts += 1;
          window.setTimeout(probe, 1500);
        }
      });
    };
    probe();
    const id = window.setInterval(() => {
      checkHealth().then((ok) => {
        if (!cancelled) setApiOnline(ok);
      });
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return <AgentLobby apiOnline={apiOnline} />;
}
