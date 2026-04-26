import { useState } from "react";
import { useTranslation } from "react-i18next";
import { setToken, apiFetch } from "../auth.js";

export default function LoginPage({ onLogin }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await apiFetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t("auth.loginFailed"));
      } else {
        setToken(data.token);
        onLogin({ email: data.email, role: data.role });
      }
    } catch {
      setError(t("auth.networkError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-logo">⚡</div>
        <h1 className="login-title">FLUX</h1>
        <p className="login-subtitle">{t("auth.subtitle")}</p>
        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-field">
            <label className="login-label">{t("auth.email")}</label>
            <input
              type="email"
              className="form-input login-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("auth.emailPlaceholder")}
              required
              autoFocus
            />
          </div>
          <div className="login-field">
            <label className="login-label">{t("auth.password")}</label>
            <input
              type="password"
              className="form-input login-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          {error && <p className="login-error">{error}</p>}
          <button
            type="submit"
            className="btn btn-primary login-btn"
            disabled={loading}
          >
            {loading ? t("auth.loggingIn") : t("auth.login")}
          </button>
        </form>
      </div>
    </div>
  );
}
