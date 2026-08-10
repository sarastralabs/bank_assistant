import { FormEvent, useState } from "react";
import { adminLogin } from "../api/client";
import { setAdminSession } from "../auth/adminSession";

interface AdminLoginProps {
  apiOnline: boolean | null;
  onSuccess: (username: string) => void;
}

export function AdminLogin({ apiOnline, onSuccess }: AdminLoginProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await adminLogin(username.trim(), password);
      setAdminSession(result.token, result.username);
      onSuccess(result.username);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="adm-login">
      <div className="adm-login-stage">
        <div className="adm-login-brand">
          <span className="adm-login-mark" aria-hidden>
            ಕ
          </span>
          <p className="adm-login-eyebrow">Sarastra · Staff desk</p>
          <h1>ಕನ್ನಡ ವಾಯ್ಸ್ ಬ್ಯಾಂಕಿಂಗ್</h1>
          <p className="adm-login-sub">ಸಿಬ್ಬಂದಿ ಪ್ರವೇಶ · Secure lobby control</p>
        </div>

        <form className="adm-login-form" onSubmit={(e) => void handleSubmit(e)}>
          <div className="adm-login-form-head">
            <h2>Sign in</h2>
            <p className="adm-login-lead">
              Open the customer lobby, greet visitors, and watch live sessions.
            </p>
          </div>

          {apiOnline === false && (
            <p className="api-warning">Service unavailable. Start the backend and try again.</p>
          )}
          {error && <p className="api-warning">{error}</p>}

          <div className="adm-login-fields">
            <label htmlFor="admin-user">
              Staff ID
              <input
                id="admin-user"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                placeholder="Enter staff ID"
                required
              />
            </label>

            <label htmlFor="admin-pass">
              Password
              <input
                id="admin-pass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="Enter password"
                required
              />
            </label>
          </div>

          <button
            type="submit"
            className="adm-login-submit"
            disabled={busy || apiOnline === false}
          >
            {busy ? "Signing in…" : "Sign in to console"}
          </button>
        </form>
      </div>
    </div>
  );
}
