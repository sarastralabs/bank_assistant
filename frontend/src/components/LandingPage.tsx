import { useEffect, useState } from "react";
import {
  fetchLanding,
  formatHistoryTime,
  formatIntentLabel,
  type LandingData,
} from "../api/client";

interface LandingPageProps {
  onStartAssist: () => void;
  onOpenHistory: () => void;
  refreshKey: number;
}

export function LandingPage({ onStartAssist, onOpenHistory, refreshKey }: LandingPageProps) {
  const [data, setData] = useState<LandingData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchLanding()
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load landing data");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return (
    <div className="landing">
      <section className="landing-hero">
        <div className="landing-hero-copy">
          <p className="landing-brand">Kannada Voice Banking</p>
          <h1>How to bank — explained in Kannada.</h1>
          <p className="landing-lead">
            Speak a banking question and get step-by-step guidance on what to do next.
            We never fetch your real account details, balances, or transactions from a bank.
          </p>
          <div className="landing-cta">
            <button type="button" className="primary-btn" onClick={onStartAssist}>
              Start voice assist
            </button>
            <button type="button" className="secondary-btn" onClick={onOpenHistory}>
              View history
            </button>
          </div>
          <p className="landing-disclaimer muted">
            Informational demo only — guidance on how to complete tasks (branch, ATM, forms), not live banking.
          </p>
        </div>
        <div className="landing-hero-visual" aria-hidden="true">
          <div className="hero-orb" />
          <div className="hero-panel">
            <p className="hero-panel-label">What this assistant does</p>
            <p className="hero-panel-line kn">ಬ್ಯಾಂಕ್ ಬ್ಯಾಲೆನ್ಸ್ ಅನ್ನು ಪರಿಶೀಲಿಸುವುದು ಹೇಗೆ</p>
            <p className="hero-panel-line">→ Understands your intent</p>
            <p className="hero-panel-line">→ Tells you how to check (ATM / branch) — never shows your actual balance</p>
          </div>
        </div>
      </section>

      {error && <p className="api-warning">{error}</p>}

      {data && (
        <>
          <section className="landing-section">
            <h2>At a glance</h2>
            <p className="section-lead">
              Voice-in / voice-out guidance assistant. No bank login, no personal data fetch.
            </p>
            <div className="stat-grid">
              <div className="stat-block">
                <p className="stat-value">{data.stats.supported_intents}</p>
                <p className="stat-label">Banking intents</p>
              </div>
              <div className="stat-block">
                <p className="stat-value">{data.stats.pipeline_stages}</p>
                <p className="stat-label">Pipeline stages</p>
              </div>
              <div className="stat-block">
                <p className="stat-value">{data.stats.typical_latency_s}s</p>
                <p className="stat-label">Typical reply time</p>
              </div>
              <div className="stat-block">
                <p className="stat-value">{data.stats.history_queries}</p>
                <p className="stat-label">Saved queries</p>
              </div>
            </div>
          </section>

          <section className="landing-section">
            <h2>Sample published rates</h2>
            <p className="section-lead">
              Static demo figures for common products — not your personal rates from a bank system.
            </p>
            <div className="rate-table-wrap">
              <table className="rate-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {data.interest_rates.map((row) => (
                    <tr key={row.product}>
                      <td>{row.product}</td>
                      <td>{row.rate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="landing-section">
            <h2>What you can ask</h2>
            <p className="section-lead">
              Ask how to do these tasks. You get procedure and next steps — never your private bank records.
            </p>
            <div className="intent-grid">
              {data.intents.map((intent) => (
                <div key={intent.id} className="intent-item">
                  <p className="intent-label">{intent.label}</p>
                  <p className="intent-example kn">{intent.example}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="landing-section">
            <h2>How a query flows</h2>
            <p className="section-lead">One spoken turn runs through four offline-capable stages.</p>
            <ol className="pipeline-steps">
              {data.pipeline.map((step) => (
                <li key={step.step}>
                  <span className="step-num">{step.step}</span>
                  <div>
                    <p className="step-name">{step.name}</p>
                    <p className="step-detail muted">{step.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {data.recent.length > 0 && (
            <section className="landing-section">
              <h2>Recent activity</h2>
              <p className="section-lead">Latest successful queries from this device session store.</p>
              <ul className="recent-list">
                {data.recent.map((item) => (
                  <li key={item.id}>
                    <span className="badge intent-badge">{formatIntentLabel(item.intent)}</span>
                    <span className="recent-text">{item.kannada_text || "Voice query"}</span>
                    <span className="muted recent-time">{formatHistoryTime(item.created_at)}</span>
                  </li>
                ))}
              </ul>
              <button type="button" className="ghost-btn" onClick={onOpenHistory}>
                Open full history
              </button>
            </section>
          )}
        </>
      )}

      {!data && !error && <p className="muted landing-loading">Loading product data…</p>}
    </div>
  );
}
