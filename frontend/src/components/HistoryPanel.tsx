import { useCallback, useEffect, useState } from "react";
import {
  base64ToAudioUrl,
  clearHistory,
  deleteHistoryItem,
  fetchHistory,
  fetchHistoryItem,
  formatHistoryTime,
  formatIntentLabel,
  type HistoryItem,
} from "../api/client";

interface HistoryPanelProps {
  refreshKey: number;
}

export function HistoryPanel({ refreshKey }: HistoryPanelProps) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<HistoryItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchHistory();
      setItems(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load history");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    if (!detail?.audio_b64) {
      setAudioUrl(null);
      return;
    }
    const url = base64ToAudioUrl(detail.audio_b64);
    setAudioUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [detail]);

  const openItem = useCallback(async (id: number) => {
    setSelectedId(id);
    setDetailLoading(true);
    setDetail(null);
    setAudioUrl(null);
    try {
      const item = await fetchHistoryItem(id);
      setDetail(item);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open item");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const handleDelete = useCallback(
    async (id: number) => {
      await deleteHistoryItem(id);
      if (selectedId === id) {
        setSelectedId(null);
        setDetail(null);
        setAudioUrl(null);
      }
      await load();
    },
    [load, selectedId],
  );

  const handleClear = useCallback(async () => {
    if (!window.confirm("Clear all query history? This cannot be undone.")) return;
    await clearHistory();
    setSelectedId(null);
    setDetail(null);
    setAudioUrl(null);
    await load();
  }, [load]);

  if (loading) {
    return (
      <div className="panel history-panel">
        <p className="muted">Loading history…</p>
      </div>
    );
  }

  return (
    <div className="history-layout">
      <div className="panel history-list-panel">
        <div className="history-list-header">
          <div>
            <h2>Query history</h2>
            <p className="muted history-count">
              {items.length === 0 ? "No saved queries yet" : `${items.length} saved quer${items.length === 1 ? "y" : "ies"}`}
            </p>
          </div>
          {items.length > 0 && (
            <button type="button" className="ghost-btn" onClick={handleClear}>
              Clear all
            </button>
          )}
        </div>

        {error && <p className="history-error">{error}</p>}

        {items.length === 0 ? (
          <div className="history-empty">
            <p>Ask how to complete a banking task to start building your history.</p>
            <p className="muted">
              Each guidance reply is saved with voice playback. No personal bank data is stored — only what you asked and the how-to answer.
            </p>
          </div>
        ) : (
          <ul className="history-list">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`history-row ${selectedId === item.id ? "active" : ""}`}
                  onClick={() => void openItem(item.id)}
                >
                  <div className="history-row-top">
                    <span className="badge intent-badge">{formatIntentLabel(item.intent)}</span>
                    <span className="history-time muted">
                      {item.has_audio ? "🔊 " : ""}
                      {formatHistoryTime(item.created_at)}
                    </span>
                  </div>
                  <p className="history-kannada">{item.kannada_text || item.english_text || "Untitled query"}</p>
                  <p className="history-preview muted">{item.response_text}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="panel history-detail-panel">
        {!selectedId && (
          <div className="history-empty detail-empty">
            <h3>Select a query</h3>
            <p className="muted">Open any past turn to re-read the how-to guidance and replay the Kannada voice reply.</p>
          </div>
        )}

        {detailLoading && <p className="muted">Loading details…</p>}

        {detail && !detailLoading && (
          <>
            <div className="history-detail-header">
              <div>
                <span className="badge intent-badge">{formatIntentLabel(detail.intent)}</span>
                <span className="badge">{Math.round(detail.confidence * 100)}%</span>
                <span className="badge route-badge">{detail.route}</span>
              </div>
              <button type="button" className="ghost-btn danger-text" onClick={() => void handleDelete(detail.id)}>
                Delete
              </button>
            </div>

            <p className="muted history-time-detail">{formatHistoryTime(detail.created_at)}</p>

            <div className="result-block">
              <h3>You said (Kannada)</h3>
              <p className="kannada-text">{detail.kannada_text || "(empty)"}</p>
            </div>

            <div className="result-block">
              <h3>Translation (English)</h3>
              <p>{detail.english_text || "(empty)"}</p>
            </div>

            <div className="result-block">
              <h3>Guidance</h3>
              <p className="response-text">{detail.response_text}</p>
              <p className="muted result-note">How-to information only — not live account data.</p>
            </div>

            <div className="result-block">
              <h3>Kannada voice</h3>
              {audioUrl ? (
                <audio key={audioUrl} controls className="audio-player" src={audioUrl} />
              ) : detail.has_audio ? (
                <p className="muted">Audio file is missing on disk for this query.</p>
              ) : (
                <p className="muted">No audio saved for this query.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
